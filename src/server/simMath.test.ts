import { describe, expect, it } from "vitest";
import {
  RANDOM_MAX_STOCKS,
  RANDOM_MIN_STOCKS,
  holm,
  overlap,
  permutationPValue,
  randomAllocations,
  seededRng,
  signFlipPValue,
  simStats,
  stratifiedPermutationPValue,
} from "./simMath";

const SYMBOLS = Array.from({ length: 43 }, (_, i) => `S${i}`);

describe("random portfolios", () => {
  it("are reproducible from their seed and differ between seeds", () => {
    const a = randomAllocations(SYMBOLS, seededRng("sim:random:1"));
    expect(randomAllocations(SYMBOLS, seededRng("sim:random:1"))).toEqual(a);
    expect(randomAllocations(SYMBOLS, seededRng("sim:random:2"))).not.toEqual(a);
  });

  it("hold 3-8 distinct stocks in equal amounts within the budget", () => {
    const sizes = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const picks = randomAllocations(SYMBOLS, seededRng(`s${i}`), 20_000);
      sizes.add(picks.length);
      expect(new Set(picks.map((p) => p.symbol)).size).toBe(picks.length);
      expect(new Set(picks.map((p) => p.dollars)).size).toBe(1);
      expect(picks.reduce((s, p) => s + p.dollars, 0)).toBeLessThanOrEqual(20_000);
    }
    expect([...sizes].sort()).toEqual(Array.from({ length: RANDOM_MAX_STOCKS - RANDOM_MIN_STOCKS + 1 }, (_, i) => RANDOM_MIN_STOCKS + i));
  });
});

describe("permutationPValue", () => {
  it("is large for samples from the same distribution", () => {
    const rng = seededRng("same");
    const a = Array.from({ length: 49 }, () => rng() * 10);
    const b = Array.from({ length: 49 }, () => rng() * 10);
    expect(permutationPValue(a, b)).toBeGreaterThan(0.05);
  });

  it("is tiny when one group is clearly higher", () => {
    const rng = seededRng("shifted");
    const a = Array.from({ length: 49 }, () => rng() * 10 + 5);
    const b = Array.from({ length: 49 }, () => rng() * 10);
    expect(permutationPValue(a, b)).toBeLessThan(0.001);
  });
});

describe("stratifiedPermutationPValue", () => {
  const sample = (rng: () => number, shift: number) => Array.from({ length: 49 }, () => rng() * 10 + shift);

  it("ignores how good or bad each period was overall", () => {
    // Market levels differ a lot between periods, but within each period both groups are alike.
    const rng = seededRng("levels");
    const groups = [-20, 0, 20, 40].map((level) => ({ a: sample(rng, level), b: sample(rng, level) }));
    expect(stratifiedPermutationPValue(groups)).toBeGreaterThan(0.05);
  });

  it("detects a small edge that repeats in every period", () => {
    const rng = seededRng("edge");
    const groups = [-20, 0, 20, 40].map((level) => ({ a: sample(rng, level + 2), b: sample(rng, level) }));
    expect(stratifiedPermutationPValue(groups)).toBeLessThan(0.01);
  });
});

describe("signFlipPValue", () => {
  it("is exact: 7 wins out of 7 give 2/128, the smallest possible", () => {
    expect(signFlipPValue([1, 2, 3, 1, 2, 3, 1])).toBeCloseTo(2 / 128, 10);
  });

  it("is 1 when wins and losses cancel out", () => {
    expect(signFlipPValue([2, -2, 1, -1])).toBe(1);
  });
});

describe("holm", () => {
  it("scales the smallest p by the number of tests, keeps order, and skips nulls", () => {
    const adj = holm([0.01, 0.04, null, 0.03]);
    expect(adj[0]).toBeCloseTo(0.03); // 0.01 x 3
    expect(adj[3]).toBeCloseTo(0.06); // 0.03 x 2
    expect(adj[1]).toBeCloseTo(0.06); // 0.04 x 1, raised to keep the order
    expect(adj[2]).toBeNull();
  });
});

describe("overlap", () => {
  it("finds the most shared stock and how alike the portfolios are", () => {
    const o = overlap([["ORCL", "TSLA"], ["ORCL", "TSLA"], ["ORCL", "CRM"]]);
    expect(o.topSymbol).toBe("ORCL");
    expect(o.topCount).toBe(3);
    expect(o.jaccard).toBeCloseTo((1 + 1 / 3 + 1 / 3) / 3);
  });
});

describe("persona statistics", () => {
  it("tests each persona against random and its rule, adjusted for testing several personas", () => {
    const run = (strategy: string, returnPct: number, symbols: string[]) => ({
      kind: "GEMINI",
      strategy,
      returnPct,
      finalValue: 20_000 * (1 + returnPct / 100),
      error: null,
      holdings: symbols.map((symbol) => ({ symbol })),
    });
    const rng = seededRng("noise");
    const paths = [
      { kind: "USER", returnPct: 0, finalValue: 20_000, error: null },
      ...Array.from({ length: 49 }, () => ({ kind: "RANDOM", returnPct: rng() * 4 - 2, finalValue: 20_000, error: null })),
      { kind: "RULE", strategy: "reversal", returnPct: 1, finalValue: 20_000, error: null },
      { kind: "RULE", strategy: "value", returnPct: 0, finalValue: 20_000, error: null },
      ...Array.from({ length: 7 }, (_, i) => run("reversal", 14 + i, ["ORCL", "TSLA"])),
      ...Array.from({ length: 7 }, (_, i) => run("value", i % 2 ? 1 : -1, ["KO", `X${i}`])),
    ];
    const s = simStats(paths).personas;
    const reversal = s.find((p) => p.persona === "reversal")!;
    const value = s.find((p) => p.persona === "value")!;
    expect(reversal.pVsRandom).toBeLessThan(0.001);
    expect(reversal.pVsRule).toBeCloseTo(2 / 128, 10);
    expect(reversal.adjVsRule).toBeCloseTo(4 / 128, 10); // two personas tested against their rule
    expect(reversal.overlap).toMatchObject({ topSymbol: "ORCL", topCount: 7, jaccard: 1 });
    expect(value.pVsRule).toBeGreaterThan(0.5);
  });
});
