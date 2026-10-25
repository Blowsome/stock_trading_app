import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Simulation } from "@prisma/client";
import { GEMINI_RUNS, RANDOM_RUNS, SIM_SLICE, type SimStatus } from "@/lib/sim";
import { unitLabel } from "@/lib/assets";
import { usd } from "@/lib/format";
import { asOfPrice, asOfQuote, barsUntil, latestPrice, simWindows, universeRow, type UniverseRow } from "./asOf";
import { prisma, D, type Decimal } from "./db";
import { getMetrics, getProfile } from "./finnhub";
import { GeminiQuotaError, buildPrompt, geminiDecide } from "./gemini";
import { PERSONAS, personaForRun, systemPrompt } from "./personas";
import type { PortfolioView } from "./portfolio";
import { newsAsOf } from "./news";
import { holm, randomAllocations, seededRng, signFlipPValue, simStats, stratifiedPermutationPValue, type SimStats } from "./simMath";
import { RULES, equalWeight, type Signals } from "./simRules";
import { SIM_UNIVERSE } from "./simUniverse";
import { normalizeSymbol } from "./symbols";
import { sma, volatility } from "./technicals";
import { TradeError } from "./trading";

const cacheDir = () => process.env.SIM_CACHE_DIR || path.join(process.cwd(), "data", "sim-cache");
const QTY_DP = 6;
const DUST = new D("0.000001");
const BENCHMARK = "SPY";
const ACTIVE: SimStatus[] = ["PREPARING", "RUNNING", "READY", "FAILED"];

const money = (d: Decimal) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const geminiConcurrency = () => Number(process.env.GEMINI_CONCURRENCY) || 3;

const g = globalThis as unknown as { __simJobs?: Set<string>; __simPrep?: Map<string, number>; __simWrites?: Map<string, Promise<void>> };
const jobs = (g.__simJobs ??= new Set<string>());
const prepared = (g.__simPrep ??= new Map<string, number>());
const writes = (g.__simWrites ??= new Map<string, Promise<void>>());

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * The user's unfinished simulation for a period (see simWindows; 0 is the latest), or a new one.
 * Starts the Gemini runs.
 */
export async function getOrCreateSimulation(userId: string, windowIndex = 0): Promise<Simulation> {
  const window = (await simWindows())[windowIndex];
  if (!window) throw new TradeError("Unknown simulation period");
  const existing = await prisma.simulation.findFirst({
    where: { userId, status: { in: ACTIVE }, startDate: day(window.start) },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    // A failed run waits for the user to press retry.
    if (existing.status !== "FAILED") startSimulationJob(existing.id);
    return existing;
  }
  const paths = [
    { kind: "USER", runIndex: 0, cash: SIM_SLICE },
    { kind: "BENCHMARK", runIndex: 0, cash: SIM_SLICE },
    // Each Gemini run is an investor persona; they take turns so every style gets the same number of runs.
    ...Array.from({ length: GEMINI_RUNS }, (_, i) => ({ kind: "GEMINI", runIndex: i + 1, cash: SIM_SLICE, strategy: personaForRun(i + 1) })),
    ...Array.from({ length: RANDOM_RUNS }, (_, i) => ({ kind: "RANDOM", runIndex: i + 1, cash: SIM_SLICE })),
  ];
  const sim = await prisma.simulation.create({
    data: {
      userId,
      startDate: day(window.start),
      endDate: window.end ? day(window.end) : null,
      dataVersion: DATA_VERSION,
      status: "PREPARING",
      paths: { create: paths },
    },
  });
  startSimulationJob(sim.id);
  return sim;
}

/** Runs (or resumes) preparation and the Gemini runs in the background. Safe to call more than once. */
export function startSimulationJob(simId: string) {
  if (jobs.has(simId)) return;
  jobs.add(simId);
  runJob(simId)
    .catch(async (e) => {
      console.error("[simulation]", simId, e);
      await prisma.simulation.update({ where: { id: simId }, data: { status: "FAILED", error: (e as Error).message } }).catch(() => {});
    })
    .finally(() => {
      jobs.delete(simId);
      void writeCache(simId);
    });
}

/** Restarts a failed simulation's unfinished Gemini runs. */
export async function retrySimulation(userId: string, simId: string) {
  const sim = await prisma.simulation.findFirst({ where: { id: simId, userId } });
  if (!sim || sim.status !== "FAILED") throw new TradeError("This simulation is not waiting for a retry");
  await prisma.$transaction([
    prisma.simPath.updateMany({ where: { simulationId: simId, kind: "GEMINI", error: { not: null } }, data: { error: null, decidedAt: null } }),
    prisma.simulation.update({ where: { id: simId }, data: { status: sim.universe ? "RUNNING" : "PREPARING", error: null } }),
  ]);
  startSimulationJob(simId);
}

async function runJob(simId: string) {
  const sim = await prisma.simulation.findUniqueOrThrow({ where: { id: simId } });
  if (sim.status === "REVEALED" || sim.status === "READY") return;
  const date = ymd(sim.startDate);
  let universe = sim.universe as UniverseRow[] | null;
  if (!universe) {
    universe = await buildUniverse(date, (n) => prepared.set(simId, n));
    const spy = universe.find((r) => r.symbol === BENCHMARK);
    if (!spy) throw new Error("No S&P 500 price for the start date");
    const benchmark = await prisma.simPath.findUniqueOrThrow({
      where: { simulationId_kind_runIndex: { simulationId: simId, kind: "BENCHMARK", runIndex: 0 } },
    });
    await recordDecision(benchmark.id, [{ symbol: BENCHMARK, dollars: SIM_SLICE }], new Map([[BENCHMARK, spy.price]]), "Buy and hold the S&P 500.");
    await prisma.simulation.update({ where: { id: simId }, data: { universe, status: "RUNNING" } });
    void writeCache(simId);
  }
  await ensureBaselinePaths(simId, universe, date);
  await runGeminiPaths(simId, universe, date);
  await prisma.simulation.updateMany({ where: { id: simId, status: "RUNNING" }, data: { status: "READY" } });
}

/** Retries while Finnhub's call budget is used up instead of failing. */
async function withBudget<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 30 || !/rate limit/i.test((e as Error).message)) throw e;
      await sleep(5000);
    }
  }
}

