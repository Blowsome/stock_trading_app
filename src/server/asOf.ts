import { isCrypto } from "@/lib/assets";
import { SIM_MONTHS, SIM_WINDOWS } from "@/lib/sim";
import { getMetrics, type KeyStats, type Quote, type SeriesPoint } from "./finnhub";
import type { NewsItem } from "./news";
import { candlestickPatterns, lastChanges, rsi, sma, volatility } from "./technicals";
import { getDailyBars, type Bar } from "./yahoo";

// Market data "as of" a past trading day, built only from what was known on that day.

/** Quarters only count once results were likely public, about 45 days after the quarter ends. */
const REPORTING_LAG_DAYS = 45;

const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

/** `months` calendar months before `now`, as YYYY-MM-DD, clamped to the end of shorter months. */
export function monthsBefore(now: Date, months: number): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(now.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

/** The last trading day on or before `ymd`. */
async function tradingDayOnOrBefore(ymd: string): Promise<string> {
  const bars = (await getDailyBars("SPY")).filter((b) => b.date <= ymd);
  if (!bars.length) throw new Error(`No market data on or before ${ymd}`);
  return bars[bars.length - 1].date;
}

/** One simulation period: buy at the close on `start`, value at the close on `end` (null: the latest price). */
export type SimWindow = { index: number; start: string; end: string | null };

/**
 * Back-to-back SIM_MONTHS-long windows going back from today, newest first. They don't overlap,
 * so each one is an independent test period.
 */
export async function simWindows(now = new Date()): Promise<SimWindow[]> {
  return Promise.all(
    Array.from({ length: SIM_WINDOWS }, async (_, index) => ({
      index,
      start: await tradingDayOnOrBefore(monthsBefore(now, SIM_MONTHS * (index + 1))),
      end: index === 0 ? null : await tradingDayOnOrBefore(monthsBefore(now, SIM_MONTHS * index)),
    })),
  );
}

/** Daily bars up to and including `date`. */
export async function barsUntil(symbol: string, date: string): Promise<Bar[]> {
  return (await getDailyBars(symbol)).filter((b) => b.date <= date);
}

/** The close on `date` (or the last trading day before it), or null for symbols with no data. */
export async function asOfPrice(symbol: string, date: string): Promise<number | null> {
  const bars = await barsUntil(symbol, date).catch(() => []);
  return bars.length ? bars[bars.length - 1].close : null;
}

/** The latest close, used to value positions at the reveal. */
export async function latestPrice(symbol: string): Promise<number | null> {
  const bars = await getDailyBars(symbol).catch(() => []);
  return bars.length ? bars[bars.length - 1].close : null;
}

export async function asOfQuote(symbol: string, date: string): Promise<Quote | null> {
  const bars = await barsUntil(symbol, date);
  const bar = bars[bars.length - 1];
  if (!bar) return null;
  const prevClose = bars[bars.length - 2]?.close ?? bar.open;
  return {
    price: bar.close,
    change: bar.close - prevClose,
    changePct: prevClose ? ((bar.close - prevClose) / prevClose) * 100 : 0,
    high: bar.high,
    low: bar.low,
    open: bar.open,
    prevClose,
    time: bar.time,
  };
}

/** Percent change from the close `days` calendar days before the last bar. */
function trailingReturn(bars: Bar[], days: number): number | null {
  const last = bars[bars.length - 1];
  if (!last) return null;
  const from = addDays(last.date, -days);
  const base = [...bars].reverse().find((b) => b.date <= from);
  return base ? ((last.close - base.close) / base.close) * 100 : null;
}

function beta(bars: Bar[], market: Bar[]): number | null {
  const m = new Map(market.map((b) => [b.date, b.close]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const m0 = m.get(bars[i - 1].date);
    const m1 = m.get(bars[i].date);
    if (!m0 || !m1) continue;
    ys.push(bars[i].close / bars[i - 1].close - 1);
    xs.push(m1 / m0 - 1);
  }
  if (xs.length < 60) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varX += (xs[i] - mx) ** 2;
  }
  return varX ? cov / varX : null;
}

/**
 * Trailing P/E on `date`: the price over the TTM EPS of the last quarter reported by then.
 * Finnhub's quarterly peTTM is measured at the quarter-end price, so EPS = quarter-end close / peTTM.
 */
export function peAsOf(peSeries: SeriesPoint[], bars: Bar[], date: string): number | null {
  const reported = peSeries
    .filter((p) => addDays(p.period, REPORTING_LAG_DAYS) <= date && p.v > 0)
    .sort((a, b) => b.period.localeCompare(a.period))[0];
  const price = bars[bars.length - 1]?.close;
  if (!reported || !price) return null;
  const quarterClose = [...bars].reverse().find((b) => b.date <= reported.period)?.close;
  if (!quarterClose) return null;
  return price / (quarterClose / reported.v);
}

/** Key statistics as they stood on `date`. */
export async function asOfStats(symbol: string, date: string, metrics?: Awaited<ReturnType<typeof getMetrics>>): Promise<KeyStats> {
  const [bars, market] = await Promise.all([barsUntil(symbol, date), symbol === "SPY" || isCrypto(symbol) ? [] : barsUntil("SPY", date)]);
  const yearAgo = addDays(date, -365);
  const year = bars.filter((b) => b.date > yearAgo);
  const recent = bars.slice(-10);
  let pe: number | null = null;
  if (!isCrypto(symbol)) {
    const m = metrics ?? (await getMetrics(symbol).catch(() => null));
    pe = peAsOf(m?.series?.quarterly?.peTTM ?? [], bars, date);
  }
  return {
    high52: year.length ? Math.max(...year.map((b) => b.high)) : null,
    low52: year.length ? Math.min(...year.map((b) => b.low)) : null,
    peRatio: pe,
    dividendYield: null,
    avgVolume: recent.length ? recent.reduce((s, b) => s + b.volume, 0) / recent.length : null,
    beta: symbol === "SPY" ? 1 : beta(year, market),
  };
}

export type UniverseRow = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  /** Trailing returns in percent up to the start date. */
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret12m: number | null;
  high52: number | null;
  low52: number | null;
  pe: number | null;
  beta: number | null;
  /** Data version 2 only: technical and candlestick data, and news known before the close. */
  ma50Pct?: number | null;
  ma200Pct?: number | null;
  rsi14?: number | null;
  vol?: number | null;
  last5?: number[];
  patterns?: string[];
  news?: NewsItem[];
};

