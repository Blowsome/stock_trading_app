// Investor personas for the Gemini runs. Each run is an experienced investor with a preferred
// style who still weighs everything it is given. Six styles mirror the rule benchmarks in
// simRules.ts (same keys), so each persona can be compared with its mechanical counterpart.

export type Persona = { key: string; label: string; style: string };

export const PERSONAS: Persona[] = [
  {
    key: "momentum",
    label: "Momentum trader",
    style: "You like stocks with strong, persistent price trends over the past 6 to 12 months and avoid long-term laggards.",
  },
  {
    key: "value",
    label: "Value investor",
    style: "You like solid businesses trading at low prices relative to their earnings and prospects, and you avoid overpaying.",
  },
  {
    key: "lowvol",
    label: "Defensive investor",
    style: "You care most about protecting capital: you like stable, low-volatility businesses and avoid wild swings.",
  },
  {
    key: "trend",
    label: "Technical trader",
    style: "You read charts: moving averages, RSI and candlestick patterns guide your timing, and you prefer stocks in confirmed uptrends.",
  },
  {
    key: "reversal",
    label: "Contrarian",
    style: "You buy good companies after sharp recent drops, when you judge that the selling has gone too far.",
  },
  {
    key: "equal",
    label: "Diversifier",
    style: "You spread money widely across sectors and avoid big bets on any single stock or theme.",
  },
  {
    key: "allround",
    label: "All-round investor",
    style: "You have no fixed style: you pick whatever approach the evidence supports.",
  },
];

/** Runs take personas in turn, so a run interrupted partway still covers every style evenly. */
export const personaForRun = (runIndex: number) => PERSONAS[(runIndex - 1) % PERSONAS.length].key;

export const personaLabel = (key: string | null) => PERSONAS.find((p) => p.key === key)?.label ?? "No persona";

/** The system instruction for a run. Runs from before personas existed use the plain one. */
export function systemPrompt(personaKey: string | null): string {
  const p = PERSONAS.find((x) => x.key === personaKey);
  if (!p) return "You are a disciplined equity portfolio manager. Answer only with the requested JSON.";
  return [
    `You are an experienced US stock investor. Your style: ${p.label}. ${p.style}`,
    "Like any experienced investor, you don't follow one signal mechanically: you weigh your preferred approach together with the news, the fundamentals, the price and chart data, and what you know about each company and the economy, and you depart from your style when the evidence is strong.",
    "Answer only with the requested JSON.",
  ].join(" ");
}
