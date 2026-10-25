"use client";

import { useFetch } from "@/lib/api";
import type { Point } from "./LineChart";

/** Tiny 1D chart for list rows, drawn against the previous close. */
export function Sparkline({ symbol, up }: { symbol: string; up: boolean }) {
  const { data } = useFetch<{ points: Point[]; prevClose: number | null }>(
    `/api/history?symbol=${encodeURIComponent(symbol)}&range=1D`,
    { refreshMs: 120_000 },
  );
  const w = 64;
  const h = 28;
  const pts = data?.points ?? [];
  if (pts.length < 2) return <svg width={w} height={h} aria-hidden />;
  const values = pts.map((p) => p.value).concat(data?.prevClose ?? []);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} aria-hidden>
      {data?.prevClose != null && (
        <line x1={0} x2={w} y1={y(data.prevClose)} y2={y(data.prevClose)} stroke="#5f6368" strokeDasharray="1 3" />
      )}
      <path d={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
