"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useFetch } from "@/lib/api";
import { pct, shares, usd } from "@/lib/format";
import { simDate } from "@/lib/sim";
import type { PathResult } from "@/server/simulation";
import { RULES, ruleLabel } from "@/server/simRules";
import { personaLabel } from "@/server/personas";
import { PersonaStrips, PersonaTable } from "./PersonaStrips";
import type { Dist, SimStats } from "@/server/simMath";
import { Change } from "./Change";
import { ReturnHistogram, binsFor, type Marker } from "./ReturnHistogram";

type Results = {
  id: string;
  startDate: string;
  endDate: string;
  revealedAt: string;
  slice: number;
  paths: PathResult[];
  stats: SimStats;
  prompt: { systems: { persona: string | null; text: string }[]; user: string; temperature: number };
  /** 1: prices, returns, P/E, beta. 2: also news and technical/candlestick data. */
  dataVersion: number;
};

type Filter = "ALL" | "GEMINI" | "RANDOM" | "RULE";

/** Below this p-value the Gemini-vs-random gap is called a real difference. */
const SIGNIFICANT = 0.05;

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const pathName = (p: PathResult) =>
  p.kind === "USER"
    ? "You"
    : p.kind === "BENCHMARK"
      ? "S&P 500 (SPY)"
      : p.kind === "RANDOM"
        ? `Random #${p.runIndex}`
        : p.kind === "RULE"
          ? `Rule: ${ruleLabel(p.strategy)}`
          : `Gemini #${p.runIndex}`;

type Entry = { label: string; value: number; swatch: string; strong?: boolean };