/** The universe as of `date`, shared by every simulation that starts that day. */
/**
 * What new simulations give Gemini (see Simulation.dataVersion): 2 added news headlines and
 * technical/candlestick data; 3 picks the most informative articles and adds their summaries.
 */
const DATA_VERSION = 3;

async function buildUniverse(date: string, onProgress: (n: number) => void): Promise<UniverseRow[]> {
  const file = path.join(cacheDir(), `universe-v${DATA_VERSION}-${date}.json`);
  const cached = await readFile(file, "utf8").then((s) => JSON.parse(s) as UniverseRow[]).catch(() => null);
  if (cached?.length) return cached;
  const rows: UniverseRow[] = [];
  for (const [i, stock] of SIM_UNIVERSE.entries()) {
    const metrics = stock.etf ? null : await withBudget(() => getMetrics(stock.symbol)).catch(() => null);
    // Index ETFs have no company news of their own.
    const news = stock.etf ? [] : await withBudget(() => newsAsOf(stock.symbol, date)).catch(() => []);
    const row = await universeRow(stock, date, metrics, news).catch(() => null);
    if (row) rows.push(row);
    onProgress(i + 1);
  }
  if (rows.length < SIM_UNIVERSE.length / 2) throw new Error("Could not load enough market data for the start date");
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(file, JSON.stringify(rows, null, 2));
  return rows;
}

export type Allocation = { symbol: string; dollars: number };

/** Keeps known symbols, merges duplicates, and scales the total down to the budget if it goes over. */
export function normalizeAllocations(raw: Allocation[], known: Set<string>, budget: number): Allocation[] {
  const merged = new Map<string, number>();
  for (const a of raw) {
    const symbol = normalizeSymbol(a.symbol);
    if (!symbol || !known.has(symbol) || !(a.dollars > 0) || !Number.isFinite(a.dollars)) continue;
    merged.set(symbol, (merged.get(symbol) ?? 0) + a.dollars);
  }
  const total = [...merged.values()].reduce((s, v) => s + v, 0);
  const scale = total > budget ? budget / total : 1;
  return [...merged]
    .map(([symbol, dollars]) => ({ symbol, dollars: Math.floor(dollars * scale * 100) / 100 }))
    .filter((a) => a.dollars >= 1);
}

