"use client";

import Link from "next/link";
import { useState } from "react";
import { api, revalidate, useFetch } from "@/lib/api";
import { usd } from "@/lib/format";
import { SIM_SLICE, STARTING_CASH, simDate, simPeriod } from "@/lib/sim";
import { useSim } from "@/lib/simContext";
import { usePortfolio } from "@/lib/usePortfolio";
import { Change } from "./Change";
import { OrdersTable, type OrderRow } from "./OrdersTable";

type SimSummary = { id: string; startDate: string; endDate: string | null; status: string; userFinal: number | null };

export function AccountView() {
  const { portfolio } = usePortfolio();
  const orders = useFetch<{ orders: OrderRow[] }>("/api/orders");
  const sims = useFetch<{ simulations: SimSummary[] }>("/api/sim/list");
  const sim = useSim();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      await api("/api/account/reset", { method: "POST" });
      revalidate("/api/");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const start = sim ? SIM_SLICE : STARTING_CASH;
  const allTime = portfolio ? portfolio.totalValue - start : 0;

  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-3xl font-semibold">{sim ? `Simulation slice · ${simDate(sim.startDate)}` : "Account"}</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <Tile label="Total portfolio value" value={portfolio ? usd(portfolio.totalValue) : "—"} />
          <Tile label="Invested" value={portfolio ? usd(portfolio.invested) : "—"} />
          <Tile label="Cash" value={portfolio ? usd(portfolio.cash) : "—"} />
          <Tile label="Buying power" value={portfolio ? usd(portfolio.buyingPower) : "—"} />
        </div>
        {portfolio && !sim && (
          <p className="mt-4">
            <span className="text-muted">All-time return since starting with {usd(STARTING_CASH)}: </span>
            <Change amount={allTime} percent={(allTime / STARTING_CASH) * 100} />
          </p>
        )}
      </section>

      <section>
        <h2 className="border-b border-line pb-3 text-xl font-semibold">Order history</h2>
        {orders.data ? <OrdersTable orders={orders.data.orders} /> : <div className="mt-4 h-32 animate-pulse rounded bg-surface" />}
      </section>

      {!!sims.data?.simulations.length && (
        <section>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <h2 className="text-xl font-semibold">Simulations</h2>
            <Link href="/simulations" className="text-sm text-sim hover:underline">
              Compare across periods →
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {sims.data.simulations.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>{simPeriod(s.startDate, s.endDate)}</span>
                {s.status === "REVEALED" && s.userFinal != null ? (
                  <Link href={`/simulations/${s.id}`} className="flex items-center gap-4 hover:underline">
                    <Change amount={s.userFinal - SIM_SLICE} percent={((s.userFinal - SIM_SLICE) / SIM_SLICE) * 100} />
                    <span className="text-sim">Results →</span>
                  </Link>
                ) : (
                  <span className="text-muted">In progress</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!sim && <section className="rounded-lg border border-line p-5">
        <h2 className="font-semibold">Reset account</h2>
        <p className="mt-1 text-sm text-muted">
          Deletes every position, order and chart point and sets your cash back to {usd(STARTING_CASH)}. Your watchlist is kept.
        </p>
        {confirming ? (
          <div className="mt-4 flex gap-3">
            <button onClick={() => setConfirming(false)} className="rounded-full border border-line px-5 py-2 text-sm font-semibold">
              Keep my account
            </button>
            <button disabled={busy} onClick={reset} className="rounded-full bg-down px-5 py-2 text-sm font-semibold text-black disabled:opacity-60">
              {busy ? "Resetting…" : "Yes, reset to {usd(STARTING_CASH)}"}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="mt-4 rounded-full border border-down px-5 py-2 text-sm font-semibold text-down">
            Reset account
          </button>
        )}
      </section>}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
