"use client";

import Link from "next/link";
import { useState } from "react";
import { useFetch } from "@/lib/api";
import { pct } from "@/lib/format";
import { GEMINI_KNOWLEDGE_CUTOFF, simPeriod } from "@/lib/sim";
import { personaLabel } from "@/server/personas";
import type { SimStats } from "@/server/simMath";
import { PValue } from "./PersonaStrips";

type Period = { id: string; startDate: string; endDate: string; dataVersion: number; models: string[]; stats: SimStats };
type Strategy = { key: string; label: string; periods: number; mean: number; beatBenchmark: number; beatRandom: number };
type Compare = {
  periods: Period[];
  strategies: Strategy[];
  personaTests: {
    persona: string;
    periods: number;
    mean: number;
    winsVsRandom: number;
    winsVsRule: number;
    ruleComparable: number;
    pVsRandom: number | null;
    pVsRule: number | null;
    minPossibleP: number;
    adjVsRandom: number | null;
    adjVsRule: number | null;
  }[];
  pooled: {
    count: number;
    user: number;
    benchmark: number;
    gemini: number;
    random: number;
    meanDiff: number;
    geminiAhead: number;
    userAheadOfGemini: number;
    pValue: number;
    periodPValue: number;
  };
};

const SIGNIFICANT = 0.05;
const fmtP = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const signedPoints = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} points`;

/** Shapes as well as colors, so the series never rely on color alone. */
const SERIES = [
  { key: "gemini", label: "Gemini (mean)", color: "var(--color-sim)", shape: "circle" },
  { key: "random", label: "Random (mean)", color: "var(--color-rand)", shape: "square" },
  { key: "user", label: "You", color: "var(--color-fg)", shape: "diamond" },
  { key: "spy", label: "S&P 500", color: "var(--color-muted)", shape: "tick" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

function Mark({ shape, color, x, y }: { shape: string; color: string; x: number; y: number }) {
  const ring = { stroke: "var(--color-bg)", strokeWidth: 2 };
  if (shape === "circle") return <circle cx={x} cy={y} r={6} fill={color} {...ring} />;
  if (shape === "square") return <rect x={x - 5.5} y={y - 5.5} width={11} height={11} rx={2} fill={color} {...ring} />;
  if (shape === "diamond") return <path d={`M${x},${y - 7}L${x + 7},${y}L${x},${y + 7}L${x - 7},${y}Z`} fill={color} {...ring} />;
  return <line x1={x} x2={x} y1={y - 9} y2={y + 9} stroke={color} strokeWidth={2} />;
}

function LegendMark({ shape, color }: { shape: string; color: string }) {
  return (
    <svg width={16} height={16} aria-hidden>
      <Mark shape={shape} color={color} x={8} y={8} />
    </svg>
  );
}

/** One row per period: where Gemini's average, random's average, the user and the S&P landed. */
function PeriodDots({ periods }: { periods: Period[] }) {
  const [hover, setHover] = useState<{ row: number; key: SeriesKey } | null>(null);
  const W = 640;
  const ROW = 44;
  const LEFT = 150;
  const RIGHT = 16;
  const TOP = 8;
  const H = TOP + periods.length * ROW + 28;
  const value = (p: Period, key: SeriesKey) =>
    key === "gemini" ? p.stats.gemini.mean : key === "random" ? p.stats.random.mean : key === "user" ? p.stats.user : (p.stats.benchmark ?? 0);
  const all = periods.flatMap((p) => SERIES.map((s) => value(p, s.key))).concat(0);
  const pad = Math.max(0.5, (Math.max(...all) - Math.min(...all)) * 0.08);
  const lo = Math.min(...all) - pad;
  const hi = Math.max(...all) + pad;
  const x = (v: number) => LEFT + ((v - lo) / (hi - lo)) * (W - LEFT - RIGHT);
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 8) ?? 50;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Number(t.toFixed(2)));

  const tip = hover && { p: periods[hover.row], s: SERIES.find((s) => s.key === hover.key)! };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average returns per period">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={H - 24} stroke={t === 0 ? "var(--color-muted)" : "var(--color-line)"} strokeWidth={1} />
            <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
              {`${t > 0 ? "+" : ""}${t}%`}
            </text>
          </g>
        ))}
        {periods.map((p, row) => {
          const y = TOP + row * ROW + ROW / 2;
          const g = x(p.stats.gemini.mean);
          const r = x(p.stats.random.mean);
          return (
            <g key={p.id}>
              <text x={0} y={y} dy="0.32em" fontSize={12} fill="var(--color-fg)">
                {simPeriod(p.startDate, p.endDate).replace(/, \d{4}/g, "")}
              </text>
              {/* The gap between Gemini and random, the quantity under test. */}
              <line x1={Math.min(g, r)} x2={Math.max(g, r)} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={4} strokeLinecap="round" />
              {[...SERIES].reverse().map((s) => (
                <g key={s.key} onMouseEnter={() => setHover({ row, key: s.key })} onMouseLeave={() => setHover(null)}>
                  <circle cx={x(value(p, s.key))} cy={y} r={12} fill="transparent" />
                  <Mark shape={s.shape} color={s.color} x={x(value(p, s.key))} y={y} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute rounded-md border border-line bg-elevated px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(x(value(tip.p, tip.s.key)) / W) * 100}%`,
            top: `${((TOP + hover!.row * ROW) / H) * 100}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-muted">{simPeriod(tip.p.startDate, tip.p.endDate)}</div>
          <div className="font-semibold">
            {tip.s.label}: {pct(value(tip.p, tip.s.key))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SimCompare() {
  const { data, error } = useFetch<Compare>("/api/sim/compare");
  if (error) return <p className="py-24 text-center text-muted">{error}</p>;
  if (!data) return <div className="h-96 animate-pulse rounded-lg bg-surface" />;

  const { periods, pooled } = data;
  if (!periods.length) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-semibold">No finished simulations yet</h1>
        <Link href="/start" className="mt-3 inline-block text-sim hover:underline">
          Start one →
        </Link>
      </div>
    );
  }

  const distinctPeriods = new Set(periods.map((p) => p.startDate)).size;
  const mixedModels = periods.some((p) => p.models.length > 1);
  const verdict =
    pooled.count < 2
      ? "One period can't tell skill from luck. Finish simulations for more periods to see whether the gap repeats."
      : // Both tests must agree: the run-level one alone is fooled when many runs make the same bet.
        pooled.pValue < SIGNIFICANT && pooled.periodPValue < SIGNIFICANT
        ? pooled.meanDiff > 0
          ? "Across these periods, Gemini beat random picks by more than chance usually produces."
          : "Across these periods, Gemini did worse than random picks, by more than chance usually produces."
        : "Across these periods, the gap is within what chance alone produces: no consistent evidence that Gemini picks better (or worse) than random.";

  return (
    <div className="space-y-10">
      <section>
        <p className="text-sm text-sim">Simulations</p>
        <h1 className="mt-1 text-3xl font-semibold">Gemini vs random, across periods</h1>
        <p className="mt-3 text-muted">
          {periods.length} finished simulation{periods.length === 1 ? "" : "s"} over {distinctPeriods} period
          {distinctPeriods === 1 ? "" : "s"}.{" "}
          <Link href="/start" className="text-sim hover:underline">
            Run another period →
          </Link>
        </p>
      </section>

      <section className="rounded-lg border border-line p-5">
        <h2 className="font-semibold">Is there an edge that repeats?</h2>
        <p className="mt-2 leading-7">
          On average per period, Gemini&apos;s runs returned <strong>{pct(pooled.gemini)}</strong> and random portfolios{" "}
          <strong>{pct(pooled.random)}</strong>: a gap of <strong>{signedPoints(pooled.meanDiff)}</strong> (run-level p = {fmtP(pooled.pValue)}; period-level p ={" "}
          {fmtP(pooled.periodPValue)}).
          Gemini&apos;s average beat random&apos;s in <strong>{pooled.geminiAhead}</strong> of {pooled.count}, and you beat Gemini&apos;s
          average in <strong>{pooled.userAheadOfGemini}</strong> of {pooled.count}. {verdict}
        </p>
        <p className="mt-2 text-sm text-muted">
          The run-level test shuffles Gemini and random labels only within each simulation, so a strong or weak market period can&apos;t
          favour either side. The period-level test counts each period once, so runs that made the same bet can&apos;t inflate the
          evidence; with {pooled.count} period{pooled.count === 1 ? "" : "s"} it can&apos;t go below p = {fmtP(Math.min(1, 2 / 2 ** pooled.count))}.
          Both must be below {SIGNIFICANT} to count. Your own average: {pct(pooled.user)}; S&P 500: {pct(pooled.benchmark)}.
          {mixedModels && " Some simulations mixed several Gemini models; for a clean test, keep GEMINI_MODELS to one model."}
        </p>
      </section>

      <section className="rounded-lg border border-line p-5">
        <h2 className="font-semibold">Average return per period</h2>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <LegendMark shape={s.shape} color={s.color} />
              {s.label}
            </span>
          ))}
        </div>
        <div className="mt-3">
          <PeriodDots periods={periods} />
        </div>
      </section>

      <section>
        <h2 className="border-b border-line pb-3 text-xl font-semibold">Strategy scoreboard</h2>
        <p className="mt-3 text-sm text-muted">
          Average return per period, and in how many periods each strategy beat the S&P 500 and the average random portfolio. A
          strategy with real skill should win most periods, not just one.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-3 pr-4 font-normal">Strategy</th>
                <th className="py-3 pr-4 text-right font-normal">Average return</th>
                <th className="py-3 pr-4 text-right font-normal">Beat S&P 500</th>
                <th className="py-3 text-right font-normal">Beat random</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.strategies
                .filter((s) => s.periods > 0)
                .sort((a, b) => b.mean - a.mean)
                .map((s) => (
                  <tr key={s.key} className={s.key === "user" || s.key === "gemini" ? "font-semibold" : ""}>
                    <td className="py-3 pr-4">{s.label}</td>
                    <td className={`py-3 pr-4 text-right ${s.mean >= 0 ? "text-up" : "text-down"}`}>{s.periods ? pct(s.mean) : "—"}</td>
                    <td className="py-3 pr-4 text-right">
                      {s.beatBenchmark} of {s.periods}
                    </td>
                    <td className="py-3 text-right">{s.key === "random" ? "—" : `${s.beatRandom} of ${s.periods}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.personaTests.length > 0 && (
        <section>
          <h2 className="border-b border-line pb-3 text-xl font-semibold">Gemini styles across periods</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Does a style win again and again? Each period counts once: the style&apos;s average run minus the random average (or minus
            its pure rule). p comes from a sign-flip test over periods and is adjusted for testing {data.personaTests.length} styles.
            With few periods even a perfect record can&apos;t be significant: the &ldquo;Best possible p&rdquo; column shows the floor.
          </p>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-3 pr-4 font-normal">Style</th>
                  <th className="py-3 pr-4 text-right font-normal">Periods</th>
                  <th className="py-3 pr-4 text-right font-normal">Average</th>
                  <th className="py-3 pr-4 text-right font-normal">Beat random</th>
                  <th className="py-3 pr-4 text-right font-normal">p → adjusted</th>
                  <th className="py-3 pr-4 text-right font-normal">Beat its rule</th>
                  <th className="py-3 pr-4 text-right font-normal">p → adjusted</th>
                  <th className="py-3 text-right font-normal">Best possible p</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.personaTests.map((t) => (
                  <tr key={t.persona}>
                    <td className="py-3 pr-4">{personaLabel(t.persona)}</td>
                    <td className="py-3 pr-4 text-right text-muted">{t.periods}</td>
                    <td className={`py-3 pr-4 text-right ${t.mean >= 0 ? "text-up" : "text-down"}`}>{pct(t.mean)}</td>
                    <td className="py-3 pr-4 text-right">
                      {t.winsVsRandom} of {t.periods}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <PValue raw={t.pVsRandom} adjusted={t.adjVsRandom} better={t.winsVsRandom * 2 > t.periods} />
                    </td>
                    <td className="py-3 pr-4 text-right">{t.ruleComparable ? `${t.winsVsRule} of ${t.ruleComparable}` : "—"}</td>
                    <td className="py-3 pr-4 text-right">
                      <PValue raw={t.pVsRule} adjusted={t.adjVsRule} better={t.winsVsRule * 2 > t.ruleComparable} />
                    </td>
                    <td className="py-3 text-right text-muted">{fmtP(t.minPossibleP)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            Rough guide: with 7 styles tested at once, a style needs about 9 or more periods, all won, before an adjusted p can drop
            below {SIGNIFICANT}. Fewer periods can still show which styles are worth watching.
          </p>
        </section>
      )}

      <section>
        <h2 className="border-b border-line pb-3 text-xl font-semibold">By period</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-3 pr-4 font-normal">Period</th>
                <th className="py-3 pr-4 text-right font-normal">You</th>
                <th className="py-3 pr-4 text-right font-normal">S&P 500</th>
                <th className="py-3 pr-4 text-right font-normal">Gemini mean</th>
                <th className="py-3 pr-4 text-right font-normal">Random mean</th>
                <th className="py-3 pr-4 text-right font-normal">Gap</th>
                <th className="py-3 pr-4 text-right font-normal">p</th>
                <th className="py-3 pr-4 font-normal">Gemini data</th>
                <th className="py-3 font-normal">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {periods.map((p) => {
                const tone = (v: number) => (v >= 0 ? "text-up" : "text-down");
                return (
                  <tr key={p.id} className="hover:bg-surface">
                    <td className="py-3 pr-4">
                      <Link href={`/simulations/${p.id}`} className="hover:underline">
                        {simPeriod(p.startDate, p.endDate)}
                      </Link>
                      {p.startDate <= GEMINI_KNOWLEDGE_CUTOFF && (
                        <span className="block text-xs text-down">may be inside Gemini&apos;s training data</span>
                      )}
                    </td>
                    <td className={`py-3 pr-4 text-right ${tone(p.stats.user)}`}>{pct(p.stats.user)}</td>
                    <td className="py-3 pr-4 text-right text-muted">{p.stats.benchmark != null ? pct(p.stats.benchmark) : "—"}</td>
                    <td className={`py-3 pr-4 text-right ${tone(p.stats.gemini.mean)}`}>{pct(p.stats.gemini.mean)}</td>
                    <td className={`py-3 pr-4 text-right ${tone(p.stats.random.mean)}`}>{pct(p.stats.random.mean)}</td>
                    <td className="py-3 pr-4 text-right">{signedPoints(p.stats.geminiVsRandom.meanDiff).replace(" points", "")}</td>
                    <td className="py-3 pr-4 text-right text-muted">{fmtP(p.stats.geminiVsRandom.pValue)}</td>
                    <td className="py-3 pr-4 text-xs text-muted">{p.dataVersion >= 3 ? "+ news & summaries, technicals" : p.dataVersion >= 2 ? "+ headlines, technicals" : "basic"}</td>
                    <td className="py-3 text-xs text-muted">{p.models.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
