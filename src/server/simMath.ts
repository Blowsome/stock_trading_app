import { SIM_SLICE } from "@/lib/sim";

/** Random portfolios hold this many stocks (inclusive), in equal dollar amounts. */
export const RANDOM_MIN_STOCKS = 3;
export const RANDOM_MAX_STOCKS = 8;

/** A small deterministic PRNG (mulberry32) seeded from a string, so random runs can be reproduced. */
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks RANDOM_MIN..MAX distinct symbols and splits the budget equally between them. */
export function randomAllocations(symbols: string[], rng: () => number, budget = SIM_SLICE) {
  const pool = [...symbols];
  const k = Math.min(pool.length, RANDOM_MIN_STOCKS + Math.floor(rng() * (RANDOM_MAX_STOCKS - RANDOM_MIN_STOCKS + 1)));
  const picks: string[] = [];
  for (let i = 0; i < k; i++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const each = Math.floor((budget / k) * 100) / 100;
  return picks.sort().map((symbol) => ({ symbol, dollars: each }));
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Two-sided permutation test for a difference in means: how often a random relabelling of the
 * pooled runs gives a gap at least as large as the observed one. Seeded, so the answer is stable.
 */
export function permutationPValue(a: number[], b: number[], iterations = 10_000, seed = "perm"): number {
  if (!a.length || !b.length) return 1;
  const observed = Math.abs(mean(a) - mean(b));
  const pooled = [...a, ...b];
  const total = pooled.reduce((s, v) => s + v, 0);
  const rng = seededRng(seed);
  let extreme = 0;
  for (let i = 0; i < iterations; i++) {
    // Partial Fisher-Yates: only the first a.length slots need shuffling.
    let sumA = 0;
    for (let j = 0; j < a.length; j++) {
      const k = j + Math.floor(rng() * (pooled.length - j));
      [pooled[j], pooled[k]] = [pooled[k], pooled[j]];
      sumA += pooled[j];
    }
    const diff = Math.abs(sumA / a.length - (total - sumA) / b.length);
    if (diff >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

/**
 * Pooled two-sided permutation test across several periods. The statistic is the average, over
 * periods, of mean(a) - mean(b); labels are shuffled only within each period, so differences
 * between market periods never count as a difference between the two groups.
 */
export function stratifiedPermutationPValue(groups: { a: number[]; b: number[] }[], iterations = 10_000, seed = "strat"): number {
  const used = groups.filter((g) => g.a.length && g.b.length);
  if (!used.length) return 1;
  const stat = (gs: { a: number[]; b: number[] }[]) => gs.reduce((s, g) => s + mean(g.a) - mean(g.b), 0) / gs.length;
  const observed = Math.abs(stat(used));
  const rng = seededRng(seed);
  const pools = used.map((g) => ({ pooled: [...g.a, ...g.b], na: g.a.length, total: [...g.a, ...g.b].reduce((s, v) => s + v, 0) }));
  let extreme = 0;
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (const { pooled, na, total } of pools) {
      let sumA = 0;
      for (let j = 0; j < na; j++) {
        const k = j + Math.floor(rng() * (pooled.length - j));
        [pooled[j], pooled[k]] = [pooled[k], pooled[j]];
        sumA += pooled[j];
      }
      sum += sumA / na - (total - sumA) / (pooled.length - na);
    }
    if (Math.abs(sum / pools.length) >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

/**
 * Two-sided sign-flip test that the mean of `d` is zero: how often randomly flipping the signs
 * gives a mean at least as far from zero. Exact (every sign pattern) for up to 16 values.
 * With n values the smallest possible p is 2 / 2^n.
 */
export function signFlipPValue(d: number[], iterations = 10_000, seed = "flip"): number {
  const n = d.length;
  if (!n) return 1;
  const observed = Math.abs(mean(d));
  let extreme = 0;
  let total = 0;
  const check = (pick: (j: number) => boolean) => {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += pick(j) ? -d[j] : d[j];
    if (Math.abs(sum / n) >= observed - 1e-12) extreme++;
    total++;
  };
  if (n <= 16) {
    for (let m = 0; m < 1 << n; m++) check((j) => ((m >> j) & 1) === 1);
    return extreme / total;
  }
  const rng = seededRng(seed);
  for (let i = 0; i < iterations; i++) check(() => rng() < 0.5);
  return (extreme + 1) / (total + 1);
}

/** Holm-Bonferroni adjusted p-values: controls the chance of any false "significant" across a family of tests. */
export function holm(ps: (number | null)[]): (number | null)[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p != null).sort((a, b) => a.p - b.p);
  const out: (number | null)[] = ps.map(() => null);
  let running = 0;
  idx.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, p * (idx.length - rank)));
    out[i] = running;
  });
  return out;
}

/**
 * How alike a group of portfolios is: the stock held most often, and the average share of
 * stocks two portfolios have in common (Jaccard, 0 = nothing shared, 1 = identical).
 */
export function overlap(portfolios: string[][]): { topSymbol: string | null; topCount: number; jaccard: number } {
  const counts = new Map<string, number>();
  for (const p of portfolios) for (const s of new Set(p)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < portfolios.length; i++) {
    for (let j = i + 1; j < portfolios.length; j++) {
      const a = new Set(portfolios[i]);
      const b = new Set(portfolios[j]);
      const union = new Set([...a, ...b]).size;
      sum += union ? [...a].filter((x) => b.has(x)).length / union : 1;
      pairs++;
    }
  }
  return { topSymbol: top?.[0] ?? null, topCount: top?.[1] ?? 0, jaccard: pairs ? sum / pairs : 0 };
}

export type PersonaStat = {
  persona: string;
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  returns: number[];
  /** Permutation test of this persona's runs against the random portfolios. */
  pVsRandom: number;
  /** Sign-flip test of (run - matching rule); null for the all-round persona. */
  pVsRule: number | null;
  /** Holm-adjusted across all personas, so seven tries don't make one look significant by luck. */
  adjVsRandom: number | null;
  adjVsRule: number | null;
  overlap: { topSymbol: string | null; topCount: number; jaccard: number };
};

export type Dist = {
  count: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
  beatBenchmark: number;
  /** Runs with a higher return than the user. */
  beatUser: number;
  /** Share of runs the user did better than, 0-100 (ties count half). */
  userPercentile: number;
};

function dist(values: number[], user: number, benchmark: number | null): Dist {
  const n = values.length;
  const m = mean(values);
  const below = values.filter((r) => r < user).length;
  const ties = values.filter((r) => r === user).length;
  return {
    count: n,
    mean: m,
    median: median(values),
    stdev: n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0,
    min: n ? Math.min(...values) : 0,
    max: n ? Math.max(...values) : 0,
    beatBenchmark: benchmark == null ? 0 : values.filter((r) => r > benchmark).length,
    beatUser: values.filter((r) => r > user).length,
    userPercentile: n ? ((below + ties / 2) / n) * 100 : 0,
  };
}

export type SimStats = {
  user: number;
  benchmark: number | null;
  gemini: Dist;
  random: Dist;
  /** Each rule-based benchmark's return. */
  rules: { strategy: string; returnPct: number }[];
  /** Gemini runs grouped by investor persona (empty for simulations from before personas). */
  personas: PersonaStat[];
  /** Gemini minus random, in percentage points, and how likely a gap this size is by chance. */
  geminiVsRandom: { meanDiff: number; medianDiff: number; pValue: number };
  /** The user's slice plus every Gemini slice: the $1M that was actually split. */
  combined: { start: number; final: number; returnPct: number };
};

type StatPath = {
  kind: string;
  finalValue: number;
  returnPct: number;
  error: string | null;
  strategy?: string | null;
  holdings?: { symbol: string }[];
};

/** Failed Gemini runs (kept as cash) count toward the combined total but not toward Gemini's record. */
export function simStats(paths: StatPath[]): SimStats {
  const user = paths.find((p) => p.kind === "USER")!.returnPct;
  const benchmark = paths.find((p) => p.kind === "BENCHMARK")?.returnPct ?? null;
  const gem = paths.filter((p) => p.kind === "GEMINI" && !p.error).map((p) => p.returnPct);
  const rand = paths.filter((p) => p.kind === "RANDOM").map((p) => p.returnPct);
  const counted = paths.filter((p) => p.kind === "USER" || p.kind === "GEMINI");
  const start = counted.length * SIM_SLICE;
  const final = counted.reduce((s, p) => s + p.finalValue, 0);
  const gemini = dist(gem, user, benchmark);
  const random = dist(rand, user, benchmark);
  return {
    user,
    benchmark,
    gemini,
    random,
    rules: paths.filter((p) => p.kind === "RULE").map((p) => ({ strategy: p.strategy ?? "rule", returnPct: p.returnPct })),
    personas: personaStats(paths, rand),
    geminiVsRandom: {
      meanDiff: gemini.mean - random.mean,
      medianDiff: gemini.median - random.median,
      pValue: permutationPValue(gem, rand),
    },
    combined: { start, final, returnPct: start ? ((final - start) / start) * 100 : 0 },
  };
}

function personaStats(paths: StatPath[], random: number[]): PersonaStat[] {
  const keys = [...new Set(paths.filter((p) => p.kind === "GEMINI" && p.strategy).map((p) => p.strategy!))];
  const rows = keys.map((persona) => {
    const runs = paths.filter((p) => p.kind === "GEMINI" && !p.error && p.strategy === persona);
    const returns = runs.map((p) => p.returnPct);
    const rule = paths.find((p) => p.kind === "RULE" && p.strategy === persona)?.returnPct;
    return {
      persona,
      count: returns.length,
      mean: mean(returns),
      median: median(returns),
      min: returns.length ? Math.min(...returns) : 0,
      max: returns.length ? Math.max(...returns) : 0,
      returns,
      pVsRandom: permutationPValue(returns, random, 10_000, `persona:${persona}`),
      pVsRule: rule == null || !returns.length ? null : signFlipPValue(returns.map((r) => r - rule)),
      adjVsRandom: null as number | null,
      adjVsRule: null as number | null,
      overlap: overlap(runs.map((p) => (p.holdings ?? []).map((h) => h.symbol))),
    };
  });
  const adjRandom = holm(rows.map((r) => r.pVsRandom));
  const adjRule = holm(rows.map((r) => r.pVsRule));
  rows.forEach((r, i) => {
    r.adjVsRandom = adjRandom[i];
    r.adjVsRule = adjRule[i];
  });
  return rows;
}
