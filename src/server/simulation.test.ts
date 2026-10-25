import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./priceHub", () => ({
  priceHub: { getPrice: vi.fn(), setPinned: vi.fn(), peek: vi.fn() },
}));

const ENTRY: Record<string, number> = { AAPL: 100, SPY: 100 };
const EXIT: Record<string, number> = { AAPL: 110, SPY: 105 };
// Closes at the end of the earlier, already-finished window.
const PAST_END = "2026-04-24";
const AT_PAST_END: Record<string, number> = { AAPL: 120, SPY: 90 };

vi.mock("./asOf", () => ({
  simWindows: async () => [
    { index: 0, start: "2026-07-23", end: null },
    { index: 1, start: "2026-01-23", end: PAST_END },
  ],
  asOfPrice: async (s: string, date: string) => (date === PAST_END ? (AT_PAST_END[s] ?? 40) : (ENTRY[s] ?? 50)),
  latestPrice: async (s: string) => EXIT[s] ?? 50,
  barsUntil: async () => [],
  asOfQuote: async (s: string) => ({ price: ENTRY[s] ?? 50, prevClose: ENTRY[s] ?? 50 }),
  universeRow: async (stock: { symbol: string; name: string; sector: string }) => ({
    ...stock,
    price: ENTRY[stock.symbol] ?? 50,
    ret1m: 1, ret3m: 2, ret6m: 3, ret12m: 4, high52: 120, low52: 80, pe: 20, beta: 1,
  }),
}));

vi.mock("./finnhub", () => ({ getMetrics: async () => ({}), getProfile: async () => null }));
vi.mock("./news", () => ({ newsAsOf: async () => [] }));

vi.mock("./gemini", () => ({
  GeminiQuotaError: class extends Error {},
  buildPrompt: () => "prompt",
  geminiDecide: vi.fn(async () => ({
    model: "gemini-test",
    reasoning: "Concentrate in Apple.",
    allocations: [
      { symbol: "AAPL", dollars: 10_000 },
      { symbol: "NOPE", dollars: 5_000 },
    ],
  })),
}));

process.env.SIM_CACHE_DIR = mkdtempSync(path.join(tmpdir(), "sim-cache-"));

import { prisma } from "./db";
import { GeminiQuotaError, geminiDecide } from "./gemini";
import {
  compareSimulations,
  getOrCreateSimulation,
  normalizeAllocations,
  retrySimulation,
  revealSimulation,
  simResults,
  simState,
  simStats,
  simTrade,
} from "./simulation";
import { SIM_SLICE } from "@/lib/sim";
import { TradeError } from "./trading";

describe("normalizeAllocations", () => {
  const known = new Set(["AAPL", "MSFT"]);

  it("drops unknown symbols and merges duplicates", () => {
    expect(
      normalizeAllocations(
        [
          { symbol: "aapl", dollars: 1000 },
          { symbol: "AAPL", dollars: 500 },
          { symbol: "XYZ", dollars: 900 },
          { symbol: "MSFT", dollars: -5 },
        ],
        known,
        20_000,
      ),
    ).toEqual([{ symbol: "AAPL", dollars: 1500 }]);
  });

  it("scales an over-budget answer down to the budget", () => {
    const out = normalizeAllocations(
      [
        { symbol: "AAPL", dollars: 30_000 },
        { symbol: "MSFT", dollars: 10_000 },
      ],
      known,
      20_000,
    );
    expect(out).toEqual([
      { symbol: "AAPL", dollars: 15_000 },
      { symbol: "MSFT", dollars: 5_000 },
    ]);
  });
});

describe("simStats", () => {
  it("ranks the user among Gemini runs and totals the user and Gemini slices", () => {
    const path = (kind: "USER" | "GEMINI" | "RANDOM" | "BENCHMARK", returnPct: number, error: string | null = null) => ({
      kind,
      returnPct,
      error,
      finalValue: SIM_SLICE * (1 + returnPct / 100),
    });
    const s = simStats([
      path("USER", 3),
      path("GEMINI", 1),
      path("GEMINI", 2),
      path("GEMINI", 3),
      path("GEMINI", 10),
      path("GEMINI", 0, "failed"),
      path("BENCHMARK", 2.5),
      path("RANDOM", -1),
      path("RANDOM", 4),
    ]);
    expect(s.random.count).toBe(2);
    expect(s.random.beatUser).toBe(1);
    expect(s.gemini.count).toBe(4); // the failed run is left out of Gemini's record
    expect(s.gemini.beatUser).toBe(1);
    expect(s.gemini.userPercentile).toBe(62.5); // 2 below, 1 tie counted half, of 4
    expect(s.gemini.median).toBe(2.5);
    expect(s.gemini.beatBenchmark).toBe(2);
    // ...but its cash still counts toward the combined total.
    expect(s.combined.start).toBe(6 * SIM_SLICE);
    expect(s.combined.final).toBeCloseTo(SIM_SLICE * (1.03 + 1.01 + 1.02 + 1.03 + 1.1 + 1));
  });
});