/** Buys the allocations at the start-date prices and marks the path as decided. */
async function recordDecision(pathId: string, allocations: Allocation[], prices: Map<string, number>, reasoning: string, model?: string) {
  await prisma.$transaction(async (tx) => {
    await tx.simHolding.deleteMany({ where: { pathId } });
    let cash = new D(SIM_SLICE);
    for (const a of allocations) {
      const price = new D(prices.get(a.symbol)!);
      const shares = new D(a.dollars).div(price).toDecimalPlaces(QTY_DP, D.ROUND_DOWN);
      if (shares.lte(0)) continue;
      cash = cash.minus(money(shares.times(price)));
      await tx.simHolding.create({ data: { pathId, symbol: a.symbol, shares, avgCost: price } });
    }
    await tx.simPath.update({ where: { id: pathId }, data: { cash, reasoning, model, decidedAt: new Date(), error: null } });
  });
}

/** The trading day (New York time) of a moment, so a late-evening reveal doesn't pick up the next session. */
const tradingDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

/** What each rule needs to know about a stock on `date`. */
async function ruleSignals(universe: UniverseRow[], date: string): Promise<Signals[]> {
  const etfs = new Set(SIM_UNIVERSE.filter((s) => s.etf).map((s) => s.symbol));
  return Promise.all(
    universe.map(async (r) => {
      const bars = await barsUntil(r.symbol, date).catch(() => []);
      return { symbol: r.symbol, etf: etfs.has(r.symbol), price: r.price, ret1m: r.ret1m, ret12m: r.ret12m, pe: r.pe, vol: volatility(bars), ma50: sma(bars, 50), ma200: sma(bars, 200) };
    }),
  );
}

/**
 * Creates and fills the benchmark paths: the random portfolios (each seeded by the simulation and
 * run number, so reproducible) and one path per rule. With `exitDate`, also values them, for
 * simulations revealed before these benchmarks existed.
 */
async function ensureBaselinePaths(simId: string, universe: UniverseRow[], date: string, exitDate?: string) {
  const existing = await prisma.simPath.findMany({ where: { simulationId: simId, kind: { in: ["RANDOM", "RULE"] } }, select: { kind: true, runIndex: true } });
  const have = new Set(existing.map((p) => `${p.kind}:${p.runIndex}`));
  const wanted = [
    ...Array.from({ length: RANDOM_RUNS }, (_, i) => ({ kind: "RANDOM", runIndex: i + 1, strategy: null as string | null })),
    ...RULES.map((r, i) => ({ kind: "RULE", runIndex: i + 1, strategy: r.key })),
  ].filter((p) => !have.has(`${p.kind}:${p.runIndex}`));
  if (wanted.length) await prisma.simPath.createMany({ data: wanted.map((p) => ({ simulationId: simId, ...p, cash: SIM_SLICE })) });

  const undecided = await prisma.simPath.findMany({ where: { simulationId: simId, kind: { in: ["RANDOM", "RULE"] }, decidedAt: null } });
  if (!undecided.length) return;
  const prices = new Map(universe.map((r) => [r.symbol, r.price]));
  const symbols = universe.map((r) => r.symbol);
  let signals: Signals[] | null = null;
  for (const p of undecided) {
    if (p.kind === "RANDOM") {
      const allocations = randomAllocations(symbols, seededRng(`${simId}:random:${p.runIndex}`));
      await recordDecision(p.id, allocations, prices, `Random pick: ${allocations.length} stocks, ${usd(allocations[0].dollars)} each.`);
    } else {
      const rule = RULES.find((r) => r.key === p.strategy)!;
      signals ??= await ruleSignals(universe, date);
      const picks = rule.pick(signals);
      const reasoning = `${rule.description} ${picks.length ? `Picked ${picks.length}: ${picks.join(", ")}.` : "Nothing qualified, so it stayed in cash."}`;
      await recordDecision(p.id, equalWeight(picks), prices, reasoning);
    }
  }
  if (exitDate) {
    const holdings = await prisma.simHolding.findMany({ where: { pathId: { in: undecided.map((p) => p.id) } } });
    const exits = new Map<string, number>();
    for (const s of new Set(holdings.map((h) => h.symbol))) {
      const price = await asOfPrice(s, exitDate);
      if (price == null) throw new Error(`No price for ${s} on ${exitDate}`);
      exits.set(s, price);
    }
    await prisma.$transaction(async (tx) => {
      for (const p of undecided) {
        const path = await tx.simPath.findUniqueOrThrow({ where: { id: p.id }, include: { holdings: true } });
        let value = path.cash;
        for (const h of path.holdings) {
          const exit = new D(exits.get(h.symbol)!);
          value = value.plus(h.shares.times(exit));
          await tx.simHolding.update({ where: { id: h.id }, data: { exitPrice: exit } });
        }
        await tx.simPath.update({ where: { id: p.id }, data: { finalValue: money(value) } });
      }
    });
  }
  void writeCache(simId);
}

