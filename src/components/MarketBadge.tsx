"use client";

import { useFetch } from "@/lib/api";

type Status = { isOpen: boolean; session: string | null; holiday: string | null };

const LABEL: Record<string, string> = {
  regular: "Market open",
  "pre-market": "Pre-market",
  "post-market": "After hours",
};

export function useMarketStatus() {
  return useFetch<Status>("/api/market-status", { refreshMs: 60_000 }).data;
}

export function MarketBadge() {
  const s = useMarketStatus();
  if (!s) return null;
  const label = s.holiday ? `Closed · ${s.holiday}` : s.isOpen ? "Market open" : (LABEL[s.session ?? ""] ?? "Market closed");
  return (
    <span className="hidden items-center gap-1.5 text-xs text-muted md:inline-flex">
      <span className={`h-2 w-2 rounded-full ${s.isOpen ? "bg-up" : "bg-muted"}`} />
      {label}
    </span>
  );
}
