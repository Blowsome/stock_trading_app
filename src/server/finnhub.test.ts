import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ c: 10, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 10, t: 1 })));

let finnhub: typeof import("./finnhub");

beforeAll(async () => {
  vi.stubEnv("FINNHUB_API_KEY", "test");
  vi.stubEnv("FINNHUB_MAX_CALLS", "3");
  vi.stubEnv("FINNHUB_WINDOW_SECONDS", "60");
  vi.stubGlobal("fetch", fetchMock);
  finnhub = await import("./finnhub");
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Finnhub call budget", () => {
  it("never makes more than FINNHUB_MAX_CALLS requests per window", async () => {
    for (const s of ["A", "B", "C"]) expect(await finnhub.getQuote(s)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // A new symbol has nothing cached, so it fails instead of calling.
    await expect(finnhub.getQuote("D")).rejects.toThrow(/rate limit/);
    // A cached symbol is served stale, even when asked for fresh data.
    expect((await finnhub.getQuote("A", 0))?.price).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
