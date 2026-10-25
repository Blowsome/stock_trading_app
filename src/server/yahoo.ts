import { CRYPTO } from "@/lib/assets";

// Price history comes from Yahoo's public chart endpoint because Finnhub's free
// tier does not include candles. It is unofficial and may change without notice.

export const RANGES = ["1D", "1W", "1M", "3M", "1Y", "5Y"] as const;
export type Range = (typeof RANGES)[number];

const PARAMS: Record<Range, { range: string; interval: string; ttl: number }> = {
  "1D": { range: "1d", interval: "5m", ttl: 60_000 },
  "1W": { range: "5d", interval: "15m", ttl: 5 * 60_000 },
  "1M": { range: "1mo", interval: "60m", ttl: 15 * 60_000 },
  "3M": { range: "3mo", interval: "1d", ttl: 60 * 60_000 },
  "1Y": { range: "1y", interval: "1d", ttl: 60 * 60_000 },
  "5Y": { range: "5y", interval: "1wk", ttl: 6 * 60 * 60_000 },
};

export type History = { points: { time: number; value: number }[]; prevClose: number | null };

const g = globalThis as unknown as { __yhCache?: Map<string, { value: History; expires: number }> };
const cache = (g.__yhCache ??= new Map());

export async function getHistory(symbol: string, range: Range): Promise<History> {
  const key = `${symbol}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const crypto = CRYPTO[symbol];
  const { interval, ttl } = PARAMS[range];
  // Crypto never closes, so its 1D view is the last 24 hours rather than one session.
  const r = crypto && range === "1D" ? "2d" : PARAMS[range].range;
  const since = crypto && range === "1D" ? Date.now() / 1000 - 86400 : 0;
  const ySymbol = crypto?.yahoo ?? symbol.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=${r}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!res.ok) {
    if (hit) return hit.value;
    throw new Error(`History unavailable (${res.status})`);
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const ts: number[] = result?.timestamp ?? [];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  const points: History["points"] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v) || ts[i] < since) continue;
    if (points.length && ts[i] <= points[points.length - 1].time) continue;
    points.push({ time: ts[i], value: v });
  }
  const meta = result?.meta ?? {};
  const prevClose = range === "1D" ? (meta.chartPreviousClose ?? meta.previousClose ?? null) : null;
  const value = { points, prevClose };
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

export type Bar = { time: number; date: string; open: number; high: number; low: number; close: number; volume: number };

const dailyCache = ((globalThis as unknown as { __yhDaily?: Map<string, { value: Bar[]; expires: number }> }).__yhDaily ??= new Map());
const DAILY_TTL = 30 * 60_000;

/** Five years of daily bars, oldest first. `date` is the trading day as YYYY-MM-DD. */
export async function getDailyBars(symbol: string): Promise<Bar[]> {
  const hit = dailyCache.get(symbol);
  if (hit && hit.expires > Date.now()) return hit.value;
  const ySymbol = CRYPTO[symbol]?.yahoo ?? symbol.replace(/\./g, "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=5y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!res.ok) {
    if (hit) return hit.value;
    throw new Error(`History unavailable (${res.status})`);
  }
  const result = (await res.json())?.chart?.result?.[0];
  const ts: number[] = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  // Daily bars are stamped at the session open, so the UTC date in the exchange's offset is the trading day.
  const offset: number = result?.meta?.gmtoffset ?? 0;
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    const date = new Date((ts[i] + offset) * 1000).toISOString().slice(0, 10);
    if (bars.length && bars[bars.length - 1].date === date) bars.pop();
    bars.push({
      time: ts[i],
      date,
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  dailyCache.set(symbol, { value: bars, expires: Date.now() + DAILY_TTL });
  return bars;
}
