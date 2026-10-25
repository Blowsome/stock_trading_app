import type { Order } from "@prisma/client";
import { getCurrentSim } from "@/server/auth";
import { prisma } from "@/server/db";
import { json, withUser } from "@/server/http";
import { recordSnapshot } from "@/server/portfolio";
import { simOrders, simTrade } from "@/server/simulation";
import { placeOrder } from "@/server/trading";

const view = (o: Order) => ({
  ...o,
  quantity: o.quantity.toNumber(),
  limitPrice: o.limitPrice?.toNumber() ?? null,
  fillPrice: o.fillPrice?.toNumber() ?? null,
});

export const GET = withUser(async (user, req) => {
  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase();
  const sim = await getCurrentSim();
  if (sim) return json({ orders: await simOrders(user.id, sim.id, symbol) });
  const orders = await prisma.order.findMany({
    where: { userId: user.id, ...(symbol && { symbol }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json({ orders: orders.map(view) });
});

export const POST = withUser(async (user, req) => {
  const body = await req.json().catch(() => ({}));
  const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
  const sim = await getCurrentSim();
  if (sim) {
    // Simulations only take market orders, filled at the start date's close.
    const t = await simTrade(user.id, sim.id, { symbol: body.symbol, side: body.side, quantity: num(body.quantity), notional: num(body.notional) });
    return json({ order: { status: "FILLED", quantity: t.shares.toNumber(), fillPrice: t.price.toNumber() } });
  }
  const order = await placeOrder(user.id, {
    symbol: body.symbol,
    side: body.side,
    type: body.type,
    quantity: num(body.quantity),
    notional: num(body.notional),
    limitPrice: num(body.limitPrice),
  });
  if (order.status === "FILLED") await recordSnapshot(user.id).catch(() => {});
  return json({ order: view(order) });
});
