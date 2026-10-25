"use client";

import { useEffect } from "react";
import { create } from "zustand";

type Tick = { symbol: string; price: number; time: number };

export const usePriceStore = create<{ prices: Record<string, Tick>; apply: (ticks: Tick[]) => void }>((set) => ({
  prices: {},
  apply: (ticks) =>
    set((s) => {
      const prices = { ...s.prices };
      for (const t of ticks) prices[t.symbol] = t;
      return { prices };
    }),
}));

// One EventSource for the whole tab, reopened when the set of watched symbols changes.
const counts = new Map<string, number>();
let source: EventSource | null = null;
let openKey = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

/** Simulations are frozen in the past, so they turn the live stream off. */
export function setLiveEnabled(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  schedule();
}

function reconnect() {
  timer = null;
  const key = enabled ? [...counts.keys()].sort().join(",") : "";
  if (key === openKey) return;
  source?.close();
  source = null;
  openKey = key;
  if (!key) return;
  source = new EventSource(`/api/stream?symbols=${encodeURIComponent(key)}`);
  source.onmessage = (ev) => {
    try {
      usePriceStore.getState().apply(JSON.parse(ev.data));
    } catch {}
  };
}

function schedule() {
  if (!timer) timer = setTimeout(reconnect, 100);
}

/** Streams live prices for the given symbols into the shared store. */
export function useLiveSubscription(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1);
    schedule();
    return () => {
      for (const s of list) {
        const n = (counts.get(s) ?? 1) - 1;
        if (n <= 0) counts.delete(s);
        else counts.set(s, n);
      }
      schedule();
    };
  }, [key]);
}

export function useLivePrice(symbol: string, fallback?: number): number | undefined {
  useLiveSubscription([symbol]);
  return usePriceStore((s) => s.prices[symbol]?.price) ?? fallback;
}
