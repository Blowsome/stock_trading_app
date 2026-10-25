"use client";

import { useMemo, useState } from "react";
import { useFetch } from "@/lib/api";
import { RANGE_LABEL, chartTime, change, usd } from "@/lib/format";
import { useSim } from "@/lib/simContext";
import { usePortfolio } from "@/lib/usePortfolio";
import { Change } from "./Change";
import { LineChart, type Point } from "./LineChart";
import { RangeTabs } from "./RangeTabs";
import { SimHome } from "./SimHome";
import { PopularStocks, SymbolLists } from "./SymbolLists";

const RANGES = ["1D", "1W", "1M", "3M", "1Y", "ALL"] as const;
type Range = (typeof RANGES)[number];

export function HomeView() {
  const sim = useSim();
  return sim ? <SimHome sim={sim} /> : <LiveHome />;
}

function LiveHome() {
  const { portfolio, error } = usePortfolio();
  const [range, setRange] = useState<Range>("1D");
  const [hover, setHover] = useState<Point | null>(null);
  const history = useFetch<{ points: Point[] }>(`/api/portfolio/history?range=${range}`, { refreshMs: 60_000 });

  const points = useMemo(() => {
    const pts = [...(history.data?.points ?? [])];
    if (portfolio) {
      const now = Math.floor(Date.now() / 1000);
      while (pts.length && pts[pts.length - 1].time >= now) pts.pop();
      pts.push({ time: now, value: portfolio.totalValue });
    }
    return pts;
  }, [history.data, portfolio]);

  if (error) return <p className="text-down">{error}</p>;
  if (!portfolio) return <div className="h-96 animate-pulse rounded-lg bg-surface" />;

  const shown = hover?.value ?? portfolio.totalValue;
  const base = range === "1D" ? portfolio.totalValue - portfolio.dayChange : (points[0]?.value ?? shown);
  const delta = range === "1D" && !hover ? { amount: portfolio.dayChange, percent: portfolio.dayChangePct } : change(shown, base);
  const up = delta.amount >= 0;

  return (
    <div style={{ "--accent": up ? "var(--color-up)" : "var(--color-down)" } as React.CSSProperties} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <h1 className="text-4xl font-semibold tracking-tight">{usd(shown)}</h1>
        <div className="mt-1 h-5">
          <Change {...delta} suffix={hover ? chartTime(hover.time, range) : RANGE_LABEL[range]} />
        </div>

        <div className="mt-6">
          <LineChart
            points={points}
            color={up ? "#00c805" : "#ff5000"}
            baseline={range === "1D" ? base : null}
            fitKey={range}
            onHover={setHover}
          />
          {points.length < 3 && (
            <p className="-mt-6 text-xs text-muted">Your chart fills in as you trade and the market moves.</p>
          )}
        </div>
        <div className="mt-4">
          <RangeTabs ranges={RANGES} value={range} onChange={setRange} />
        </div>

        <dl className="mt-6 divide-y divide-line border-b border-line">
          <div className="flex justify-between py-4">
            <dt>Buying power</dt>
            <dd className="font-semibold">{usd(portfolio.buyingPower)}</dd>
          </div>
          <div className="flex justify-between py-4 text-sm text-muted">
            <dt>Invested</dt>
            <dd>{usd(portfolio.invested)}</dd>
          </div>
          {portfolio.buyingPower < portfolio.cash - 0.005 && (
            <div className="flex justify-between py-4 text-sm text-muted">
              <dt>Held for open limit orders</dt>
              <dd>{usd(portfolio.cash - portfolio.buyingPower)}</dd>
            </div>
          )}
        </dl>

        {portfolio.positions.length === 0 && <PopularStocks />}
      </div>

      <SymbolLists positions={portfolio.positions} watchlist={portfolio.watchlist} />
    </div>
  );
}
