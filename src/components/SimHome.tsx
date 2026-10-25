"use client";

import Link from "next/link";
import { useFetch } from "@/lib/api";
import { pct, usd } from "@/lib/format";
import { GEMINI_RUNS, RANDOM_RUNS, SIM_SLICE, STARTING_CASH, simDate, type SimInfo } from "@/lib/sim";
import { usePortfolio } from "@/lib/usePortfolio";
import type { UniverseRow } from "@/server/asOf";
import { SymbolLists } from "./SymbolLists";

/** Home page while in a simulation: the user's $20k slice, priced at the start date. */
export function SimHome({ sim }: { sim: SimInfo }) {
  const { portfolio, error } = usePortfolio();
  const universe = useFetch<{ universe: UniverseRow[] }>("/api/sim/universe", { refreshMs: sim.status === "PREPARING" ? 5000 : 0 });

  if (error) return <p className="text-down">{error}</p>;
  if (!portfolio) return <div className="h-96 animate-pulse rounded-lg bg-surface" />;

  const rows = universe.data?.universe ?? [];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <p className="text-sm text-muted">Your slice on {simDate(sim.startDate)}</p>
        <h1 className="text-4xl font-semibold tracking-tight">{usd(portfolio.totalValue)}</h1>

        <dl className="mt-6 divide-y divide-line border-y border-line">
          <div className="flex justify-between py-4">
            <dt>Cash to invest</dt>
            <dd className="font-semibold">{usd(portfolio.cash)}</dd>
          </div>
          <div className="flex justify-between py-4 text-sm text-muted">
            <dt>Invested</dt>
            <dd>{usd(portfolio.invested)}</dd>
          </div>
        </dl>

        <section className="mt-8 rounded-lg border border-line p-5 text-sm leading-6 text-muted">
          <h2 className="mb-2 font-semibold text-fg">How this simulation works</h2>
          <p>
            It is {simDate(sim.startDate)}. Your {usd(STARTING_CASH)} is split into 50 slices of {usd(SIM_SLICE)}. You trade one
            slice yourself, and Gemini trades the other {GEMINI_RUNS}, each run on its own; {RANDOM_RUNS} random portfolios serve
            as a no-skill baseline. Every order fills at that day&apos;s close, and prices, charts and stats only show what was known
            then. When you lock in, everything is held until {sim.endDate ? simDate(sim.endDate) : "today"} and valued at that
            day&apos;s {sim.endDate ? "close" : "prices"}.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="mb-1 text-xl font-semibold">Gemini&apos;s stock list</h2>
          <p className="mb-4 text-sm text-muted">
            Gemini picks from these. You can trade any US stock: search above.
          </p>
          {rows.length === 0 ? (
            <div className="h-40 animate-pulse rounded-lg bg-surface" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {rows.map((r) => (
                <Link key={r.symbol} href={`/stocks/${r.symbol}`} className="rounded-lg border border-line p-4 transition hover:border-muted">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.symbol}</span>
                    <span className="text-sm">{usd(r.price)}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{r.name}</div>
                  <div className="mt-2 flex justify-between text-xs text-muted">
                    <span>
                      3M{" "}
                      {r.ret3m == null ? "—" : <span className={r.ret3m >= 0 ? "text-up" : "text-down"}>{pct(r.ret3m)}</span>}
                    </span>
                    <span>P/E {r.pe ?? "—"}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <SymbolLists positions={portfolio.positions} watchlist={portfolio.watchlist} />
    </div>
  );
}
