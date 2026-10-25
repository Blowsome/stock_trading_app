import { z } from "zod";
import { SIM_MONTHS } from "@/lib/sim";
import type { UniverseRow } from "./asOf";
import { systemPrompt } from "./personas";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Free-tier models to try, in order. Each has its own quota, so when one is rate limited,
 * overloaded or retired the next one takes over. GEMINI_MODELS replaces this list and
 * GEMINI_MODEL, if set, is tried first.
 */
export const DEFAULT_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.7-flash",
];

const REQUEST_TIMEOUT_MS = 180_000;
const OVERLOAD_COOLDOWN_MS = 30_000;
/** Wait this long at most for a cooled-down model before giving up on the run for now. */
const MAX_WAIT_MS = 90_000;
/** Give up on one decision after this long, even if models keep coming back. */
const DECISION_DEADLINE_MS = 10 * 60_000;

export const Decision = z.object({
  reasoning: z.string(),
  allocations: z.array(z.object({ symbol: z.string(), dollars: z.number() })),
});
export type Decision = z.infer<typeof Decision>;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reasoning: { type: "STRING", description: "Two to five sentences on why you chose this portfolio." },
    allocations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { symbol: { type: "STRING" }, dollars: { type: "NUMBER" } },
        required: ["symbol", "dollars"],
      },
    },
  },
  required: ["reasoning", "allocations"],
};

const fmt = (v: number | null, suffix = "") => (v == null ? "n/a" : `${v}${suffix}`);

export function buildPrompt(universe: UniverseRow[], date: string, budget: number) {
  // Version-2 universes also carry technical, candlestick and news data.
  const extended = universe.some((r) => r.rsi14 !== undefined);
  const signed = (v: number | null | undefined) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);
  const rows = universe.map((r) => {
    const base = `${r.symbol} | ${r.name} | ${r.sector} | $${r.price} | ${fmt(r.ret1m, "%")} | ${fmt(r.ret3m, "%")} | ${fmt(r.ret6m, "%")} | ${fmt(r.ret12m, "%")} | ${fmt(r.low52)}-${fmt(r.high52)} | ${fmt(r.pe)} | ${fmt(r.beta)}`;
    if (!extended) return base;
    const candles = r.patterns?.length ? r.patterns.join(", ") : "none";
    return `${base} | ${signed(r.ma50Pct)} | ${signed(r.ma200Pct)} | ${fmt(r.rsi14 ?? null)} | ${fmt(r.vol ?? null, "%")} | ${(r.last5 ?? []).map((v) => signed(v)).join(" ")} | ${candles}`;
  });
  const lines = [
    `Today is ${date}. You manage $${budget.toLocaleString("en-US")} of cash in a US stock account.`,
    `Build a portfolio from the stocks below. You buy at today's closing price and hold for ${SIM_MONTHS} months with no further trades.`,
    `Use the data below and your own knowledge of these companies, the economy and markets as of ${date}. Do not use any knowledge of events after ${date}.`,
    `Rules: use only symbols from the table; allocations are in dollars and must add up to at most $${budget}; any amount not allocated stays as cash. Fractional shares are allowed.`,
    "",
    `Symbol | Name | Sector | Price | 1M return | 3M return | 6M return | 12M return | 52-week range | Trailing P/E | Beta${
      extended ? " | vs 50-day avg | vs 200-day avg | RSI(14) | Volatility (1y, annualized) | Last 5 daily changes | Candlestick pattern (latest)" : ""
    }`,
    ...rows,
  ];
  const news = universe.filter((r) => r.news?.length);
  if (extended && news.length) {
    lines.push("", `Recent news (all published before the ${date} market close, newest first):`);
    for (const r of news) {
      lines.push(`${r.symbol}:`);
      for (const n of r.news!) lines.push(`- ${n.time.slice(0, 10)} (${n.source}) ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`);
    }
  }
  return lines.join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every model is out of quota or unavailable. The run should wait and be retried later. */
export class GeminiQuotaError extends Error {}

export function geminiModels(): string[] {
  const list = (process.env.GEMINI_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const first = process.env.GEMINI_MODEL?.trim();
  return [...new Set([...(first ? [first] : []), ...(list.length ? list : DEFAULT_MODELS)])];
}

// Shared by all runs in this process, so one run's rate limit steers the others too.
const g = globalThis as unknown as { __gemCooldown?: Map<string, number>; __gemDisabled?: Map<string, string> };
const cooldown = (g.__gemCooldown ??= new Map<string, number>());
const disabled = (g.__gemDisabled ??= new Map<string, string>());

/** Milliseconds until the next midnight in Pacific time, when daily quotas reset. */
function untilPacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  return (86400 - (parts.hour * 3600 + parts.minute * 60 + parts.second)) * 1000;
}

type ErrorDetail = { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] };

/** How long a rate-limited model should rest: its retry hint, or until midnight PT for a daily quota. */
function quotaCooldown(details: ErrorDetail[]) {
  const daily = details.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
  if (daily) return untilPacificMidnight();
  const hint = details.find((d) => d.retryDelay)?.retryDelay;
  const seconds = hint ? parseFloat(hint) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 + 1000 : 60_000;
}

/**
 * Asks Gemini for one buy-and-hold portfolio as the given persona (see personas.ts), falling back
 * across models. Each call is an independent sample.
 */
export async function geminiDecide(
  universe: UniverseRow[],
  date: string,
  budget: number,
  persona: string | null = null,
): Promise<Decision & { model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  const models = geminiModels();
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(persona) }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt(universe, date, budget) }] }],
    generationConfig: { temperature: 1, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });
  const deadline = Date.now() + DECISION_DEADLINE_MS;

  for (;;) {
    const now = Date.now();
    const usable = models.filter((m) => !disabled.has(m));
    if (!usable.length) {
      throw new GeminiQuotaError(`None of the Gemini models are available to this key (${[...disabled].map(([m, why]) => `${m}: ${why}`).join("; ")})`);
    }
    const ready = usable.filter((m) => (cooldown.get(m) ?? 0) <= now);
    if (!ready.length) {
      const wait = Math.min(...usable.map((m) => cooldown.get(m)!)) - now;
      if (wait > MAX_WAIT_MS || now + wait > deadline) {
        throw new GeminiQuotaError(
          `Every Gemini model is out of free quota or overloaded right now (${usable.join(", ")}). Press Retry later; daily limits reset at midnight Pacific time.`,
        );
      }
      await sleep(wait);
      continue;
    }

    const model = ready[0];
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Timed out or the connection dropped: treat it like an overloaded model.
      cooldown.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
      continue;
    }
    if (res.status === 429 || res.status >= 500 || res.status === 404) {
      const err = await res.json().catch(() => null);
      if (res.status === 404) disabled.set(model, err?.error?.message?.split(".")[0] ?? "not found");
      else if (res.status === 429) cooldown.set(model, Date.now() + quotaCooldown(err?.error?.details ?? []));
      else cooldown.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(`Gemini request failed (${res.status}): ${err?.error?.message ?? res.statusText}`);
    }
    const data = await res.json();
    const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    if (!text) throw new Error(`${model} returned no answer (${data?.candidates?.[0]?.finishReason ?? "unknown reason"})`);
    return { ...Decision.parse(JSON.parse(text)), model };
  }
}
