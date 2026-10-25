import { prisma } from "@/server/db";
import { fail, json, withUser } from "@/server/http";
import { normalizeSymbol } from "@/server/symbols";

export const POST = withUser(async (user, req) => {
  const symbol = normalizeSymbol((await req.json().catch(() => ({}))).symbol);
  if (!symbol) return fail("Invalid symbol");
  await prisma.watchlistItem.upsert({
    where: { userId_symbol: { userId: user.id, symbol } },
    create: { userId: user.id, symbol },
    update: {},
  });
  return json({ ok: true });
});

export const DELETE = withUser(async (user, req) => {
  const symbol = normalizeSymbol(new URL(req.url).searchParams.get("symbol"));
  if (!symbol) return fail("Invalid symbol");
  await prisma.watchlistItem.deleteMany({ where: { userId: user.id, symbol } });
  return json({ ok: true });
});