/** Asks Gemini once per undecided path, a few at a time. Each run is independent. */
async function runGeminiPaths(simId: string, universe: UniverseRow[], date: string) {
  const queue = await prisma.simPath.findMany({
    where: { simulationId: simId, kind: "GEMINI", decidedAt: null },
    orderBy: { runIndex: "asc" },
  });
  const prices = new Map(universe.map((r) => [r.symbol, r.price]));
  const known = new Set(prices.keys());
  let successes = 0;
  let failures = 0;
  let fatal: Error | null = null;

  const worker = async () => {
    for (let p = queue.shift(); p && !fatal; p = queue.shift()) {
      try {
        let decision;
        // One retry if the answer doesn't parse.
        try {
          decision = await geminiDecide(universe, date, SIM_SLICE, p.strategy);
        } catch (e) {
          if (e instanceof GeminiQuotaError || /GEMINI_API_KEY|\((400|401|403)\)/.test((e as Error).message)) throw e;
          decision = await geminiDecide(universe, date, SIM_SLICE, p.strategy);
        }
        const allocations = normalizeAllocations(decision.allocations, known, SIM_SLICE);
        await recordDecision(p.id, allocations, prices, decision.reasoning, decision.model);
        successes++;
      } catch (e) {
        // Out of quota on every model: leave this run undecided so Retry picks it up later.
        if (e instanceof GeminiQuotaError) {
          fatal = e;
          break;
        }
        failures++;
        const message = (e as Error).message;
        await prisma.simPath.update({ where: { id: p.id }, data: { error: message, decidedAt: new Date() } });
        // A setup problem (no key, bad model): stop instead of burning through every run.
        if (!successes && failures >= 3) fatal = new Error(message);
      }
      void writeCache(simId);
    }
  };
  await Promise.all(Array.from({ length: geminiConcurrency() }, worker));
  if (fatal) throw fatal;
}

async function ownedSim(userId: string, simId: string) {
  const sim = await prisma.simulation.findFirst({ where: { id: simId, userId } });
  if (!sim) throw new TradeError("Simulation not found");
  return sim;
}

const userPath = (simId: string) =>
  prisma.simPath.findUniqueOrThrow({ where: { simulationId_kind_runIndex: { simulationId: simId, kind: "USER", runIndex: 0 } } });

export type SimTradeInput = { symbol: string; side: "BUY" | "SELL"; quantity?: number; notional?: number };

/** A market order on the user's slice, filled at the start date's close. */
export async function simTrade(userId: string, simId: string, input: SimTradeInput) {
  const sim = await ownedSim(userId, simId);
  if (sim.status === "REVEALED") throw new TradeError("This simulation is finished. Your picks are locked in.");
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new TradeError("Invalid symbol");
  if (input.side !== "BUY" && input.side !== "SELL") throw new TradeError("Side must be BUY or SELL");
  const p = await asOfPrice(symbol, ymd(sim.startDate));
  if (p == null || !(p > 0)) throw new TradeError(`No price for ${symbol} on ${ymd(sim.startDate)}`);
  const price = new D(p);

  let shares: Decimal;
  if (input.notional != null) {
    if (!(input.notional >= 1)) throw new TradeError("Minimum order is $1.00");
    shares = new D(input.notional).div(price).toDecimalPlaces(QTY_DP, D.ROUND_DOWN);
  } else {
    if (!(Number(input.quantity) > 0)) throw new TradeError("Enter a quantity greater than 0");
    shares = new D(input.quantity!).toDecimalPlaces(QTY_DP, D.ROUND_DOWN);
  }
  if (shares.lte(0)) throw new TradeError("Order is too small");

  const { id: pathId } = await userPath(simId);
  const trade = await prisma.$transaction(async (tx) => {
    const path = await tx.simPath.findUniqueOrThrow({ where: { id: pathId } });
    const key = { pathId_symbol: { pathId, symbol } };
    const holding = await tx.simHolding.findUnique({ where: key });
    const amount = money(shares.times(price));
    if (input.side === "BUY") {
      if (amount.gt(path.cash)) {
        throw new TradeError(`Not enough cash in your ${usd(SIM_SLICE)} slice. This order costs ${usd(amount.toNumber())} and you have ${usd(path.cash.toNumber())}.`);
      }
      await tx.simPath.update({ where: { id: pathId }, data: { cash: path.cash.minus(amount) } });
      if (holding) {
        const qty = holding.shares.plus(shares);
        const avgCost = holding.shares.times(holding.avgCost).plus(shares.times(price)).div(qty).toDecimalPlaces(6);
        await tx.simHolding.update({ where: key, data: { shares: qty, avgCost } });
      } else {
        await tx.simHolding.create({ data: { pathId, symbol, shares, avgCost: price } });
      }
    } else {
      const held = holding?.shares ?? new D(0);
      if (shares.gt(held.plus(DUST))) throw new TradeError(`You can only sell ${held.toNumber()} ${unitLabel(symbol)} of ${symbol}.`);
      await tx.simPath.update({ where: { id: pathId }, data: { cash: path.cash.plus(amount) } });
      const remaining = held.minus(shares);
      if (remaining.lte(DUST)) await tx.simHolding.delete({ where: key });
      else await tx.simHolding.update({ where: key, data: { shares: remaining } });
    }
    return tx.simTrade.create({ data: { pathId, symbol, side: input.side, shares, price } });
  });
  void writeCache(simId);
  return trade;
}

