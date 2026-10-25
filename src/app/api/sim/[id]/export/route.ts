import { withUser } from "@/server/http";
import { simResults } from "@/server/simulation";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every slice as CSV: who decided, what they bought, how it did, and Gemini's reasoning. */
export const GET = withUser(async (user, _req, { params }: { params: Promise<{ id: string }> }) => {
  const r = await simResults(user.id, (await params).id);
  const header = ["slice", "run", "persona_or_rule", "model", "start_value", "final_value", "return_pct", "cash", "holdings", "reasoning", "error"];
  const rows = r.paths.map((p) => [
    p.kind.toLowerCase(),
    p.runIndex,
    p.strategy,
    p.model,
    r.slice,
    p.finalValue.toFixed(2),
    p.returnPct.toFixed(2),
    p.cash.toFixed(2),
    p.holdings.map((h) => `${h.symbol} $${(h.shares * h.avgCost).toFixed(0)} (${h.returnPct >= 0 ? "+" : ""}${h.returnPct.toFixed(2)}%)`).join("; "),
    p.reasoning,
    p.error,
  ]);
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="simulation-${r.startDate}-${r.id}.csv"`,
    },
  });
});
