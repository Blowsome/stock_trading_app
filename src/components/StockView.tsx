"use client";

import { useMemo, useState } from "react";
import { api, revalidate, useFetch } from "@/lib/api";
import { displaySymbol, isCrypto, unitLabel } from "@/lib/assets";
import { RANGE_LABEL, chartTime, change, compact, shares, usd } from "@/lib/format";
import { useLivePrice } from "@/lib/livePrices";
import { usePortfolio } from "@/lib/usePortfolio";
import { startOfDayET } from "@/lib/time";
import { simDate } from "@/lib/sim";
import { useSim } from "@/lib/simContext";
import type { KeyStats, Profile, Quote } from "@/server/finnhub";
import { Change } from "./Change";
import { LineChart, type Point } from "./LineChart";
import { useMarketStatus } from "./MarketBadge";
import { OrderPanel } from "./OrderPanel";
import { OrdersTable, type OrderRow } from "./OrdersTable";
import { RangeTabs } from "./RangeTabs";

const RANGES = ["1D", "1W", "1M", "3M", "1Y", "5Y"] as const;
// Intraday history doesn't reach back to a simulation's start date.
const SIM_RANGES = ["1W", "1M", "3M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];
type QuoteResponse = { symbol: string; quote: Quote; profile: Profile | null; stats: KeyStats | null };

const SESSION_CLOSE_SEC = 16 * 3600;
const BUCKET = 300;

export function StockView({ symbol }: { symbol: string }) {
  const sim = useSim();
  const [range, setRange] = useState<Range>(sim ? "1M" : "1D");
  const [hover, setHover] = useState<Point | null>(null);
  const q = useFetch<QuoteResponse>(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { refreshMs: 60_000 });
  const history = useFetch<{ points: Point[]; prevClose: number | null }>(
    `/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`,
    { refreshMs: range === "1D" ? 60_000 : 0 },
  );
  const orders = useFetch<{ orders: OrderRow[] }>(`/api/orders?symbol=${encodeURIComponent(symbol)}`);
  const { portfolio } = usePortfolio();
  const market = useMarketStatus();
  const price = useLivePrice(symbol, q.data?.quote.price);

  const prevClose = q.data?.quote.prevClose ?? history.data?.prevClose ?? null;
  const crypto = isCrypto(symbol);
  const trading = !sim && (crypto || !!market?.isOpen);

  const points = useMemo(() => {
    const pts = [...(history.data?.points ?? [])];
    // Keep the 1D line moving with live trades during the session (always, for crypto).
    if (range === "1D" && trading && price && pts.length) {
      const bucket = Math.floor(Date.now() / 1000 / BUCKET) * BUCKET;
      if (pts[pts.length - 1].time >= bucket) pts[pts.length - 1] = { ...pts[pts.length - 1], value: price };
      else pts.push({ time: bucket, value: price });
    }
    return pts;
  }, [history.data, range, trading, price]);

  const padUntil = useMemo(() => {
    if (range !== "1D" || crypto || !points.length) return null;
    const last = points[points.length - 1].time;
    return Math.floor(startOfDayET(new Date(last * 1000)).getTime() / 1000) + SESSION_CLOSE_SEC;
  }, [range, crypto, points]);

  if (q.error) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-semibold">{displaySymbol(symbol)}</h1>
        <p className="mt-2 text-muted">{q.error}</p>
      </div>
    );
  }

  const position = portfolio?.positions.find((p) => p.symbol === symbol);
  const watching = portfolio?.watchlist.some((w) => w.symbol === symbol) ?? false;
  const pending = orders.data?.orders.filter((o) => o.status === "PENDING") ?? [];
  const reservedShares = pending.filter((o) => o.side === "SELL").reduce((a, o) => a + o.quantity, 0);

  const shown = hover?.value ?? price ?? 0;
  const base = range === "1D" ? (prevClose ?? shown) : (points[0]?.value ?? shown);
  const delta = change(shown, base);
  const up = delta.amount >= 0;
  const stats = q.data?.stats;
  const profile = q.data?.profile;
  const quote = q.data?.quote;

  async function toggleWatch() {
    if (watching) await api(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
    else await api("/api/watchlist", { body: { symbol } });
    revalidate("/api/portfolio");
  }

  return (
    <div style={{ "--accent": up ? "var(--color-up)" : "var(--color-down)" } as React.CSSProperties} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {profile?.logo && <img src={profile.logo} alt="" className="h-8 w-8 rounded-full bg-white object-contain" />}
          <p className="text-muted">{profile?.name ?? symbol}</p>
        </div>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">{price ? usd(shown) : "—"}</h1>
        <div className="mt-1 h-5">
          {price != null && (
            <Change
              {...delta}
              // Simulation charts are daily closes, so hovering shows dates only.
              suffix={hover ? chartTime(hover.time, sim ? "1Y" : range) : `${RANGE_LABEL[range]}${sim ? ` to ${simDate(sim.startDate)}` : ""}`}
            />
          )}
        </div>

        <div className="mt-6">
          {history.error ? (
            <p className="flex h-80 items-center justify-center text-sm text-muted">Chart unavailable: {history.error}</p>
          ) : (
            <LineChart
              points={points}
              color={up ? "#00c805" : "#ff5000"}
              baseline={range === "1D" ? prevClose : null}
              padUntil={padUntil}
              fitKey={`${symbol}-${range}`}
              onHover={setHover}
            />
          )}
        </div>
        <div className="mt-4">
          <RangeTabs ranges={sim ? SIM_RANGES : RANGES} value={range} onChange={setRange} />
        </div>

        {position && (
          <section className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-5">
              <p className="text-sm text-muted">Your market value</p>
              <p className="mt-1 text-2xl font-semibold">{usd(position.marketValue)}</p>
              <dl className="mt-4 space-y-3 text-sm">
                <Stat label="Today's return" value={<Change amount={position.dayChange} percent={position.dayChangePct} />} />
                <Stat label="Total return" value={<Change amount={position.totalReturn} percent={position.totalReturnPct} />} />
              </dl>
            </div>
            <div className="rounded-lg border border-line p-5">
              <p className="text-sm text-muted">Your average cost</p>
              <p className="mt-1 text-2xl font-semibold">{usd(position.avgCost)}</p>
              <dl className="mt-4 space-y-3 text-sm">
                <Stat label={crypto ? "Quantity" : "Shares"} value={`${shares(position.quantity)}${crypto ? ` ${unitLabel(symbol)}` : ""}`} />
                <Stat
                  label="Portfolio diversity"
                  value={portfolio ? `${((position.marketValue / portfolio.totalValue) * 100).toFixed(2)}%` : "—"}
                />
              </dl>
            </div>
          </section>
        )}

        {pending.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-xl font-semibold">Open orders</h2>
            <OrdersTable orders={pending} />
          </section>
        )}

        {crypto ? (
          <section className="mt-10">
            <h2 className="border-b border-line pb-3 text-xl font-semibold">About</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Bitcoin is a decentralized digital currency that trades around the clock, every day. Prices here come live from
              Coinbase&apos;s BTC-USD market. &ldquo;Today&rdquo; is measured from the start of the day in UTC.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              <Fact label="Today's high" value={quote?.high ? usd(quote.high) : "—"} />
              <Fact label="Today's low" value={quote?.low ? usd(quote.low) : "—"} />
              <Fact label="Day open (UTC)" value={prevClose ? usd(prevClose) : "—"} />
              <Fact label="Trading hours" value="24/7" />
            </dl>
          </section>
        ) : (
        <>
        <section className="mt-10">
          <h2 className="border-b border-line pb-3 text-xl font-semibold">About</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
            <Fact label="Industry" value={profile?.industry || "—"} />
            <Fact label="Exchange" value={profile?.exchange?.split(" ")[0] || "—"} />
            <Fact label="IPO date" value={profile?.ipo || "—"} />
            <Fact
              label="Website"
              value={profile?.weburl ? <a href={profile.weburl} target="_blank" rel="noreferrer" className="accent-text hover:underline">{new URL(profile.weburl).hostname.replace(/^www\./, "")}</a> : "—"}
            />
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="border-b border-line pb-3 text-xl font-semibold">Key statistics</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
            <Fact label="Market cap" value={compact(profile?.marketCap, "$")} />
            <Fact label="P/E ratio" value={stats?.peRatio?.toFixed(2) ?? "—"} />
            <Fact label="Dividend yield" value={stats?.dividendYield != null ? `${stats.dividendYield.toFixed(2)}%` : "—"} />
            <Fact label="Average volume" value={compact(stats?.avgVolume)} />
            <Fact label="Open" value={quote?.open ? usd(quote.open) : "—"} />
            <Fact label="Today's high" value={quote?.high ? usd(quote.high) : "—"} />
            <Fact label="Today's low" value={quote?.low ? usd(quote.low) : "—"} />
            <Fact label="Previous close" value={prevClose ? usd(prevClose) : "—"} />
            <Fact label="52 week high" value={stats?.high52 ? usd(stats.high52) : "—"} />
            <Fact label="52 week low" value={stats?.low52 ? usd(stats.low52) : "—"} />
            <Fact label="Beta" value={stats?.beta?.toFixed(2) ?? "—"} />
          </dl>
        </section>
        </>
        )}
      </div>

      <div className="space-y-4 lg:sticky lg:top-22 lg:self-start">
        <OrderPanel
          symbol={symbol}
          price={price}
          buyingPower={portfolio?.buyingPower ?? 0}
          owned={position?.quantity ?? 0}
          reservedShares={reservedShares}
        />
        <button onClick={toggleWatch} className="accent-text accent-border w-full rounded-full border py-3 text-sm font-semibold">
          {watching ? "✓ On your watchlist" : "+ Add to watchlist"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd className="mt-1 truncate text-muted">{value}</dd>
    </div>
  );
}