/** The user's slice in the same shape as the live portfolio, priced at the start date. */
export async function simPortfolio(userId: string, simId: string): Promise<PortfolioView> {
  const sim = await ownedSim(userId, simId);
  const date = ymd(sim.startDate);
  const [path, watch] = await Promise.all([
    prisma.simPath.findUniqueOrThrow({
      where: { simulationId_kind_runIndex: { simulationId: simId, kind: "USER", runIndex: 0 } },
      include: { holdings: { orderBy: { symbol: "asc" } } },
    }),
    prisma.watchlistItem.findMany({ where: { userId }, orderBy: { addedAt: "asc" } }),
  ]);
  const symbols = [...new Set([...path.holdings.map((h) => h.symbol), ...watch.map((w) => w.symbol)])];
  const quotes = new Map(await Promise.all(symbols.map(async (s) => [s, await asOfQuote(s, date).catch(() => null)] as const)));
  const names = new Map(SIM_UNIVERSE.map((s) => [s.symbol, s.name]));

  const positions = await Promise.all(
    path.holdings.map(async (h) => {
      const q = quotes.get(h.symbol);
      const price = q?.price ?? h.avgCost.toNumber();
      const quantity = h.shares.toNumber();
      const name = names.get(h.symbol) ?? (await getProfile(h.symbol).catch(() => null))?.name ?? null;
      // Time is frozen, so there is no day change: the baseline is today's value.
      return { symbol: h.symbol, name, quantity, avgCost: h.avgCost.toNumber(), price, prevClose: q?.prevClose ?? price, dayBase: quantity * price };
    }),
  );
  return {
    cash: path.cash.toNumber(),
    buyingPower: path.cash.toNumber(),
    positions,
    closedDayChange: 0,
    watchlist: watch.flatMap((w) => {
      const q = quotes.get(w.symbol);
      return q ? [{ symbol: w.symbol, price: q.price, prevClose: q.prevClose }] : [];
    }),
  };
}

/** The user's simulation trades in the order-table shape. */
export async function simOrders(userId: string, simId: string, symbol?: string) {
  await ownedSim(userId, simId);
  const { id } = await userPath(simId);
  const trades = await prisma.simTrade.findMany({ where: { pathId: id, ...(symbol && { symbol }) }, orderBy: { createdAt: "desc" } });
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    type: "MARKET",
    quantity: t.shares.toNumber(),
    limitPrice: null,
    fillPrice: t.price.toNumber(),
    status: "FILLED",
    reason: null,
    createdAt: t.createdAt,
    filledAt: t.createdAt,
  }));
}

/** Progress for the banner. Gemini's choices stay hidden until the reveal. */
export async function simState(userId: string, simId: string) {
  const sim = await ownedSim(userId, simId);
  const paths = await prisma.simPath.findMany({ where: { simulationId: simId }, include: { holdings: true } });
  const gemini = paths.filter((p) => p.kind === "GEMINI");
  const user = paths.find((p) => p.kind === "USER")!;
  return {
    id: sim.id,
    startDate: ymd(sim.startDate),
    endDate: sim.endDate ? ymd(sim.endDate) : null,
    status: sim.status as SimStatus,
    error: sim.error,
    prepared: sim.universe ? SIM_UNIVERSE.length : (prepared.get(simId) ?? 0),
    universeSize: SIM_UNIVERSE.length,
    geminiDone: gemini.filter((p) => p.decidedAt).length,
    geminiFailed: gemini.filter((p) => p.error).length,
    geminiTotal: gemini.length,
    cash: user.cash.toNumber(),
    invested: user.holdings.reduce((s, h) => s + h.shares.toNumber() * h.avgCost.toNumber(), 0),
  };
}

