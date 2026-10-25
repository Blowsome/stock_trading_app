import { searchSymbols } from "@/server/finnhub";
import { json, withUser } from "@/server/http";

export const GET = withUser(async (_user, req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!q) return json({ results: [] });
  return json({ results: await searchSymbols(q) });
});
