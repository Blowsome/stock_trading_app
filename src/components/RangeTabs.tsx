"use client";

export function RangeTabs<R extends string>({ ranges, value, onChange }: { ranges: readonly R[]; value: R; onChange: (r: R) => void }) {
  return (
    <div className="flex gap-1 border-b border-line pb-3" role="tablist">
      {ranges.map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={r === value}
          onClick={() => onChange(r)}
          className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
            r === value ? "accent-text bg-elevated" : "text-fg hover:accent-text"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