/** Every strategy's return, best first, as bars growing left or right from zero. */
function Leaderboard({ entries }: { entries: Entry[] }) {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((e) => Math.abs(e.value)), 0.01);
  const hasNegative = sorted.some((e) => e.value < 0);
  return (
    <ul className="space-y-1.5" role="list">
      {sorted.map((e) => {
        const width = (Math.abs(e.value) / max) * (hasNegative ? 50 : 100);
        return (
          <li key={e.label} className="grid grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-3 text-sm">
            <span className={`flex items-center gap-2 truncate ${e.strong ? "font-semibold" : "text-muted"}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e.swatch }} aria-hidden />
              {e.label}
            </span>
            <span className="relative h-4">
              {hasNegative && <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden />}
              <span
                className={`absolute inset-y-0.5 rounded-sm ${e.value >= 0 ? "bg-up" : "bg-down"}`}
                style={{
                  width: `${width}%`,
                  left: hasNegative ? (e.value >= 0 ? "50%" : `${50 - width}%`) : 0,
                  opacity: e.strong ? 1 : 0.7,
                }}
              />
            </span>
            <span className={`text-right ${e.value >= 0 ? "text-up" : "text-down"} ${e.strong ? "font-semibold" : ""}`}>{pct(e.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const signedPoints = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} points`;

export function SimResults({ id }: { id: string }) {
  const { data, error } = useFetch<Results>(`/api/sim/${encodeURIComponent(id)}/results`);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  if (error) return <p className="py-24 text-center text-muted">{error}</p>;
  if (!data) return <div className="h-96 animate-pulse rounded-lg bg-surface" />;

  const { stats, slice } = data;
  const gemini = data.paths.filter((p) => p.kind === "GEMINI" && !p.error);
  const random = data.paths.filter((p) => p.kind === "RANDOM");
  const failed = data.paths.filter((p) => p.kind === "GEMINI" && p.error).length;
  const models = Object.entries(
    gemini.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.model ?? "unknown"]: (acc[p.model ?? "unknown"] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const shown = [...data.paths]
    .filter((p) => filter === "ALL" || p.kind === filter || p.kind === "USER")
    .sort((a, b) => b.returnPct - a.returnPct);

  const markers: Marker[] = [
    { label: "You", value: stats.user },
    ...(stats.benchmark != null ? [{ label: "S&P 500", value: stats.benchmark, dashed: true }] : []),
  ];
  const bins = binsFor([...gemini, ...random].map((p) => p.returnPct).concat(markers.map((m) => m.value)));

  const { meanDiff, pValue } = stats.geminiVsRandom;
  const verdict =
    pValue < SIGNIFICANT
      ? meanDiff > 0
        ? "Gemini's edge over random picks is bigger than chance usually produces."
        : "Gemini did worse than random picks, by more than chance usually produces."
      : "A gap this size shows up often by chance alone, so this simulation shows no real evidence that Gemini picks better (or worse) than random.";

  const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-lg border border-line p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <div className="mt-1 text-sm">{sub}</div>}
    </div>
  );
  const distLine = (d: Dist) => `Best ${pct(d.max)} · worst ${pct(d.min)} · standard deviation ${d.stdev.toFixed(2)} points`;
  const tab = (f: Filter, label: string) => (
    <button
      key={f}
      role="tab"
      aria-selected={filter === f}
      onClick={() => setFilter(f)}
      className={`rounded px-3 py-1.5 text-xs font-semibold ${filter === f ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-sim">Simulation results</p>
          <Link href="/simulations" className="text-sm text-sim hover:underline">
            Compare all periods →
          </Link>
        </div>
        <h1 className="mt-1 text-3xl font-semibold">
          {simDate(data.startDate)} → {simDate(data.endDate)}
        </h1>
        <p className="mt-3 text-lg">
          You beat <strong>{stats.gemini.count - stats.gemini.beatUser}</strong> of {stats.gemini.count} Gemini runs (
          {ordinal(Math.round(stats.gemini.userPercentile))} percentile) and <strong>{stats.random.count - stats.random.beatUser}</strong> of{" "}
          {stats.random.count} random portfolios ({ordinal(Math.round(stats.random.userPercentile))} percentile).
        </p>
      </section>

      <section className="rounded-lg border border-line p-5">
        <h2 className="font-semibold">Did Gemini pick better than random?</h2>
        <p className="mt-2 leading-7">
          Gemini&apos;s runs averaged <strong>{pct(stats.gemini.mean)}</strong>; random portfolios averaged{" "}
          <strong>{pct(stats.random.mean)}</strong>. Difference: <strong>{signedPoints(meanDiff)}</strong> (p ={" "}
          {pValue < 0.001 ? "< 0.001" : pValue.toFixed(3)}). {verdict}
        </p>
        <p className="mt-2 text-sm text-muted">
          p is the chance of a gap at least this big if Gemini&apos;s and the random returns came from the same pool (permutation test,
          10,000 shuffles). Every run shares the same {simDate(data.startDate)} start, so this tests one market period. Skill shows up
          as an edge that repeats across many different periods.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tile("Your slice", usd(slice * (1 + stats.user / 100)), <Change amount={(slice * stats.user) / 100} percent={stats.user} />)}
        {tile("Gemini median", pct(stats.gemini.median), <span className="text-muted">mean {pct(stats.gemini.mean)}</span>)}
        {tile("Random median", pct(stats.random.median), <span className="text-muted">mean {pct(stats.random.mean)}</span>)}
        {tile("S&P 500 buy and hold", stats.benchmark != null ? pct(stats.benchmark) : "—", <span className="text-muted">reference</span>)}
        {tile(
          `You + Gemini, ${usd(stats.combined.start)}`,
          usd(stats.combined.final),
          <Change amount={stats.combined.final - stats.combined.start} percent={stats.combined.returnPct} />,
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-3 w-3 rounded-sm bg-sim" aria-hidden />
            Gemini · {stats.gemini.count} runs
          </h2>
          <p className="mt-1 text-sm text-muted">{distLine(stats.gemini)}</p>
          <div className="mt-3">
            <ReturnHistogram values={gemini.map((p) => p.returnPct)} markers={markers} bins={bins} color="var(--color-sim)" unit="Gemini run" />
          </div>
        </div>
        <div className="rounded-lg border border-line p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-3 w-3 rounded-sm bg-rand" aria-hidden />
            Random picks · {stats.random.count} runs
          </h2>
          <p className="mt-1 text-sm text-muted">{distLine(stats.random)}</p>
          <div className="mt-3">
            <ReturnHistogram values={random.map((p) => p.returnPct)} markers={markers} bins={bins} color="var(--color-rand)" unit="random run" />
          </div>
        </div>
        <p className="text-center text-xs text-muted lg:col-span-2">
          Return over the period, in {Number(bins.step.toFixed(1))}-point buckets on the same scale · bar height = number of runs
        </p>
      </section>

      {stats.personas.length > 0 && (
        <section className="rounded-lg border border-line p-5">
          <h2 className="font-semibold">Gemini by investing style</h2>
          <p className="mt-1 text-sm text-muted">
            Each Gemini run played an experienced investor with a preferred style who also weighed the news, the fundamentals and the
            chart data. Dots are runs; the square is the same style applied as a pure mechanical rule. Gemini beats its rule when the
            dots sit to the right of the square.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sim" aria-hidden /> Gemini run
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-fg" aria-hidden /> Pure rule
            </span>
          </div>
          <div className="mt-3">
            <PersonaStrips stats={stats} />
          </div>
          <div className="mt-4">
            <PersonaTable stats={stats} />
          </div>
        </section>
      )}

      <section className="rounded-lg border border-line p-5">
        <h2 className="font-semibold">Strategy leaderboard</h2>
        <p className="mt-1 text-sm text-muted">
          You, Gemini&apos;s average run, the random average, the S&P 500 and six well-known rules, all starting with {usd(slice)} on
          the same day. Open the Rules tab below to see what each rule bought.
        </p>
        <div className="mt-4">
          <Leaderboard
            entries={[
              { label: "You", value: stats.user, swatch: "var(--color-fg)", strong: true },
              { label: "Gemini (average)", value: stats.gemini.mean, swatch: "var(--color-sim)", strong: true },
              { label: "Random (average)", value: stats.random.mean, swatch: "var(--color-rand)", strong: true },
              ...(stats.benchmark != null ? [{ label: "S&P 500", value: stats.benchmark, swatch: "var(--color-muted)" }] : []),
              ...stats.rules.map((r) => ({ label: ruleLabel(r.strategy), value: r.returnPct, swatch: "var(--color-line)" })),
            ]}
          />
        </div>
      </section>

      <details className="rounded-lg border border-line p-5">
        <summary className="cursor-pointer font-semibold">What Gemini saw</summary>
        <p className="mt-3 text-sm leading-6 text-muted">
          Each run got exactly this prompt, with temperature {data.prompt.temperature} so runs can differ.{" "}
          {data.dataVersion >= 2
            ? data.dataVersion >= 3
              ? "Besides prices, returns, P/E and beta, it got technical and candlestick data and up to four news articles per stock (headline and summary), chosen for how much they say: clickbait is dropped and earnings, guidance, ratings, deals and similar news come first. Every article was published before the start date's 4:00 pm New York close, and any that mention a later date are dropped."
              : "Besides prices, returns, P/E and beta, it got technical and candlestick data and up to three headlines per stock, each published before the start date's 4:00 pm New York close (later articles, and headlines naming a later date, are dropped)."
            : "This simulation predates news and technical data: Gemini got prices, returns, P/E and beta only."}{" "}
          No web search and no tools: only this prompt and what it learned in training. It answered with its reasoning and a dollar
          amount per stock.
        </p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
          System instruction{data.prompt.systems.length > 1 ? "s (one per investor persona)" : ""}
        </p>
        {data.prompt.systems.map((s) => (
          <div key={s.persona ?? "none"} className="mt-2">
            {s.persona && <p className="text-xs font-semibold">{personaLabel(s.persona)}</p>}
            <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface p-3 text-xs leading-5">{s.text}</pre>
          </div>
        ))}
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Prompt</p>
        <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-surface p-3 text-xs leading-5">{data.prompt.user}</pre>
      </details>

      <section>
        <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
          <h2 className="text-xl font-semibold">Every slice, best to worst</h2>
          <div className="flex gap-1" role="tablist">
            {tab("ALL", "All")}
            {tab("GEMINI", "Gemini")}
            {tab("RANDOM", "Random")}
            {tab("RULE", "Rules")}
          </div>
          <a
            href={`/api/sim/${encodeURIComponent(data.id)}/export`}
            className="ml-auto rounded-full border border-line px-4 py-1.5 text-xs font-semibold hover:border-muted"
          >
            Download CSV
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-3 pr-4 font-normal">#</th>
                <th className="py-3 pr-4 font-normal">Slice</th>
                <th className="py-3 pr-4 text-right font-normal">Final value</th>
                <th className="py-3 pr-4 text-right font-normal">Return</th>
                <th className="py-3 font-normal">Holdings and reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((p, i) => {
                const key = `${p.kind}-${p.runIndex}`;
                const top = [...p.holdings].sort((a, b) => b.value - a.value);
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : key)}
                      className={`cursor-pointer align-top hover:bg-surface ${p.kind === "USER" ? "bg-elevated" : ""}`}
                      aria-expanded={isOpen}
                    >
                      <td className="py-3 pr-4 text-muted">{i + 1}</td>
                      <td className="whitespace-nowrap py-3 pr-4">
                        <span className="flex items-center gap-2">
                          {p.kind === "GEMINI" && <span className="h-2.5 w-2.5 rounded-sm bg-sim" aria-hidden />}
                          {p.kind === "RANDOM" && <span className="h-2.5 w-2.5 rounded-sm bg-rand" aria-hidden />}
                          {p.kind === "RULE" && <span className="h-2.5 w-2.5 rounded-sm bg-line" aria-hidden />}
                          <span className={p.kind === "USER" ? "font-semibold" : ""}>{pathName(p)}</span>
                        </span>
                        {p.kind === "GEMINI" && p.strategy && <span className="block text-xs text-sim">{personaLabel(p.strategy)}</span>}
                        {p.kind === "GEMINI" && p.model && <span className="block text-xs text-muted">{p.model}</span>}
                        {p.error && <span className="block text-xs text-down">failed, held cash</span>}
                      </td>
                      <td className="py-3 pr-4 text-right">{usd(p.finalValue)}</td>
                      <td className={`py-3 pr-4 text-right ${p.returnPct >= 0 ? "text-up" : "text-down"}`}>{pct(p.returnPct)}</td>
                      <td className="py-3 text-muted">
                        <div className="text-fg">{top.length ? top.map((h) => h.symbol).join(", ") : "Cash"}</div>
                        {(p.kind === "GEMINI" || p.kind === "RULE") && p.reasoning && (
                          <p className={`mt-1 max-w-2xl text-xs leading-5 ${isOpen ? "" : "line-clamp-2"}`}>{p.reasoning}</p>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={4} className="pb-5 pr-4">
                          {p.error && <p className="mb-3 text-down">{p.error}</p>}
                          <table className="w-full text-xs">
                            <thead className="text-left text-muted">
                              <tr>
                                <th className="py-1.5 font-normal">Symbol</th>
                                <th className="py-1.5 text-right font-normal">Shares</th>
                                <th className="py-1.5 text-right font-normal">Bought at</th>
                                <th className="py-1.5 text-right font-normal">Now</th>
                                <th className="py-1.5 text-right font-normal">Value</th>
                                <th className="py-1.5 text-right font-normal">Return</th>
                              </tr>
                            </thead>
                            <tbody>
                              {top.map((h) => (
                                <tr key={h.symbol}>
                                  <td className="py-1.5">{h.symbol}</td>
                                  <td className="py-1.5 text-right">{shares(h.shares)}</td>
                                  <td className="py-1.5 text-right">{usd(h.avgCost)}</td>
                                  <td className="py-1.5 text-right">{usd(h.exitPrice)}</td>
                                  <td className="py-1.5 text-right">{usd(h.value)}</td>
                                  <td className={`py-1.5 text-right ${h.returnPct >= 0 ? "text-up" : "text-down"}`}>{pct(h.returnPct)}</td>
                                </tr>
                              ))}
                              <tr className="text-muted">
                                <td className="py-1.5">Cash</td>
                                <td colSpan={3} />
                                <td className="py-1.5 text-right">{usd(p.cash)}</td>
                                <td />
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs leading-5 text-muted">
        Every slice started with {usd(slice)} on {simDate(data.startDate)}, bought at that day&apos;s close, and is valued at the{" "}
        {simDate(data.endDate)} close. Random portfolios pick 3 to 8 stocks from the same list Gemini saw, in equal dollar amounts, each from its own
        fixed seed. Each rule ({RULES.map((r) => r.label).join(", ")}) uses only data known on the start date. The S&P 500, random
        runs and rules are benchmarks: the {usd(stats.combined.start)} total counts only your slice and
        Gemini&apos;s. Models used: {models.map(([m, count]) => `${m} (${count} run${count === 1 ? "" : "s"})`).join(", ")}. Gemini
        was told not to use anything after the start date, but its training data may include later events.
        {failed > 0 &&
          ` ${failed} Gemini run${failed === 1 ? "" : "s"} failed and kept the slice in cash. They count toward the total but not toward Gemini's statistics.`}
      </p>
    </div>
  );
}
