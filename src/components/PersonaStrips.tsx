"use client";

import { useState } from "react";
import { pct } from "@/lib/format";
import { PERSONAS, personaLabel } from "@/server/personas";
import { ruleLabel } from "@/server/simRules";
import type { SimStats } from "@/server/simMath";

const W = 640;
const ROW = 40;
const LEFT = 150;
const RIGHT = 16;
const TOP = 26;

/**
 * One row per Gemini persona: a dot per run, a square for the matching pure rule, and reference
 * lines for the user and the random average, all on one return scale.
 */
export function PersonaStrips({ stats }: { stats: SimStats }) {
  const [hover, setHover] = useState<{ row: number; label: string; value: number } | null>(null);
  const rows = PERSONAS.map((p) => ({ persona: p, group: stats.personas.find((g) => g.persona === p.key) }))
    .filter((r): r is { persona: (typeof PERSONAS)[number]; group: SimStats["personas"][number] } => !!r.group?.count);
  if (!rows.length) return null;

  const rule = (key: string) => stats.rules.find((r) => r.strategy === key)?.returnPct;
  const all = rows.flatMap((r) => [...r.group.returns, rule(r.persona.key) ?? r.group.mean]).concat(stats.user, stats.random.mean, 0);
  const pad = Math.max(0.5, (Math.max(...all) - Math.min(...all)) * 0.06);
  const lo = Math.min(...all) - pad;
  const hi = Math.max(...all) + pad;
  const x = (v: number) => LEFT + ((v - lo) / (hi - lo)) * (W - LEFT - RIGHT);
  const H = TOP + rows.length * ROW + 26;
  const step = [1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 8) ?? 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  // The lower reference's label points left and the higher one's right, so they never overlap.
  const refs = [
    { label: "You", value: stats.user, dashed: false, color: "var(--color-fg)" },
    { label: "Random avg", value: stats.random.mean, dashed: true, color: "var(--color-rand)" },
  ].sort((a, b) => a.value - b.value);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gemini returns by investor persona">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={H - 22} stroke={t === 0 ? "var(--color-muted)" : "var(--color-line)"} strokeWidth={1} />
            <text x={x(t)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
              {`${t > 0 ? "+" : ""}${t}%`}
            </text>
          </g>
        ))}
        {refs.map((r, i) => (
          <g key={r.label}>
            <line x1={x(r.value)} x2={x(r.value)} y1={TOP - 4} y2={H - 22} stroke={r.color} strokeWidth={2} strokeDasharray={r.dashed ? "4 4" : undefined} />
            <text
              x={x(r.value)}
              y={TOP - 8}
              textAnchor={i === 0 ? "end" : "start"}
              dx={i === 0 ? -4 : 4}
              fontSize={11}
              fontWeight={600}
              fill={r.color}
            >
              {r.label} {pct(r.value)}
            </text>
          </g>
        ))}
        {rows.map(({ persona, group }, row) => {
          const y = TOP + row * ROW + ROW / 2;
          const ruleValue = rule(persona.key);
          return (
            <g key={persona.key}>
              <text x={0} y={y} dy="0.32em" fontSize={12} fill="var(--color-fg)">
                {persona.label}
              </text>
              <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="1 3" />
              {group.returns.map((v, i) => (
                <g key={i} onMouseEnter={() => setHover({ row, label: `${persona.label} run`, value: v })} onMouseLeave={() => setHover(null)}>
                  <circle cx={x(v)} cy={y} r={10} fill="transparent" />
                  <circle cx={x(v)} cy={y} r={5} fill="var(--color-sim)" stroke="var(--color-bg)" strokeWidth={2} />
                </g>
              ))}
              {ruleValue != null && (
                <g
                  onMouseEnter={() => setHover({ row, label: `Rule: ${ruleLabel(persona.key)}`, value: ruleValue })}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle cx={x(ruleValue)} cy={y} r={10} fill="transparent" />
                  <rect x={x(ruleValue) - 6} y={y - 6} width={12} height={12} rx={2} fill="var(--color-fg)" stroke="var(--color-bg)" strokeWidth={2} />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute rounded-md border border-line bg-elevated px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(hover.value) / W) * 100}%`, top: `${((TOP + hover.row * ROW) / H) * 100}%`, transform: "translate(-50%, -100%)" }}
        >
          <div className="text-muted">{hover.label}</div>
          <div className="font-semibold">{pct(hover.value)}</div>
        </div>
      )}
    </div>
  );
}

const SIGNIFICANT = 0.05;

/** "0.016 → 0.094" (raw → adjusted), with significant results highlighted. */
export function PValue({ raw, adjusted, better }: { raw: number | null; adjusted: number | null; better: boolean | null }) {
  if (raw == null) return <span className="text-muted">—</span>;
  const f = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));
  const significant = adjusted != null && adjusted < SIGNIFICANT;
  return (
    <span className={significant ? (better ? "font-semibold text-up" : "font-semibold text-down") : "text-muted"}>
      {f(raw)}
      {adjusted != null && <span className="text-muted"> → {f(adjusted)}</span>}
      {significant && <span className="ml-1">✓</span>}
    </span>
  );
}

/** The same comparison as a table: each persona against random picks and its mechanical rule, with tests. */
export function PersonaTable({ stats }: { stats: SimStats }) {
  const groups = PERSONAS.map((p) => stats.personas.find((g) => g.persona === p.key)).filter((g) => g?.count);
  if (!groups.length) return null;
  const tone = (v: number) => (v >= 0 ? "text-up" : "text-down");
  const runs = groups[0]!.count;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-2 pr-4 font-normal">Style</th>
              <th className="py-2 pr-4 text-right font-normal">Average</th>
              <th className="py-2 pr-4 text-right font-normal">Best / worst</th>
              <th className="py-2 pr-4 text-right font-normal">vs random: p → adjusted</th>
              <th className="py-2 pr-4 text-right font-normal">Pure rule</th>
              <th className="py-2 pr-4 text-right font-normal">Gemini − rule</th>
              <th className="py-2 pr-4 text-right font-normal">vs rule: p → adjusted</th>
              <th className="py-2 text-right font-normal">Same stocks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {groups.map((g) => {
              const rule = stats.rules.find((r) => r.strategy === g!.persona)?.returnPct;
              const diff = rule == null ? null : g!.mean - rule;
              const o = g!.overlap;
              return (
                <tr key={g!.persona}>
                  <td className="py-2 pr-4">{personaLabel(g!.persona)}</td>
                  <td className={`py-2 pr-4 text-right ${tone(g!.mean)}`}>{pct(g!.mean)}</td>
                  <td className="py-2 pr-4 text-right text-muted">
                    {pct(g!.max)} / {pct(g!.min)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <PValue raw={g!.pVsRandom} adjusted={g!.adjVsRandom} better={g!.mean > stats.random.mean} />
                  </td>
                  <td className="py-2 pr-4 text-right text-muted">{rule == null ? "—" : `${pct(rule)} (${ruleLabel(g!.persona)})`}</td>
                  <td className={`py-2 pr-4 text-right ${diff == null ? "text-muted" : tone(diff)}`}>
                    {diff == null ? "—" : `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)} pts`}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <PValue raw={g!.pVsRule} adjusted={g!.adjVsRule} better={diff != null && diff > 0} />
                  </td>
                  <td className="py-2 text-right text-muted" title="Average share of stocks two runs of this style have in common">
                    {o.topSymbol ? `${o.topSymbol} in ${o.topCount}/${g!.count}` : "—"} · {Math.round(o.jaccard * 100)}% overlap
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-1.5 text-xs leading-5 text-muted">
        <p>
          <strong className="text-fg">How to read the p-values.</strong> p is the chance of a gap at least this big if the style had no
          real edge. The number after the arrow is adjusted for testing {groups.length} styles at once (Holm); only an adjusted p below{" "}
          {SIGNIFICANT} (marked ✓) counts as significant.
        </p>
        <p>
          <strong className="text-fg">Why a ✓ here still isn&apos;t proof.</strong> Runs of the same style often buy the same stocks (see
          &ldquo;Same stocks&rdquo;), so 7 runs can be one bet repeated, and the test treats them as independent. Everything happened in one
          period, where a couple of stocks can decide the result. Against the rule, {runs} runs can never get below p ={" "}
          {(2 / 2 ** runs).toFixed(3)} even if every run wins. Real skill shows up as wins that repeat across periods: see{" "}
          <a href="/simulations" className="text-sim hover:underline">
            Compare all periods
          </a>
          .
        </p>
      </div>
    </>
  );
}
