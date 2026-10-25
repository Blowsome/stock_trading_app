import { prisma, D, type Decimal, type Tx } from "./db";
import { priceHub } from "./priceHub";
import { unitLabel } from "@/lib/assets";
import { STARTING_CASH } from "@/lib/sim";
import { normalizeSymbol } from "./symbols";

export { STARTING_CASH };
const QTY_DP = 6;
const DUST = new D("0.000001");

/** A user-facing order rejection (bad input, not enough cash or shares). */
export class TradeError extends Error {}

export type PriceFn = (symbol: string) => Promise<number | null>;
const livePrice: PriceFn = (s) => priceHub.getPrice(s);

export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type OrderInput = {
  symbol: string;
  side: Side;
  type: OrderType;
  /** Shares, fractional allowed. Either this or `notional`. */
  quantity?: number;
  /** Dollar amount, market orders only. */
  notional?: number;
  limitPrice?: number;
};

const money = (d: Decimal) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);
const usd = (d: Decimal) => `$${money(d).toNumber().toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function reservedCash(tx: Tx, userId: string, excludeOrderId?: string) {
  const pending = await tx.order.findMany({
    where: { userId, status: "PENDING", side: "BUY", ...(excludeOrderId && { NOT: { id: excludeOrderId } }) },
  });
  return pending.reduce((acc, o) => acc.plus(money(o.quantity.times(o.limitPrice ?? 0))), new D(0));
}

async function reservedShares(tx: Tx, userId: string, symbol: string, excludeOrderId?: string) {
  const pending = await tx.order.findMany({
    where: { userId, symbol, status: "PENDING", side: "SELL", ...(excludeOrderId && { NOT: { id: excludeOrderId } }) },
  });
  return pending.reduce((acc, o) => acc.plus(o.quantity), new D(0));
}

/** Cash minus what pending buy limit orders have reserved. */
export async function buyingPower(tx: Tx, userId: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  return user.cash.minus(await reservedCash(tx, userId));
}

type Fill = {
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: Decimal;
  price: number;
  limitPrice?: Decimal;
  /** Set when filling an existing pending order. */
  orderId?: string;
};

async function executeFill(tx: Tx, f: Fill) {
  const price = new D(f.price);
  const amount = money(f.quantity.times(price));
  const user = await tx.user.findUniqueOrThrow({ where: { id: f.userId } });
  const key = { userId_symbol: { userId: f.userId, symbol: f.symbol } };
  const pos = await tx.position.findUnique({ where: key });

  if (f.side === "BUY") {
    const available = user.cash.minus(await reservedCash(tx, f.userId, f.orderId));
    if (amount.gt(available)) {
      throw new TradeError(`Not enough buying power. This order costs ${usd(amount)} and you have ${usd(available)}.`);
    }
    await tx.user.update({ where: { id: f.userId }, data: { cash: user.cash.minus(amount) } });
    if (pos) {
      const qty = pos.quantity.plus(f.quantity);
      const avgCost = pos.quantity.times(pos.avgCost).plus(f.quantity.times(price)).div(qty).toDecimalPlaces(6);
      await tx.position.update({ where: key, data: { quantity: qty, avgCost } });
    } else {
      await tx.position.create({ data: { userId: f.userId, symbol: f.symbol, quantity: f.quantity, avgCost: price } });
    }
  } else {
    const held = pos?.quantity ?? new D(0);
    const available = held.minus(await reservedShares(tx, f.userId, f.symbol, f.orderId));
    if (f.quantity.gt(available.plus(DUST))) {
      throw new TradeError(`You can only sell ${available.toNumber()} ${unitLabel(f.symbol)} of ${f.symbol}.`);
    }
    await tx.user.update({ where: { id: f.userId }, data: { cash: user.cash.plus(amount) } });
    const remaining = held.minus(f.quantity);
    if (remaining.lte(DUST)) await tx.position.delete({ where: key });
    else await tx.position.update({ where: key, data: { quantity: remaining } });
  }

  const filled = { status: "FILLED", fillPrice: price, filledAt: new Date() };
  if (f.orderId) return tx.order.update({ where: { id: f.orderId }, data: filled });
  return tx.order.create({
    data: {
      userId: f.userId,
      symbol: f.symbol,
      side: f.side,
      type: f.type,
      quantity: f.quantity,
      limitPrice: f.limitPrice,
      ...filled,
    },
  });
}

export async function placeOrder(userId: string, input: OrderInput, getPrice: PriceFn = livePrice) {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) throw new TradeError("Invalid symbol");
  if (input.side !== "BUY" && input.side !== "SELL") throw new TradeError("Side must be BUY or SELL");
  if (input.type !== "MARKET" && input.type !== "LIMIT") throw new TradeError("Type must be MARKET or LIMIT");

  const price = await getPrice(symbol);
  if (price == null || !(price > 0)) throw new TradeError(`No price available for ${symbol}`);

  let quantity: Decimal;
  if (input.notional != null) {
    if (input.type !== "MARKET") throw new TradeError("Dollar-amount orders must be market orders");
    if (!(input.notional >= 1)) throw new TradeError("Minimum order is $1.00");
    quantity = new D(input.notional).div(price).toDecimalPlaces(QTY_DP, D.ROUND_DOWN);
  } else {
    if (!(Number(input.quantity) > 0)) throw new TradeError("Enter a quantity greater than 0");
    quantity = new D(input.quantity!).toDecimalPlaces(QTY_DP, D.ROUND_DOWN);
  }
  if (quantity.lte(0)) throw new TradeError("Order is too small");

  if (input.type === "MARKET") {
    return prisma.$transaction((tx) => executeFill(tx, { userId, symbol, side: input.side, type: "MARKET", quantity, price }));
  }

  if (!(Number(input.limitPrice) > 0)) throw new TradeError("Enter a limit price greater than 0");
  const limitPrice = new D(input.limitPrice!).toDecimalPlaces(2);
  const marketable = input.side === "BUY" ? limitPrice.gte(price) : limitPrice.lte(price);
  if (marketable) {
    // Fills right away at the current price, which is at least as good as the limit.
    return prisma.$transaction((tx) =>
      executeFill(tx, { userId, symbol, side: input.side, type: "LIMIT", quantity, price, limitPrice }),
    );
  }

  const order = await prisma.$transaction(async (tx) => {
    if (input.side === "BUY") {
      const cost = money(quantity.times(limitPrice));
      const available = await buyingPower(tx, userId);
      if (cost.gt(available)) {
        throw new TradeError(`Not enough buying power. This order needs ${usd(cost)} and you have ${usd(available)}.`);
      }
    } else {
      const pos = await tx.position.findUnique({ where: { userId_symbol: { userId, symbol } } });
      const available = (pos?.quantity ?? new D(0)).minus(await reservedShares(tx, userId, symbol));
      if (quantity.gt(available.plus(DUST))) {
        throw new TradeError(`You can only sell ${available.toNumber()} ${unitLabel(symbol)} of ${symbol}.`);
      }
    }
    return tx.order.create({
      data: { userId, symbol, side: input.side, type: "LIMIT", quantity, limitPrice, status: "PENDING" },
    });
  });
  await refreshPendingSymbols();
  return order;
}

export async function cancelOrder(userId: string, orderId: string) {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, userId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
  if (count === 0) throw new TradeError("Order is not open");
  await refreshPendingSymbols();
}

/** Fills pending limit orders on `symbol` that `price` crosses. Returns ids of users with fills. */
export async function processLimitOrders(symbol: string, price: number): Promise<string[]> {
  const orders = await prisma.order.findMany({ where: { symbol, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  const filledUsers: string[] = [];
  for (const o of orders) {
    const limit = o.limitPrice!;
    const crosses = o.side === "BUY" ? limit.gte(price) : limit.lte(price);
    if (!crosses) continue;
    try {
      const filled = await prisma.$transaction(async (tx) => {
        const fresh = await tx.order.findUnique({ where: { id: o.id } });
        if (fresh?.status !== "PENDING") return false;
        await executeFill(tx, {
          userId: o.userId,
          symbol,
          side: o.side as Side,
          type: "LIMIT",
          quantity: o.quantity,
          price,
          orderId: o.id,
        });
        return true;
      });
      if (filled) filledUsers.push(o.userId);
    } catch (e) {
      if (!(e instanceof TradeError)) throw e;
      await prisma.order.update({ where: { id: o.id }, data: { status: "REJECTED", reason: e.message } });
    }
  }
  if (filledUsers.length) await refreshPendingSymbols();
  return filledUsers;
}

const g = globalThis as unknown as { __pendingSymbols?: Set<string> };
export const pendingSymbols = (): Set<string> => (g.__pendingSymbols ??= new Set());

/** Keeps the price feed subscribed to every symbol that has an open limit order. */
export async function refreshPendingSymbols() {
  const rows = await prisma.order.findMany({ where: { status: "PENDING" }, select: { symbol: true }, distinct: ["symbol"] });
  g.__pendingSymbols = new Set(rows.map((r) => r.symbol));
  priceHub.setPinned(g.__pendingSymbols);
}

export async function resetAccount(userId: string) {
  await prisma.$transaction([
    prisma.position.deleteMany({ where: { userId } }),
    prisma.order.deleteMany({ where: { userId } }),
    prisma.portfolioSnapshot.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { cash: STARTING_CASH } }),
    prisma.portfolioSnapshot.create({ data: { userId, totalValue: STARTING_CASH } }),
  ]);
  await refreshPendingSymbols();
}
