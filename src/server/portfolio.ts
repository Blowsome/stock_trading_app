import { prisma, D } from "./db";
import { getMarketStatus, getProfile, getQuote } from "./finnhub";
import { priceHub } from "./priceHub";
import { CRYPTO } from "@/lib/assets";
import { startOfDayET } from "@/lib/time";
import { buyingPower } from "./trading";

export type PositionView = {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  price: number;
  prevClose: number;
  /**
   * Value the day's change is measured against: shares held since yesterday at
   * the previous close, shares bought today at their fill price. Day change = quantity * price - dayBase.
   */
  dayBase: number;
};

export type PortfolioView = {
  cash: number;
  buyingPower: number;
  positions: PositionView[];
  /** Day P&L from positions that were fully closed today. */
  closedDayChange: number;
  watchlist: { symbol: string; price: number; prevClose: number }[];
};

async function priceAndPrevClose(symbol: string) {
  const q = await getQuote(symbol, 60_000).catch(() => null);
  const live = priceHub.peek(symbol);
  const fresh = live && Date.now() - live.time < 60_000;
  const price = fresh ? live.price : (q?.price ?? live?.price ?? 0);
  return { price, prevClose: q?.prevClose ?? price };
}

export async function getPortfolio(userId: string): Promise<PortfolioView> {
  const [positions, watch, fills, bp, user] = await Promise.all([
    prisma.position.findMany({ where: { userId }, orderBy: { symbol: "asc" } }),
    prisma.watchlistItem.findMany({ where: { userId }, orderBy: { addedAt: "asc" } }),
    prisma.order.findMany({ where: { userId, status: "FILLED", filledAt: { gte: startOfDayET() } } }),
    prisma.$transaction((tx) => buyingPower(tx, userId)),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);

  const symbols = [...new Set([...positions.map((p) => p.symbol), ...watch.map((w) => w.symbol), ...fills.map((f) => f.symbol)])];
  const prices = new Map(await Promise.all(symbols.map(async (s) => [s, await priceAndPrevClose(s)] as const)));

  // Today's fills shift the day baseline: a buy at p adds q*(p - prevClose), a sell subtracts it.
  const adjust = new Map<string, number>();
  for (const f of fills) {
    const pc = prices.get(f.symbol)!.prevClose;
    const delta = f.quantity.toNumber() * (f.fillPrice!.toNumber() - pc) * (f.side === "BUY" ? 1 : -1);
    adjust.set(f.symbol, (adjust.get(f.symbol) ?? 0) + delta);
  }

  const held = new Set(positions.map((p) => p.symbol));
  let closedDayChange = 0;
  for (const [symbol, a] of adjust) if (!held.has(symbol)) closedDayChange -= a;

  const views = await Promise.all(
    positions.map(async (p): Promise<PositionView> => {
      const { price, prevClose } = prices.get(p.symbol)!;
      const quantity = p.quantity.toNumber();
      const profile = await getProfile(p.symbol).catch(() => null);
      return {
        symbol: p.symbol,
        name: profile?.name ?? null,
        quantity,
        avgCost: p.avgCost.toNumber(),
        price,
        prevClose,
        dayBase: quantity * prevClose + (adjust.get(p.symbol) ?? 0),
      };
    }),
  );

  return {
    cash: user.cash.toNumber(),
    buyingPower: bp.toNumber(),
    positions: views,
    closedDayChange,
    watchlist: watch.map((w) => ({ symbol: w.symbol, ...prices.get(w.symbol)! })),
  };
}

export async function totalValue(userId: string): Promise<number> {
  const [user, positions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.position.findMany({ where: { userId } }),
  ]);
  let total = user.cash;
  for (const p of positions) {
    const price = (await priceHub.getPrice(p.symbol)) ?? p.avgCost.toNumber();
    total = total.plus(p.quantity.times(price));
  }
  return total.toDecimalPlaces(2).toNumber();
}

export async function recordSnapshot(userId: string) {
  const value = await totalValue(userId);
  await prisma.portfolioSnapshot.create({ data: { userId, totalValue: new D(value) } });
}

/** Snapshots every user with positions that are trading now: everything while the market is open, crypto holders always. */
export async function snapshotAll() {
  const status = await getMarketStatus().catch(() => null);
  const where = status?.isOpen ? {} : { symbol: { in: Object.keys(CRYPTO) } };
  const users = await prisma.position.findMany({ where, select: { userId: true }, distinct: ["userId"] });
  for (const { userId } of users) {
    await recordSnapshot(userId).catch((e) => console.error("[snapshot]", e));
  }
}

const RANGE_MS: Record<string, number> = {
  "1D": 86400_000,
  "1W": 7 * 86400_000,
  "1M": 30 * 86400_000,
  "3M": 90 * 86400_000,
  "1Y": 365 * 86400_000,
};

export async function portfolioHistory(userId: string, range: string) {
  const ms = RANGE_MS[range];
  const since = ms ? new Date(Date.now() - ms) : new Date(0);
  const [before, rows] = await Promise.all([
    prisma.portfolioSnapshot.findFirst({ where: { userId, timestamp: { lt: since } }, orderBy: { timestamp: "desc" } }),
    prisma.portfolioSnapshot.findMany({ where: { userId, timestamp: { gte: since } }, orderBy: { timestamp: "asc" } }),
  ]);
  const points: { time: number; value: number }[] = [];
  if (before) points.push({ time: Math.floor(since.getTime() / 1000), value: before.totalValue.toNumber() });
  for (const r of rows) {
    const point = { time: Math.floor(r.timestamp.getTime() / 1000), value: r.totalValue.toNumber() };
    // Several snapshots can land in the same second (e.g. back-to-back trades); keep the latest.
    if (points.length && points[points.length - 1].time >= point.time) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}