export async function simUniverse(userId: string, simId: string) {
  const sim = await ownedSim(userId, simId);
  return (sim.universe as UniverseRow[] | null) ?? [];
}

export async function listSimulations(userId: string) {
  const sims = await prisma.simulation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { paths: { where: { kind: "USER" } } },
  });
  return sims.map((s) => ({
    id: s.id,
    startDate: ymd(s.startDate),
    endDate: s.endDate ? ymd(s.endDate) : null,
    status: s.status,
    createdAt: s.createdAt,
    revealedAt: s.revealedAt,
    userFinal: s.paths[0]?.finalValue?.toNumber() ?? null,
  }));
}

/** Locks the user's picks and values every path at the period's end (or the latest price). */
export async function revealSimulation(userId: string, simId: string) {
  const sim = await ownedSim(userId, simId);
  if (sim.status === "REVEALED") return;
  if (sim.status !== "READY") throw new TradeError("Gemini is still trading. You can reveal once all runs are done.");
  const paths = await prisma.simPath.findMany({ where: { simulationId: simId }, include: { holdings: true } });
  const symbols = [...new Set(paths.flatMap((p) => p.holdings.map((h) => h.symbol)))];
  const exits = new Map(
    await Promise.all(
      symbols.map(async (s) => {
        const price = sim.endDate ? await asOfPrice(s, ymd(sim.endDate)) : await latestPrice(s);
        if (price == null) throw new Error(`No price for ${s}`);
        return [s, price] as const;
      }),
    ),
  );
  await prisma.$transaction(async (tx) => {
    for (const p of paths) {
      let value = p.cash;
      for (const h of p.holdings) {
        const exit = new D(exits.get(h.symbol)!);
        value = value.plus(h.shares.times(exit));
        await tx.simHolding.update({ where: { id: h.id }, data: { exitPrice: exit } });
      }
      await tx.simPath.update({ where: { id: p.id }, data: { finalValue: money(value) } });
    }
    await tx.simulation.update({ where: { id: simId }, data: { status: "REVEALED", revealedAt: new Date() } });
  });
  await writeCache(simId);
}

export type PathResult = {
  kind: "USER" | "GEMINI" | "RANDOM" | "RULE" | "BENCHMARK";
  runIndex: number;
  finalValue: number;
  returnPct: number;
  cash: number;
  reasoning: string | null;
  model: string | null;
  /** For RULE paths, the rule's key (see simRules.ts). */
  strategy: string | null;
  error: string | null;
  holdings: { symbol: string; shares: number; avgCost: number; exitPrice: number; value: number; returnPct: number }[];
};

export { simStats, type SimStats } from "./simMath";

export async function simResults(userId: string, simId: string) {
  const sim = await ownedSim(userId, simId);
  if (sim.status !== "REVEALED") throw new TradeError("Results are shown after you lock in your picks.");
  const universe = (sim.universe as UniverseRow[] | null) ?? [];
  // Simulations revealed before the random and rule benchmarks existed get them now, valued on the reveal day.
  const valuedAt = sim.endDate ? ymd(sim.endDate) : tradingDay(sim.revealedAt ?? new Date());
  if (universe.length) await ensureBaselinePaths(simId, universe, ymd(sim.startDate), valuedAt);
  const paths = await prisma.simPath.findMany({
    where: { simulationId: simId },
    include: { holdings: { orderBy: { symbol: "asc" } } },
    orderBy: [{ kind: "asc" }, { runIndex: "asc" }],
  });
  const results: PathResult[] = paths.map((p) => {
    const finalValue = p.finalValue?.toNumber() ?? p.cash.toNumber();
    return {
      kind: p.kind as PathResult["kind"],
      runIndex: p.runIndex,
      finalValue,
      returnPct: ((finalValue - SIM_SLICE) / SIM_SLICE) * 100,
      cash: p.cash.toNumber(),
      reasoning: p.reasoning,
      model: p.model,
      strategy: p.strategy,
      error: p.error,
      holdings: p.holdings.map((h) => {
        const shares = h.shares.toNumber();
        const avgCost = h.avgCost.toNumber();
        const exitPrice = h.exitPrice?.toNumber() ?? avgCost;
        return { symbol: h.symbol, shares, avgCost, exitPrice, value: shares * exitPrice, returnPct: ((exitPrice - avgCost) / avgCost) * 100 };
      }),
    };
  });
  return {
    id: sim.id,
    startDate: ymd(sim.startDate),
    /** The trading day every slice was valued at. */
    endDate: valuedAt,
    dataVersion: sim.dataVersion,
    revealedAt: sim.revealedAt,
    slice: SIM_SLICE,
    paths: results,
    stats: simStats(results),
    /** Exactly what each Gemini run was sent. */
    prompt: {
      // One system instruction per persona used in this simulation (older simulations have none).
      systems: [...new Set(results.filter((p) => p.kind === "GEMINI").map((p) => p.strategy))].map((key) => ({
        persona: key,
        text: systemPrompt(key),
      })),
      user: buildPrompt(universe, ymd(sim.startDate), SIM_SLICE),
      temperature: 1,
    },
  };
}

