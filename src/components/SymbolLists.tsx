"use client";

import Link from "next/link";
import { displaySymbol, unitLabel } from "@/lib/assets";
import { usd, shares } from "@/lib/format";
import { STARTING_CASH } from "@/lib/sim";
import { useLiveSubscription, usePriceStore } from "@/lib/livePrices";
import type { LivePosition } from "@/lib/usePortfolio";
import { PctPill } from "./Change";
import { Sparkline } from "./Sparkline";

function Row({ href, title, subtitle, symbol, price, changePct }: { href: string; title: string; subtitle?: string; symbol: string; price: number; changePct: number }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-5 py-3 transition hover:bg-elevated">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      <Sparkline symbol={symbol} up={changePct >= 0} />
      <div className="w-20 text-right">
        <div className="text-sm">{usd(price)}</div>
        <PctPill percent={changePct} />
      </div>
    </Link>
  );
}

export function SymbolLists({ positions, watchlist }: { positions: LivePosition[]; watchlist: { symbol: string; price: number; changePct: number }[] }) {
  const held = new Set(positions.map((p) => p.symbol));
  const watching = watchlist.filter((w) => !held.has(w.symbol));
  return (
    <aside className="overflow-hidden rounded-lg border border-line lg:sticky lg:top-22">
      <h2 className="border-b border-line px-5 py-4 font-semibold">Holdings</h2>
      {positions.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">You don't own anything yet.</p>
      ) : (
        positions.map((p) => (
          <Row
            key={p.symbol}
            href={`/stocks/${p.symbol}`}
            title={displaySymbol(p.symbol)}
            subtitle={`${shares(p.quantity)} ${unitLabel(p.symbol, p.quantity)}`}
            symbol={p.symbol}
            price={p.price}
            changePct={p.prevClose ? ((p.price - p.prevClose) / p.prevClose) * 100 : 0}
          />
        ))
      )}
      <h2 className="border-y border-line px-5 py-4 font-semibold">Watchlist</h2>
      {watching.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">Add stocks from their page to keep an eye on them.</p>
      ) : (
        watching.map((w) => <Row key={w.symbol} href={`/stocks/${w.symbol}`} title={displaySymbol(w.symbol)} symbol={w.symbol} price={w.price} changePct={w.changePct} />)
      )}
    </aside>
  );
}

const POPULAR = [
  ["AAPL", "Apple"],
  ["MSFT", "Microsoft"],
  ["NVDA", "NVIDIA"],
  ["AMZN", "Amazon"],
  ["GOOGL", "Alphabet"],
  ["META", "Meta"],
  ["TSLA", "Tesla"],
  ["SPY", "S&P 500 ETF"],
  ["BTC-USD", "Bitcoin · trades 24/7"],
] as const;

export function PopularStocks() {
  useLiveSubscription(POPULAR.map(([s]) => s));
  const prices = usePriceStore((s) => s.prices);
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-xl font-semibold">Get started</h2>
      <p className="mb-4 text-sm text-muted">You have {usd(STARTING_CASH)} to practice with. Pick a stock or search above.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {POPULAR.map(([symbol, name]) => (
          <Link key={symbol} href={`/stocks/${symbol}`} className="rounded-lg border border-line p-4 transition hover:border-muted">
            <div className="font-semibold">{displaySymbol(symbol)}</div>
            <div className="truncate text-xs text-muted">{name}</div>
            <div className="mt-3 text-sm">{prices[symbol] ? usd(prices[symbol].price) : "—"}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
