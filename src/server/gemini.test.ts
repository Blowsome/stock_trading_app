import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiQuotaError, buildPrompt, geminiDecide, geminiModels } from "./gemini";

const ok = (model: string) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ reasoning: `from ${model}`, allocations: [{ symbol: "AAPL", dollars: 100 }] }) }] } }],
    }),
    { status: 200 },
  );
const err = (status: number, details: unknown[] = []) =>
  new Response(JSON.stringify({ error: { code: status, message: "nope. more", details } }), { status });
const daily = [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }];

/** Answers each model with the given responses in turn. */
function mockModels(answers: Record<string, (() => Response)[]>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const model = decodeURIComponent(String(url).match(/models\/([^:]+):/)![1]);
    calls.push(model);
    const next = answers[model]?.shift();
    if (!next) throw new Error(`unexpected call to ${model}`);
    return next();
  });
  return calls;
}

// Cooldowns are shared per process, so each test uses its own model names.
let n = 0;
const names = (...m: string[]) => m.map((x) => `${x}-${n}`);

describe("geminiDecide", () => {
  beforeEach(() => {
    n++;
    process.env.GEMINI_API_KEY = "test";
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_MODELS;
  });

  it("falls back past quota, overload and retired models", async () => {
    const [a, b, c, d] = names("a", "b", "c", "d");
    process.env.GEMINI_MODELS = [a, b, c, d].join(",");
    const calls = mockModels({ [a]: [() => err(429, daily)], [b]: [() => err(503)], [c]: [() => err(404)], [d]: [() => ok(d)] });
    const r = await geminiDecide([], "2026-07-24", 20_000);
    expect(r.model).toBe(d);
    expect(r.reasoning).toBe(`from ${d}`);
    expect(calls).toEqual([a, b, c, d]);

    // The next decision skips the models that are resting or retired.
    mockModels({ [d]: [() => ok(d)] });
    expect((await geminiDecide([], "2026-07-24", 20_000)).model).toBe(d);
  });

  it("throws a quota error when every model is out of quota", async () => {
    const [a, b] = names("a", "b");
    process.env.GEMINI_MODELS = [a, b].join(",");
    mockModels({ [a]: [() => err(429, daily)], [b]: [() => err(429, daily)] });
    await expect(geminiDecide([], "2026-07-24", 20_000)).rejects.toBeInstanceOf(GeminiQuotaError);
  });

  it("fails fast on a bad key instead of trying other models", async () => {
    const [a, b] = names("a", "b");
    process.env.GEMINI_MODELS = [a, b].join(",");
    mockModels({ [a]: [() => err(403)] });
    await expect(geminiDecide([], "2026-07-24", 20_000)).rejects.toThrow(/\(403\)/);
  });

  it("tries GEMINI_MODEL first, then the list", () => {
    process.env.GEMINI_MODEL = "x";
    process.env.GEMINI_MODELS = "y, x ,z";
    expect(geminiModels()).toEqual(["x", "y", "z"]);
  });
});

describe("buildPrompt", () => {
  const row = { symbol: "AAPL", name: "Apple", sector: "Tech", price: 100, ret1m: 1, ret3m: 2, ret6m: 3, ret12m: 4, high52: 120, low52: 80, pe: 30, beta: 1 };

  it("sends the basic table for older simulations", () => {
    const p = buildPrompt([row], "2026-04-24", 20_000);
    expect(p).toContain("AAPL | Apple | Tech | $100");
    expect(p).not.toContain("RSI");
    expect(p).not.toContain("Recent news");
  });

  it("adds technical, candlestick and news data for version-2 universes", () => {
    const p = buildPrompt(
      [{ ...row, ma50Pct: 3.2, ma200Pct: -1, rsi14: 61, vol: 28, last5: [0.5, -1.2, 0, 2, 1], patterns: ["bullish engulfing"], news: [{ time: "2026-04-23T12:00:00Z", source: "Reuters", headline: "Apple wins order", summary: "A $2 billion deal." }] }],
      "2026-04-24",
      20_000,
    );
    expect(p).toContain("| RSI(14) |");
    expect(p).toContain("| +3.2% | -1% | 61 | 28% | +0.5% -1.2% 0% +2% +1% | bullish engulfing");
    expect(p).toContain("Recent news (all published before the 2026-04-24 market close, newest first):");
    expect(p).toContain("- 2026-04-23 (Reuters) Apple wins order — A $2 billion deal.");
  });
});