/** Rewrites data/sim-cache/<id>.json with every decision so far. Writes for one simulation never overlap. */
export function writeCache(simId: string): Promise<void> {
  const next = (writes.get(simId) ?? Promise.resolve()).then(async () => {
    const sim = await prisma.simulation.findUnique({
      where: { id: simId },
      include: { paths: { include: { holdings: true, trades: true }, orderBy: [{ kind: "asc" }, { runIndex: "asc" }] } },
    });
    if (!sim) return;
    const num = (d: Decimal | null) => d?.toNumber() ?? null;
    const dump = {
      id: sim.id,
      userId: sim.userId,
      startDate: ymd(sim.startDate),
      status: sim.status,
      dataVersion: sim.dataVersion,
      error: sim.error,
      createdAt: sim.createdAt,
      revealedAt: sim.revealedAt,
      slice: SIM_SLICE,
      universe: sim.universe,
      paths: sim.paths.map((p) => ({
        kind: p.kind,
        runIndex: p.runIndex,
        cash: num(p.cash),
        reasoning: p.reasoning,
        model: p.model,
        strategy: p.strategy,
        error: p.error,
        decidedAt: p.decidedAt,
        finalValue: num(p.finalValue),
        holdings: p.holdings.map((h) => ({ symbol: h.symbol, shares: num(h.shares), avgCost: num(h.avgCost), exitPrice: num(h.exitPrice) })),
        trades: p.trades.map((t) => ({ symbol: t.symbol, side: t.side, shares: num(t.shares), price: num(t.price), at: t.createdAt })),
      })),
    };
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(path.join(cacheDir(), `${simId}.json`), JSON.stringify(dump, null, 2));
  });
  const settled = next.catch((e) => console.error("[sim-cache]", e));
  writes.set(simId, settled);
  return settled;
}

/** Picks up simulations that were mid-run when the server stopped. */
export async function resumeSimulations() {
  const sims = await prisma.simulation.findMany({ where: { status: { in: ["PREPARING", "RUNNING"] } }, select: { id: true } });
  for (const { id } of sims) startSimulationJob(id);
}

/**
 * Every revealed simulation side by side, plus a pooled test of Gemini against random picks.
 * The pooled test compares runs only within the same simulation, so a strong or weak market
 * period can't make one side look better.
 */
