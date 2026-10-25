import { SIM_SLICE } from "@/lib/sim";

// Well-known rule-based strategies, used as benchmarks next to Gemini and random picks.
// Each picks from the same stock list with data known at the start date, in equal dollar amounts.

export type Signals = {
  symbol: string;
  etf: boolean;
  price: number;
  /** Percent returns up to the start date. */
  ret1m: number | null;
  ret12m: number | null;
  pe: number | null;
  /** Annualized volatility, percent. */
  vol: number | null;
  ma50: number | null;
  ma200: number | null;
};

const TOP_N = 10;

type Rule = { key: string; label: string; description: string; pick: (s: Signals[]) => string[] };

const stocks = (s: Signals[]) => s.filter((x) => !x.etf);
const top = (s: Signals[], score: (x: Signals) => number | null, dir: "high" | "low", n = TOP_N) =>
  s
    .map((x) => ({ x, v: score(x) }))
    .filter((e): e is { x: Signals; v: number } => e.v != null && Number.isFinite(e.v))
    .sort((a, b) => (dir === "high" ? b.v - a.v : a.v - b.v))
    .slice(0, n)
    .map((e) => e.x.symbol);

export const RULES: Rule[] = [
  {
    key: "momentum",
    label: "Momentum (12-1)",
    description: "The 10 stocks with the best return over the past 12 months, skipping the latest month (Jegadeesh & Titman).",
    pick: (s) =>
      top(stocks(s), (x) => (x.ret12m == null || x.ret1m == null ? null : ((1 + x.ret12m / 100) / (1 + x.ret1m / 100) - 1) * 100), "high"),
  },
  {
    key: "value",
    label: "Value (low P/E)",
    description: "The 10 stocks with the lowest positive trailing P/E (Graham-style value).",
    pick: (s) => top(stocks(s).filter((x) => x.pe != null && x.pe > 0), (x) => x.pe, "low"),
  },
  {
    key: "lowvol",
    label: "Low volatility",
    description: "The 10 stocks whose prices moved least over the past year (the low-volatility anomaly).",
    pick: (s) => top(stocks(s), (x) => x.vol, "low"),
  },
  {
    key: "trend",
    label: "Trend (golden cross)",
    description: "Every stock trading above its 200-day average with its 50-day average above the 200-day (a classic chart rule).",
    pick: (s) => stocks(s).filter((x) => x.ma50 != null && x.ma200 != null && x.ma50 > x.ma200 && x.price > x.ma200).map((x) => x.symbol),
  },
  {
    key: "reversal",
    label: "Buy the dip",
    description: "The 10 stocks that fell most over the past month, betting on a rebound (short-term reversal).",
    pick: (s) => top(stocks(s), (x) => x.ret1m, "low"),
  },
  {
    key: "equal",
    label: "Equal weight (1/N)",
    description: "Every stock in the list, equal amounts (DeMiguel et al.: hard to beat).",
    pick: (s) => stocks(s).map((x) => x.symbol),
  },
];

export const ruleLabel = (key: string | null) => RULES.find((r) => r.key === key)?.label ?? key ?? "Rule";

/** Splits the budget equally across the symbols; an empty pick stays in cash. */
export function equalWeight(symbols: string[], budget = SIM_SLICE) {
  if (!symbols.length) return [];
  const each = Math.floor((budget / symbols.length) * 100) / 100;
  return [...symbols].sort().map((symbol) => ({ symbol, dollars: each }));
}
