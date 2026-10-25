"use client";

import { useState } from "react";
import { pct } from "@/lib/format";

export type Marker = { label: string; value: number; dashed?: boolean };
export type Bins = { start: number; end: number; step: number };

const W = 640;
const LABEL_ROW = 16;
const PLOT_H = 150;
const PAD = { right: 12, bottom: 28, left: 28 };
const STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
const MAX_BINS = 16;
/** Marker labels closer than this (in chart units) go on separate rows. */
const LABEL_GAP = 120;

/** Bucket edges on a "nice" step covering every value, so several histograms can share one scale. */
export function binsFor(values: number[]): Bins {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = STEPS.find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= MAX_BINS) ?? 100;
  const start = Math.floor(lo / step) * step;
  const n = Math.max(1, Math.ceil((hi - start) / step + 1e-9));
  return { start, end: start + n * step, step };
}

/** Markers at the same value share one label ("You = S&P 500 +2.85%"). */
function mergeMarkers(markers: Marker[]): Marker[] {
  const out: Marker[] = [];
  for (const m of [...markers].sort((a, b) => a.value - b.value)) {
    const same = out.find((o) => Math.abs(o.value - m.value) < 0.005);
    if (same) same.label = `${same.label} = ${m.label}`;
    else out.push({ ...m });
  }
  return out;
}

/** Distribution of run returns (%) with reference lines, on a scale shared with sibling charts. */
export function ReturnHistogram({
  values,
  markers,
  bins,
  color,
  unit,
}: {
  values: number[];
  markers: Marker[];
  bins: Bins;
  color: string;
  /** What one bar counts, e.g. "Gemini run". */
  unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!values.length) return <p className="py-12 text-center text-sm text-muted">No runs to show.</p>;

  const { start, end, step } = bins;
  const n = Math.round((end - start) / step);
  const counts = Array.from({ length: n }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, count: 0 }));
  for (const v of values) counts[Math.min(n - 1, Math.max(0, Math.floor((v - start) / step)))].count++;
  const maxCount = Math.max(...counts.map((c) => c.count));

  const plotW = W - PAD.left - PAD.right;
  const x = (v: number) => PAD.left + ((v - start) / (end - start)) * plotW;

  // Put each marker label on the first row where it doesn't collide with a neighbour.
  const lines = mergeMarkers(markers).map((m) => ({ ...m, x: x(m.value), row: 0 }));
  const rows: number[][] = [];
  for (const l of lines) {
    let r = 0;
    while (rows[r]?.some((px) => Math.abs(px - l.x) < LABEL_GAP)) r++;
    (rows[r] ??= []).push(l.x);
    l.row = r;
  }
  const top = 10 + Math.max(1, rows.length) * LABEL_ROW;
  const H = top + PLOT_H + PAD.bottom;
  const y = (c: number) => top + PLOT_H - (c / maxCount) * PLOT_H;
  const base = top + PLOT_H;
  const bw = plotW / n;
  const yTicks = [...new Set([0, Math.round(maxCount / 2), maxCount])];
  const labelEvery = Math.ceil(n / 8);

  // A bar with a 2px gap and a 4px rounded top, anchored to the baseline.
  const bar = (i: number, c: number) => {
    const x0 = PAD.left + i * bw + 1;
    const w = bw - 2;
    const t = y(c);
    const r = Math.min(4, w / 2, base - t);
    return `M${x0},${base}V${t + r}Q${x0},${t} ${x0 + r},${t}H${x0 + w - r}Q${x0 + w},${t} ${x0 + w},${t + r}V${base}Z`;
  };

  const hovered = hover == null ? null : counts[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Histogram of ${unit} returns`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        {counts.map((c, i) =>
          c.count ? <path key={i} d={bar(i, c.count)} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} /> : null,
        )}
        {counts.map((c, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(c.from)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
              {`${c.from > 0 ? "+" : ""}${Number(c.from.toFixed(1))}%`}
            </text>
          ) : null,
        )}
        {lines.map((m) => {
          const labelY = top - 8 - m.row * LABEL_ROW;
          return (
            <g key={m.label}>
              <line
                x1={m.x}
                x2={m.x}
                y1={labelY + 4}
                y2={base}
                stroke="var(--color-fg)"
                strokeWidth={2}
                strokeDasharray={m.dashed ? "4 4" : undefined}
              />
              <text
                x={m.x}
                y={labelY}
                textAnchor={m.x > W - 100 ? "end" : m.x < 100 ? "start" : "middle"}
                fontSize={12}
                fontWeight={600}
                fill="var(--color-fg)"
                paintOrder="stroke"
                stroke="var(--color-bg)"
                strokeWidth={4}
              >
                {m.label} {pct(m.value)}
              </text>
            </g>
          );
        })}
        {/* Hit targets: the full column height, wider than the visible bar. */}
        {counts.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + i * bw}
            y={top}
            width={bw}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-line bg-elevated px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((PAD.left + (hover! + 0.5) * bw) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="text-muted">
            {pct(hovered.from)} to {pct(hovered.to)}
          </div>
          <div className="font-semibold">
            {hovered.count} {unit}
            {hovered.count === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
