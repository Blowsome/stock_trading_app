import { asOfHistory } from "@/server/asOf";
import { getCurrentSim } from "@/server/auth";
import { getHistory, RANGES, type Range } from "@/server/yahoo";
import { fail, json, withUser } from "@/server/http";
import { normalizeSymbol } from "@/server/symbols";

export const GET = withUser(async (_user, req) => {
  const params = new URL(req.url).searchParams;
  const symbol = normalizeSymbol(params.get("symbol"));
  const range = (params.get("range") ?? "1D") as Range;
  if (!symbol) return fail("Invalid symbol");
  if (!RANGES.includes(range)) return fail("Invalid range");
  const sim = await getCurrentSim();
  if (sim) return json(await asOfHistory(symbol, sim.startDate.toISOString().slice(0, 10), range));
  return json(await getHistory(symbol, range));
});