describe("simulation flow", () => {
  let userId: string;
  let simId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `${Math.random()}@test.dev`, name: "T", passwordHash: "x" } })).id;
    simId = (await getOrCreateSimulation(userId)).id;
    for (let i = 0; i < 100; i++) {
      if ((await simState(userId, simId)).status === "READY") break;
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it("runs all 49 Gemini paths and the SPY benchmark", async () => {
    const s = await simState(userId, simId);
    expect(s.status).toBe("READY");
    expect(s.geminiDone).toBe(49);
    expect(s.geminiFailed).toBe(0);
  });

  it("sends each Gemini run its own investor persona, 7 runs per style", async () => {
    const personas = vi.mocked(geminiDecide).mock.calls.map((c) => c[3]);
    for (const key of ["momentum", "value", "lowvol", "trend", "reversal", "equal", "allround"]) {
      expect(personas.filter((p) => p === key).length).toBeGreaterThanOrEqual(7);
    }
  });

  it("resumes the unfinished simulation instead of starting another", async () => {
    expect((await getOrCreateSimulation(userId)).id).toBe(simId);
  });

  it("trades the user's slice at the start-date close and enforces its cash", async () => {
    const t = await simTrade(userId, simId, { symbol: "AAPL", side: "BUY", notional: 15_000 });
    expect(t.price.toNumber()).toBe(100);
    expect(t.shares.toNumber()).toBe(150);
    await expect(simTrade(userId, simId, { symbol: "AAPL", side: "BUY", notional: 6_000 })).rejects.toThrow(TradeError);
    await expect(simTrade(userId, simId, { symbol: "AAPL", side: "SELL", quantity: 151 })).rejects.toThrow(TradeError);
    expect((await simState(userId, simId)).cash).toBe(5_000);
  });

  it("values every path at the latest price on reveal and locks the user out", async () => {
    await revealSimulation(userId, simId);
    const r = await simResults(userId, simId);
    const user = r.paths.find((p) => p.kind === "USER")!;
    const gem = r.paths.filter((p) => p.kind === "GEMINI");
    const spy = r.paths.find((p) => p.kind === "BENCHMARK")!;
    expect(user.finalValue).toBe(150 * 110 + 5_000); // +7.5%
    expect(gem).toHaveLength(49);
    expect(gem[0].finalValue).toBe(100 * 110 + 10_000); // +5%
    expect(gem[0].model).toBe("gemini-test");
    expect(spy.finalValue).toBe(200 * 105); // +5%
    expect(r.stats.gemini.beatUser).toBe(0);
    expect(r.stats.gemini.userPercentile).toBe(100);
    // 49 random portfolios, valued like everything else; they don't count toward the $1M.
    const random = r.paths.filter((p) => p.kind === "RANDOM");
    expect(random).toHaveLength(49);
    expect(r.stats.random.count).toBe(49);
    // Six rule benchmarks; the equal-weight rule holds every stock in the list.
    expect(r.stats.rules.map((x) => x.strategy)).toEqual(["momentum", "value", "lowvol", "trend", "reversal", "equal"]);
    // Gemini runs grouped by persona, 7 per style.
    expect(r.stats.personas.map((g) => [g.persona, g.count])).toEqual(
      ["momentum", "value", "lowvol", "trend", "reversal", "equal", "allround"].map((k) => [k, 7]),
    );
    const equal = r.paths.find((p) => p.kind === "RULE" && p.strategy === "equal")!;
    expect(equal.holdings.length).toBe(41); // 43 symbols minus SPY and QQQ
    for (const p of random) {
      expect(p.holdings.length).toBeGreaterThanOrEqual(3);
      expect(p.holdings.length).toBeLessThanOrEqual(8);
      const value = p.cash + p.holdings.reduce((s, h) => s + h.shares * h.exitPrice, 0);
      expect(p.finalValue).toBeCloseTo(value, 1);
    }
    expect(r.stats.combined.final).toBe(21_500 + 49 * 21_000);
    await expect(simTrade(userId, simId, { symbol: "AAPL", side: "SELL", quantity: 1 })).rejects.toThrow(TradeError);
  });

  it("writes every decision to the cache file", () => {
    const dump = JSON.parse(readFileSync(path.join(process.env.SIM_CACHE_DIR!, `${simId}.json`), "utf8"));
    expect(dump.status).toBe("REVEALED");
    expect(dump.paths).toHaveLength(106); // you, SPY, 49 Gemini, 49 random, 6 rules
    expect(dump.paths.filter((p: { reasoning: string }) => p.reasoning === "Concentrate in Apple.")).toHaveLength(49);
    expect(dump.paths.find((p: { kind: string }) => p.kind === "USER").trades).toHaveLength(1);
  });
});

