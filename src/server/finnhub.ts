import { CRYPTO, isCrypto } from "@/lib/assets";

const BASE = "https://finnhub.io/api/v1";

type Entry = { value: unknown; fetchedAt: number };
const g = globalThis as unknown as { __fhCache?: Map<string, Entry>; __fhInflight?: Map<string, Promise<unknown>> };
const cache = (g.__fhCache ??= new Map());
const inflight = (g.__fhInflight ??= new Map());

export function apiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set (see .env.example)");
  return key;
}

// Our own budget, kept under Finnhub's free-tier limit of 60 calls per minute.
// FINNHUB_MAX_CALLS calls are allowed in any rolling FINNHUB_WINDOW_SECONDS window.
const MAX_CALLS = Number(process.env.FINNHUB_MAX_CALLS) || 50;
const WINDOW_MS = (Number(process.env.FINNHUB_WINDOW_SECONDS) || 60) * 1000;
const callLog: number[] = ((globalThis as unknown as { __fhCalls?: number[] }).__fhCalls ??= []);

/** Records a call if the rolling window has room; false means over budget. */
function takeCall(): boolean {
  const now = Date.now();
  while (callLog.length && now - callLog[0] >= WINDOW_MS) callLog.shift();
  if (callLog.length >= MAX_CALLS) return false;
  callLog.push(now);
  return true;
}

/** Cached, de-duplicated, budgeted GET against the Finnhub REST API. */
async function fh<T>(path: string, params: Record<string, string>, maxAgeMs: number): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${path}?${qs}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < maxAgeMs) return hit.value as T;
  const pending = inflight.get(cacheKey);
  if (pending) return pending as Promise<T>;
  if (!takeCall()) {
    // Over our budget: serve stale data rather than spend a call.
    if (hit) return hit.value as T;
    throw new Error("Market data rate limit reached, try again in a moment");
  }

  const p = (async () => {
    const res = await fetch(`${BASE}${path}?${qs}&token=${apiKey()}`, { cache: "no-store" });
    if (res.status === 429) {
      // Rate limited: serve stale data if we have it.
      if (hit) return hit.value as T;
      throw new Error("Market data rate limit reached, try again in a moment");
    }
    if (!res.ok) throw new Error(`Finnhub ${path} failed: ${res.status}`);
    const value = (await res.json()) as T;
    cache.set(cacheKey, { value, fetchedAt: Date.now() });
    return value;
  })();
  inflight.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inflight.delete(cacheKey);
  }
}

export type Quote = {
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  time: number;
};

/** Returns null for unknown symbols (Finnhub answers with all zeros). */
export async function getQuote(symbol: string, maxAgeMs = 15_000): Promise<Quote | null> {
  const q = await fh<{ c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number }>(
    "/quote",
    { symbol: CRYPTO[symbol]?.feed ?? symbol },
    maxAgeMs,
  );
  if (!q || (!q.c && !q.pc)) return null;
  return { price: q.c, change: q.d ?? 0, changePct: q.dp ?? 0, high: q.h, low: q.l, open: q.o, prevClose: q.pc, time: q.t };
}

export type Profile = {
  name: string;
  exchange: string;
  industry: string;
  logo: string;
  weburl: string;
  ipo: string;
  marketCap: number; // in USD
  country: string;
};

export async function getProfile(symbol: string): Promise<Profile | null> {
  const crypto = CRYPTO[symbol];
  if (crypto) {
    return { name: crypto.name, exchange: "Coinbase", industry: "Cryptocurrency", logo: "", weburl: "https://bitcoin.org", ipo: "", marketCap: 0, country: "" };
  }
  const p = await fh<Record<string, unknown>>("/stock/profile2", { symbol }, 24 * 3600_000);
  if (!p || !p.name) return null;
  return {
    name: String(p.name),
    exchange: String(p.exchange ?? ""),
    industry: String(p.finnhubIndustry ?? ""),
    logo: String(p.logo ?? ""),
    weburl: String(p.weburl ?? ""),
    ipo: String(p.ipo ?? ""),
    marketCap: Number(p.marketCapitalization ?? 0) * 1e6,
    country: String(p.country ?? ""),
  };
}

export type KeyStats = {
  high52: number | null;
  low52: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  avgVolume: number | null; // shares
  beta: number | null;
};

export type SeriesPoint = { period: string; v: number };
export type Metrics = {
  metric?: Record<string, number | null>;
  series?: { quarterly?: Record<string, SeriesPoint[]> };
};

/** Raw basic financials: current metrics plus quarterly history (eps, peTTM, margins...). */
export const getMetrics = (symbol: string) => fh<Metrics>("/stock/metric", { symbol, metric: "all" }, 6 * 3600_000);

export async function getKeyStats(symbol: string): Promise<KeyStats> {
  if (isCrypto(symbol)) return { high52: null, low52: null, peRatio: null, dividendYield: null, avgVolume: null, beta: null };
  const r = await getMetrics(symbol);
  const m = r?.metric ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const vol = num(m["10DayAverageTradingVolume"]);
  return {
    high52: num(m["52WeekHigh"]),
    low52: num(m["52WeekLow"]),
    peRatio: num(m["peTTM"]) ?? num(m["peBasicExclExtraTTM"]),
    dividendYield: num(m["currentDividendYieldTTM"]),
    avgVolume: vol === null ? null : vol * 1e6,
    beta: num(m["beta"]),
  };
}

export type SearchResult = { symbol: string; description: string; type: string };

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  const crypto = Object.entries(CRYPTO)
    .filter(([symbol, c]) => c.name.toLowerCase().startsWith(q) || symbol.toLowerCase().startsWith(q))
    .map(([symbol, c]) => ({ symbol, description: c.name, type: "Crypto" }));
  const r = await fh<{ result?: { symbol: string; description: string; type: string }[] }>(
    "/search",
    { q: query, exchange: "US" },
    10 * 60_000,
  );
  const stocks = (r?.result ?? [])
    .filter((x) => x.type === "Common Stock" || x.type === "ETP" || x.type === "ADR" || x.type === "REIT")
    .filter((x) => !x.symbol.includes(":"))
    .slice(0, 8)
    .map(({ symbol, description, type }) => ({ symbol, description, type }));
  return [...crypto, ...stocks].slice(0, 8);
}

export type MarketStatus = { isOpen: boolean; session: string | null; holiday: string | null };

export async function getMarketStatus(): Promise<MarketStatus> {
  const r = await fh<{ isOpen: boolean; session: string | null; holiday: string | null }>(
    "/stock/market-status",
    { exchange: "US" },
    60_000,
  );
  return { isOpen: !!r.isOpen, session: r.session ?? null, holiday: r.holiday ?? null };
}

export type RawArticle = { datetime: number; headline: string; source: string; related?: string; summary?: string };

/** Company news published between two dates. Past news doesn't change, so it is cached for a day. */
export async function getCompanyNews(symbol: string, from: string, to: string): Promise<RawArticle[]> {
  const r = await fh<RawArticle[]>("/company-news", { symbol, from, to }, 24 * 3600_000);
  return Array.isArray(r) ? r : [];
}
