const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const usd = (n: number) => usdFmt.format(n);

export const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usdFmt.format(Math.abs(n))}`;

export const pct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}%`;

export const shares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** 1.23T, 456.7B, 12.3M */
export function compact(n: number | null | undefined, prefix = "") {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= v) return `${prefix}${(n / v).toFixed(2)}${s}`;
  }
  return `${prefix}${n.toFixed(2)}`;
}

export const change = (now: number, base: number) => ({
  amount: now - base,
  percent: base ? ((now - base) / base) * 100 : 0,
});

const etTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
const etDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Label for a hovered chart point (unix seconds), shown in market time. */
export function chartTime(sec: number, range: string) {
  const d = new Date(sec * 1000);
  if (range === "1D") return `${etTime.format(d)} ET`;
  if (range === "1W" || range === "1M") return `${etDateTime.format(d)} ET`;
  return etDate.format(d);
}

export const RANGE_LABEL: Record<string, string> = {
  "1D": "Today",
  "1W": "Past week",
  "1M": "Past month",
  "3M": "Past 3 months",
  "1Y": "Past year",
  "5Y": "Past 5 years",
  ALL: "All time",
};