/**
 * One stock's row as of `date`. Passing `news` (even empty) builds a version-2 row with
 * technical, candlestick and news data as well.
 */
export async function universeRow(
  stock: { symbol: string; name: string; sector: string; etf?: boolean },
  date: string,
  metrics: Awaited<ReturnType<typeof getMetrics>> | null,
  news?: NewsItem[],
): Promise<UniverseRow | null> {
  const bars = await barsUntil(stock.symbol, date);
  if (!bars.length) return null;
  const stats = await asOfStats(stock.symbol, date, metrics ?? {});
  const round = (v: number | null, dp = 2) => (v == null ? null : Number(v.toFixed(dp)));
  return {
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    price: round(bars[bars.length - 1].close)!,
    ret1m: round(trailingReturn(bars, 30), 1),
    ret3m: round(trailingReturn(bars, 91), 1),
    ret6m: round(trailingReturn(bars, 182), 1),
    ret12m: round(trailingReturn(bars, 365), 1),
    high52: round(stats.high52),
    low52: round(stats.low52),
    pe: round(stats.peRatio, 1),
    beta: round(stats.beta),
    ...(news && technicalFields(bars, round)),
    ...(news && { news }),
  };
}

function technicalFields(bars: Bar[], round: (v: number | null, dp?: number) => number | null) {
  const price = bars[bars.length - 1].close;
  const vs = (ma: number | null) => (ma == null ? null : round((price / ma - 1) * 100, 1));
  return {
    ma50Pct: vs(sma(bars, 50)),
    ma200Pct: vs(sma(bars, 200)),
    rsi14: round(rsi(bars), 0),
    vol: round(volatility(bars), 0),
    last5: lastChanges(bars),
    patterns: candlestickPatterns(bars),
  };
}

const RANGE_DAYS: Record<string, number> = { "1D": 30, "1W": 7, "1M": 30, "3M": 91, "1Y": 365, "5Y": 5 * 366 };

/**
 * Chart points ending at `date`, from daily bars. Intraday data doesn't reach back that far,
 * so "1D" (used by the list sparklines) is the month before.
 */
export async function asOfHistory(symbol: string, date: string, range: string) {
  const from = addDays(date, -(RANGE_DAYS[range] ?? 30));
  const bars = (await barsUntil(symbol, date)).filter((b) => b.date >= from);
  return { points: bars.map((b) => ({ time: b.time, value: b.close })), prevClose: null };
}