describe("running out of Gemini quota", () => {
  const waitFor = async (userId: string, simId: string, status: string) => {
    for (let i = 0; i < 100; i++) {
      if ((await simState(userId, simId)).status === status) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  it("pauses with the runs left undecided, then finishes them on retry", async () => {
    const decide = vi.mocked(geminiDecide);
    const real = decide.getMockImplementation()!;
    let calls = 0;
    // Ten runs succeed, then every model is out of quota.
    decide.mockImplementation(async (...args) => {
      if (++calls > 10) throw new GeminiQuotaError("Every Gemini model is out of free quota");
      return real(...args);
    });
    const userId = (await prisma.user.create({ data: { email: `${Math.random()}@test.dev`, name: "Q", passwordHash: "x" } })).id;
    const simId = (await getOrCreateSimulation(userId)).id;
    await waitFor(userId, simId, "FAILED");

    const paused = await simState(userId, simId);
    expect(paused.error).toMatch(/out of free quota/);
    expect(paused.geminiDone).toBe(10);
    expect(paused.geminiFailed).toBe(0); // no run was turned into cash

    decide.mockImplementation(real);
    await retrySimulation(userId, simId);
    await waitFor(userId, simId, "READY");
    const done = await simState(userId, simId);
    expect(done.geminiDone).toBe(49);
    expect(done.geminiFailed).toBe(0);
  });
});

describe("a past period", () => {
  it("values everything at the period's end, not today, and joins the cross-period comparison", async () => {
    const userId = (await prisma.user.create({ data: { email: `${Math.random()}@test.dev`, name: "P", passwordHash: "x" } })).id;
    const live = await getOrCreateSimulation(userId, 0);
    const past = await getOrCreateSimulation(userId, 1);
    expect(past.id).not.toBe(live.id); // one unfinished simulation per period
    expect(past.endDate?.toISOString().slice(0, 10)).toBe(PAST_END);
    expect((await getOrCreateSimulation(userId, 1)).id).toBe(past.id);

    for (const id of [live.id, past.id]) {
      for (let i = 0; i < 100 && (await simState(userId, id)).status !== "READY"; i++) await new Promise((r) => setTimeout(r, 50));
    }
    await simTrade(userId, past.id, { symbol: "AAPL", side: "BUY", notional: 20_000 });
    await revealSimulation(userId, past.id);
    const r = await simResults(userId, past.id);
    expect(r.endDate).toBe(PAST_END);
    expect(r.paths.find((p) => p.kind === "USER")!.finalValue).toBe(200 * 120); // the Apr 24 close, not today's 110
    expect(r.paths.find((p) => p.kind === "BENCHMARK")!.finalValue).toBe(200 * 90);

    await revealSimulation(userId, live.id);
    const c = await compareSimulations(userId);
    expect(c.periods.map((p) => p.endDate)).toContain(PAST_END);
    expect(c.pooled.count).toBe(2);
    expect(c.pooled.periodPValue).toBeGreaterThan(0);
    // Every persona was tested across both periods; two periods can never give p below 0.5.
    expect(c.personaTests).toHaveLength(7);
    for (const t of c.personaTests) {
      expect(t.periods).toBe(2);
      expect(t.minPossibleP).toBe(0.5);
      expect(t.pVsRandom!).toBeGreaterThanOrEqual(0.5);
    }
    expect(c.pooled.pValue).toBeGreaterThan(0);
    expect(c.pooled.pValue).toBeLessThanOrEqual(1);
  });
});
