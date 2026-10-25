"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, revalidate, useFetch } from "@/lib/api";
import { usd } from "@/lib/format";
import { SIM_SLICE, simDate, simPeriod, type SimStatus } from "@/lib/sim";

export type SimState = {
  id: string;
  startDate: string;
  endDate: string | null;
  status: SimStatus;
  error: string | null;
  prepared: number;
  universeSize: number;
  geminiDone: number;
  geminiFailed: number;
  geminiTotal: number;
  cash: number;
  invested: number;
};

export function useSimState() {
  const [poll, setPoll] = useState(3000);
  const { data } = useFetch<{ sim: SimState | null }>("/api/sim", { refreshMs: poll });
  const sim = data?.sim ?? null;
  // Poll only while there is progress to show.
  const busy = !sim || sim.status === "PREPARING" || sim.status === "RUNNING";
  useEffect(() => setPoll(busy ? 3000 : 0), [busy]);
  return sim;
}

/** Leaves the simulation and reloads, so live prices and caches start fresh. */
export async function exitToLive() {
  await api("/api/mode", { body: { mode: "live" } });
  window.location.href = "/";
}

export function SimBar() {
  const sim = useSimState();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string) {
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "POST" });
      revalidate("/api/sim");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (await post("/api/sim/reveal")) router.push(`/simulations/${sim!.id}`);
  }

  if (!sim) return <div className="h-12 border-b border-line bg-surface" />;

  let progress: React.ReactNode;
  if (sim.status === "PREPARING") progress = `Loading market data as of ${simDate(sim.startDate)} · ${sim.prepared}/${sim.universeSize}`;
  else if (sim.status === "RUNNING") progress = `Gemini is trading · ${sim.geminiDone}/${sim.geminiTotal} runs`;
  else if (sim.status === "READY") progress = `Gemini finished ${sim.geminiTotal} runs${sim.geminiFailed ? ` (${sim.geminiFailed} failed, kept as cash)` : ""}`;
  else if (sim.status === "FAILED") progress = <span className="text-down">Stopped: {sim.error}</span>;
  else progress = "Results are in";

  const button = "rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-50";

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
        <span className="font-semibold text-sim">Simulation · {simPeriod(sim.startDate, sim.endDate)}</span>
        <span className="text-muted">
          Your slice: {usd(sim.cash)} cash of {usd(SIM_SLICE)}
        </span>
        <span className="text-muted">{progress}</span>
        {error && <span className="text-down">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          {sim.status === "FAILED" && (
            <button disabled={busy} onClick={() => post("/api/sim/retry")} className={`${button} border border-line`}>
              Retry Gemini
            </button>
          )}
          {sim.status === "REVEALED" ? (
            <>
              <Link href={`/simulations/${sim.id}`} className={`${button} border border-line`}>
                View results
              </Link>
              <Link href="/start" className={`${button} bg-sim text-black`}>
                New simulation
              </Link>
            </>
          ) : confirming ? (
            <>
              <span className="text-xs text-muted">Your picks can&apos;t change after this.</span>
              <button onClick={() => setConfirming(false)} className={`${button} border border-line`}>
                Keep trading
              </button>
              <button disabled={busy} onClick={reveal} className={`${button} bg-sim text-black`}>
                {busy ? "Revealing…" : "Reveal"}
              </button>
            </>
          ) : (
            <button
              disabled={sim.status !== "READY"}
              title={sim.status === "READY" ? undefined : "Available once Gemini has finished"}
              onClick={() => setConfirming(true)}
              className={`${button} bg-sim text-black`}
            >
              Lock in &amp; reveal
            </button>
          )}
          <button onClick={exitToLive} className={`${button} border border-line`}>
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
