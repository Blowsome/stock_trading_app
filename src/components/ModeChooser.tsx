"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useFetch } from "@/lib/api";
import { usd } from "@/lib/format";
import { GEMINI_KNOWLEDGE_CUTOFF, GEMINI_RUNS, RANDOM_RUNS, SIM_MONTHS, SIM_SLICE, STARTING_CASH, simPeriod } from "@/lib/sim";
import { useSim } from "@/lib/simContext";

type SimSummary = { id: string; startDate: string; endDate: string | null; status: string };
type Window = { index: number; start: string; end: string | null };

/** Shown after login: trade live today, or start (or resume) a simulation over one past period. */
export function ModeChooser() {
  const current = useSim();
  const list = useFetch<{ simulations: SimSummary[] }>("/api/sim/list");
  const windows = useFetch<{ windows: Window[] }>("/api/sim/windows");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: "live" | "sim", period?: number) {
    setBusy(mode === "live" ? "live" : `sim-${period}`);
    setError(null);
    try {
      await api("/api/mode", { body: { mode, window: period } });
      // A full reload so live prices and cached data match the new mode.
      window.location.href = "/";
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const sims = list.data?.simulations ?? [];
  const revealedCount = sims.filter((s) => s.status === "REVEALED").length;

  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="text-3xl font-semibold">How do you want to trade?</h1>
      <p className="mt-2 text-muted">You can switch any time from the Account menu.</p>

      <button
        disabled={!!busy}
        onClick={() => choose("live")}
        className="mt-8 flex w-full flex-col rounded-lg border border-line p-6 text-left transition hover:border-muted disabled:opacity-60"
      >
        <span className="text-lg font-semibold">Trade live, starting today</span>
        <span className="mt-2 text-sm leading-6 text-muted">
          Your {usd(STARTING_CASH)} account with real-time prices, market and limit orders.
        </span>
        <span className="mt-4 text-sm font-semibold text-up">{busy === "live" ? "Opening…" : current ? "Switch to live →" : "Continue →"}</span>
      </button>

      <section className="mt-4 rounded-lg border border-line p-6">
        <h2 className="text-lg font-semibold">You vs Gemini vs random picks</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Pick a {SIM_MONTHS}-month period. You invest one {usd(SIM_SLICE)} slice at the start, Gemini invests {GEMINI_RUNS} more, and{" "}
          {RANDOM_RUNS} random portfolios set the no-skill baseline. Prices and stats show only what was known at the start. When you
          lock in, the period&apos;s outcome is revealed. Running several periods shows whether an edge holds up or was luck.
        </p>

        <ul className="mt-5 divide-y divide-line border-y border-line">
          {(windows.data?.windows ?? []).map((w) => {
            const forWindow = sims.filter((s) => s.startDate === w.start);
            const open = forWindow.find((s) => s.status !== "REVEALED");
            const done = forWindow.filter((s) => s.status === "REVEALED");
            const inTraining = w.start <= GEMINI_KNOWLEDGE_CUTOFF;
            return (
              <li key={w.index} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {simPeriod(w.start, w.end)}
                    {w.index === 0 && <span className="ml-2 text-xs font-normal text-muted">latest</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {done.length ? (
                      <Link href={`/simulations/${done[0].id}`} className="hover:underline">
                        {done.length} finished · view results
                      </Link>
                    ) : open ? (
                      "In progress"
                    ) : (
                      "Not run yet"
                    )}
                    {inTraining && <span className="text-down"> · may be inside Gemini&apos;s training data</span>}
                  </div>
                </div>
                <button
                  disabled={!!busy}
                  onClick={() => choose("sim", w.index)}
                  className="rounded-full bg-sim px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                >
                  {busy === `sim-${w.index}` ? "Setting up…" : open ? "Resume" : done.length ? "Run again" : "Start"}
                </button>
              </li>
            );
          })}
          {!windows.data && <li className="h-40 animate-pulse bg-surface" />}
        </ul>
        <p className="mt-3 text-xs leading-5 text-muted">
          Periods marked in red start before Gemini&apos;s reported training cutoff ({GEMINI_KNOWLEDGE_CUTOFF.slice(0, 7)}), so it may
          already know how they turned out. Treat their results with suspicion.
          {revealedCount > 0 && (
            <>
              {" "}
              <Link href="/simulations" className="text-sim hover:underline">
                Compare all {revealedCount} finished simulation{revealedCount === 1 ? "" : "s"} →
              </Link>
            </>
          )}
        </p>
      </section>
      {error && <p className="mt-4 text-down" role="alert">{error}</p>}
    </div>
  );
}