export async function compareSimulations(userId: string) {
  const sims = await prisma.simulation.findMany({ where: { userId, status: "REVEALED" }, orderBy: { startDate: "desc" } });
  const periods: { id: string; startDate: string; endDate: string; dataVersion: number; models: string[]; stats: SimStats }[] = [];
  const groups: { a: number[]; b: number[] }[] = [];
  for (const sim of sims) {
    const r = await simResults(userId, sim.id);
    const gem = r.paths.filter((p) => p.kind === "GEMINI" && !p.error);
    const models = [...new Set(gem.map((p) => p.model ?? "unknown"))];
    groups.push({ a: gem.map((p) => p.returnPct), b: r.paths.filter((p) => p.kind === "RANDOM").map((p) => p.returnPct) });
    periods.push({ id: r.id, startDate: r.startDate, endDate: r.endDate, dataVersion: r.dataVersion, models, stats: r.stats });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  // Every strategy's average across periods, and how often it beat the S&P 500 and the random average.
  const strategies = [
    { key: "user", label: "You", returns: periods.map((p) => p.stats.user) },
    { key: "gemini", label: "Gemini (average run)", returns: periods.map((p) => p.stats.gemini.mean) },
    { key: "random", label: "Random (average run)", returns: periods.map((p) => p.stats.random.mean) },
    ...RULES.map((rule) => ({
      key: rule.key,
      label: rule.label,
      returns: periods.map((p) => p.stats.rules.find((r) => r.strategy === rule.key)?.returnPct ?? NaN),
    })),
    // Each Gemini persona's average run, in simulations that had personas.
    ...PERSONAS.map((persona) => ({
      key: `gemini:${persona.key}`,
      label: `Gemini · ${persona.label}`,
      returns: periods.map((p) => {
        const g = p.stats.personas.find((x) => x.persona === persona.key);
        return g?.count ? g.mean : NaN;
      }),
    })),
  ].map((s) => {
    const ok = s.returns.map((r, i) => ({ r, p: periods[i] })).filter((x) => Number.isFinite(x.r));
    return {
      key: s.key,
      label: s.label,
      periods: ok.length,
      mean: mean(ok.map((x) => x.r)),
      beatBenchmark: ok.filter((x) => x.p.stats.benchmark != null && x.r > x.p.stats.benchmark).length,
      beatRandom: ok.filter((x) => x.r > x.p.stats.random.mean).length,
    };
  });
  return {
    periods,
    strategies,
    pooled: {
      count: periods.length,
      user: mean(periods.map((p) => p.stats.user)),
      benchmark: mean(periods.map((p) => p.stats.benchmark ?? 0)),
      gemini: mean(periods.map((p) => p.stats.gemini.mean)),
      random: mean(periods.map((p) => p.stats.random.mean)),
      /** Average over periods of (Gemini mean - random mean), in percentage points. */
      meanDiff: mean(periods.map((p) => p.stats.geminiVsRandom.meanDiff)),
      geminiAhead: periods.filter((p) => p.stats.geminiVsRandom.meanDiff > 0).length,
      userAheadOfGemini: periods.filter((p) => p.stats.user > p.stats.gemini.mean).length,
      pValue: stratifiedPermutationPValue(groups),
      /** Treats each period as one sample, so runs that made the same bet can't inflate the evidence. */
      periodPValue: signFlipPValue(periods.map((p) => p.stats.geminiVsRandom.meanDiff)),
    },
    personaTests: personaAcrossPeriods(periods),
  };
}

/**
 * Each persona across periods, one sample per period: its average run minus the random average,
 * and minus its matching rule. A sign-flip test over periods asks whether it wins consistently;
 * with k periods the smallest possible p is 2 / 2^k, so a handful of periods can never be conclusive.
 */
function personaAcrossPeriods(periods: { stats: SimStats }[]) {
  const rows = PERSONAS.map((persona) => {
    const per = periods
      .map((p) => ({ p, g: p.stats.personas.find((x) => x.persona === persona.key) }))
      .filter((x) => x.g?.count)
      .map(({ p, g }) => {
        const rule = p.stats.rules.find((r) => r.strategy === persona.key)?.returnPct;
        return { mean: g!.mean, vsRandom: g!.mean - p.stats.random.mean, vsRule: rule == null ? null : g!.mean - rule };
      });
    const vsRule = per.map((x) => x.vsRule).filter((v): v is number => v != null);
    return {
      persona: persona.key,
      periods: per.length,
      mean: per.length ? per.reduce((s, x) => s + x.mean, 0) / per.length : 0,
      winsVsRandom: per.filter((x) => x.vsRandom > 0).length,
      winsVsRule: vsRule.filter((v) => v > 0).length,
      ruleComparable: vsRule.length,
      pVsRandom: per.length ? signFlipPValue(per.map((x) => x.vsRandom)) : null,
      pVsRule: vsRule.length ? signFlipPValue(vsRule) : null,
      /** The best p this many periods could ever give. */
      minPossibleP: per.length ? Math.min(1, 2 / 2 ** per.length) : 1,
      adjVsRandom: null as number | null,
      adjVsRule: null as number | null,
    };
  }).filter((r) => r.periods > 0);
  const adjRandom = holm(rows.map((r) => r.pVsRandom));
  const adjRule = holm(rows.map((r) => r.pVsRule));
  rows.forEach((r, i) => {
    r.adjVsRandom = adjRandom[i];
    r.adjVsRule = adjRule[i];
  });
  return rows;
}
