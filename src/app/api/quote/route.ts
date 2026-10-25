import { asOfQuote, asOfStats, latestPrice } from "@/server/asOf";
import { getCurrentSim } from "@/server/auth";
import { getKeyStats, getProfile, getQuote } from "@/server/finnhub";
import { priceHub } from "@/server/priceHub";
import { fail, json, withUser } from "@/server/http";
import { normalizeSymbol } from "@/server/symbols";

export const GET = withUser(async (_user, req) => {
  const symbol = normalizeSymbol(new URL(req.url).searchParams.get("symbol"));
  if (!symbol) return fail("Invalid symbol");

  const sim = await getCurrentSim();
  if (sim) {
    // Everything as it stood on the start date.
    const date = sim.startDate.toISOString().slice(0, 10);
    const [quote, profile, stats, now] = await Promise.all([
      asOfQuote(symbol, date).catch(() => null),
      getProfile(symbol).catch(() => null),
      asOfStats(symbol, date).catch(() => null),
      latestPrice(symbol),
    ]);
    if (!quote) return fail(`No data for ${symbol} on ${date}`, 404);
    const marketCap = profile?.marketCap && now ? (profile.marketCap * quote.price) / now : 0;
    return json({ symbol, quote, profile: profile && { ...profile, marketCap }, stats });
  }

  const [quote, profile, stats] = await Promise.all([
    getQuote(symbol),
    getProfile(symbol).catch(() => null),
    getKeyStats(symbol).catch(() => null),
  ]);
  if (!quote) return fail(`Unknown symbol ${symbol}`, 404);
  const live = priceHub.peek(symbol);
  const price = live && live.time > quote.time * 1000 ? live.price : quote.price;
  return json({ symbol, quote: { ...quote, price }, profile, stats });
});
