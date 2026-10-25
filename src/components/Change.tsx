import { pct, signedUsd } from "@/lib/format";

/** Signed change with an arrow, so direction never relies on color alone. */
export function Change({ amount, percent, suffix, className = "" }: { amount: number; percent: number; suffix?: string; className?: string }) {
  // Round first so float dust like -0.00001 reads as +$0.00, not a red loss.
  amount = Math.round(amount * 100) / 100 || 0;
  percent = amount ? Math.round(percent * 100) / 100 : 0;
  const up = amount >= 0;
  return (
    <span className={`text-sm ${className}`}>
      <span className={up ? "text-up" : "text-down"}>
        <span aria-hidden>{up ? "▲" : "▼"}</span> {signedUsd(amount)} ({pct(percent)})
      </span>
      {suffix && <span className="text-muted"> {suffix}</span>}
    </span>
  );
}

export function PctPill({ percent }: { percent: number }) {
  percent = Math.round(percent * 100) / 100 || 0;
  const up = percent >= 0;
  return (
    <span className={`text-sm font-medium ${up ? "text-up" : "text-down"}`}>
      <span aria-hidden className="text-[10px]">{up ? "▲" : "▼"}</span> {pct(percent)}
    </span>
  );
}
