"use client";

import { useMemo } from "react";
import type { PortfolioView } from "@/server/portfolio";
import { useFetch } from "./api";
import { useLiveSubscription, usePriceStore } from "./livePrices";

export type LivePosition = PortfolioView["positions"][number] & {
  marketValue: number;
  costBasis: number;
  totalReturn: number;
  totalReturnPct: number;
  dayChange: number;
  dayChangePct: number;
};

/** The portfolio from the server, re-valued on every live tick. */
export function usePortfolio() {
  const { data, error, loading, reload } = useFetch<PortfolioView>("/api/portfolio", { refreshMs: 30_000 });
  const symbols = useMemo(
    () => [...(data?.positions.map((p) => p.symbol) ?? []), ...(data?.watchlist.map((w) => w.symbol) ?? [])],
    [data],
  );
  useLiveSubscription(symbols);
  const prices = usePriceStore((s) => s.prices);

  const live = useMemo(() => {
    if (!data) return null;
    const positions: LivePosition[] = data.positions.map((p) => {
      const price = prices[p.symbol]?.price ?? p.price;
      const marketValue = p.quantity * price;
      const costBasis = p.quantity * p.avgCost;
      const dayChange = marketValue - p.dayBase;
      return {
        ...p,
        price,
        marketValue,
        costBasis,
        totalReturn: marketValue - costBasis,
        totalReturnPct: costBasis ? ((marketValue - costBasis) / costBasis) * 100 : 0,
        dayChange,
        dayChangePct: p.dayBase ? (dayChange / p.dayBase) * 100 : 0,
      };
    });
    const invested = positions.reduce((a, p) => a + p.marketValue, 0);
    const totalValue = data.cash + invested;
    const dayChange = positions.reduce((a, p) => a + p.dayChange, 0) + data.closedDayChange;
    const start = totalValue - dayChange;
    return {
      cash: data.cash,
      buyingPower: data.buyingPower,
      positions,
      invested,
      totalValue,
      dayChange,
      dayChangePct: start ? (dayChange / start) * 100 : 0,
      watchlist: data.watchlist.map((w) => {
        const price = prices[w.symbol]?.price ?? w.price;
        return { ...w, price, changePct: w.prevClose ? ((price - w.prevClose) / w.prevClose) * 100 : 0 };
      }),
    };
  }, [data, prices]);

  return { portfolio: live, error, loading, reload };
}
