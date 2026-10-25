import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./priceHub", () => ({
  priceHub: { getPrice: vi.fn(), setPinned: vi.fn(), peek: vi.fn() },
}));

import { prisma } from "./db";
import { cancelOrder, placeOrder, processLimitOrders, resetAccount, STARTING_CASH, TradeError } from "./trading";

let price = 100;
const getPrice = async () => price;

async function newUser() {
  return prisma.user.create({
    data: { email: `${Math.random()}@test.dev`, name: "T", passwordHash: "x", cash: STARTING_CASH },
  });
}

const cash = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).cash.toNumber();
const position = (userId: string, symbol = "AAPL") =>
  prisma.position.findUnique({ where: { userId_symbol: { userId, symbol } } });

describe("market orders", () => {
  let userId: string;
  beforeEach(async () => {
    price = 100;
    userId = (await newUser()).id;
  });

  it("buys shares and debits cash", async () => {
    const o = await placeOrder(userId, { symbol: "aapl", side: "BUY", type: "MARKET", quantity: 10 }, getPrice);
    expect(o.status).toBe("FILLED");
    expect(o.fillPrice!.toNumber()).toBe(100);
    expect(await cash(userId)).toBe(STARTING_CASH - 1000);
    expect((await position(userId))!.quantity.toNumber()).toBe(10);
  });

  it("buys a dollar amount as fractional shares", async () => {
    price = 300;
    const o = await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", notional: 1000 }, getPrice);
    expect(o.quantity.toNumber()).toBeCloseTo(3.333333, 6);
    expect(await cash(userId)).toBeCloseTo(STARTING_CASH - 1000, 1);
  });

  it("averages cost across buys", async () => {
    await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 10 }, getPrice);
    price = 130;
    await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 20 }, getPrice);
    const p = (await position(userId))!;
    expect(p.quantity.toNumber()).toBe(30);
    expect(p.avgCost.toNumber()).toBe(120);
  });

  it("sells, credits cash and closes the position", async () => {
    await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 10 }, getPrice);
    price = 110;
    await placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "MARKET", quantity: 4 }, getPrice);
    expect((await position(userId))!.quantity.toNumber()).toBe(6);
    expect(await cash(userId)).toBe(STARTING_CASH - 1000 + 440);
    await placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "MARKET", quantity: 6 }, getPrice);
    expect(await position(userId)).toBeNull();
    expect(await cash(userId)).toBe(STARTING_CASH + 100);
  });

  it("rejects buying more than buying power", async () => {
    await expect(
      placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: STARTING_CASH / 100 + 1 }, getPrice),
    ).rejects.toThrow(/buying power/);
    expect(await cash(userId)).toBe(STARTING_CASH);
  });

  it("rejects selling shares you do not own (no shorting)", async () => {
    await expect(
      placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "MARKET", quantity: 1 }, getPrice),
    ).rejects.toBeInstanceOf(TradeError);
  });

  it("rejects bad input and unknown prices", async () => {
    await expect(placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 0 }, getPrice)).rejects.toThrow();
    await expect(placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", notional: 0.5 }, getPrice)).rejects.toThrow(/\$1/);
    await expect(placeOrder(userId, { symbol: "!!", side: "BUY", type: "MARKET", quantity: 1 }, getPrice)).rejects.toThrow(/symbol/);
    await expect(
      placeOrder(userId, { symbol: "ZZZZ", side: "BUY", type: "MARKET", quantity: 1 }, async () => null),
    ).rejects.toThrow(/No price/);
  });
});

describe("limit orders", () => {
  let userId: string;
  beforeEach(async () => {
    price = 100;
    userId = (await newUser()).id;
  });

  it("rests below market, reserves cash, then fills when price crosses", async () => {
    const o = await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "LIMIT", quantity: 9000, limitPrice: 95 }, getPrice);
    expect(o.status).toBe("PENDING");
    expect(await cash(userId)).toBe(STARTING_CASH);
    // 9,000 * 95 = 855,000 reserved, so a 2,000-share market buy (200,000) no longer fits.
    await expect(
      placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 2000 }, getPrice),
    ).rejects.toThrow(/buying power/);

    expect(await processLimitOrders("AAPL", 96)).toEqual([]);
    expect(await processLimitOrders("AAPL", 94.5)).toEqual([userId]);
    const filled = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(filled.status).toBe("FILLED");
    expect(filled.fillPrice!.toNumber()).toBe(94.5);
    expect(await cash(userId)).toBe(STARTING_CASH - 9000 * 94.5);
  });

  it("fills a marketable limit immediately at the better market price", async () => {
    const o = await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "LIMIT", quantity: 1, limitPrice: 105 }, getPrice);
    expect(o.status).toBe("FILLED");
    expect(o.fillPrice!.toNumber()).toBe(100);
  });

  it("reserves shares for sell limits and can be canceled", async () => {
    await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 5 }, getPrice);
    const o = await placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "LIMIT", quantity: 5, limitPrice: 120 }, getPrice);
    expect(o.status).toBe("PENDING");
    await expect(
      placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "MARKET", quantity: 1 }, getPrice),
    ).rejects.toThrow(/only sell 0/);
    await cancelOrder(userId, o.id);
    await expect(cancelOrder(userId, o.id)).rejects.toThrow(/not open/);
    expect(await processLimitOrders("AAPL", 130)).toEqual([]);
    expect((await position(userId))!.quantity.toNumber()).toBe(5);
  });

  it("rejects a pending order that can no longer be covered", async () => {
    await placeOrder(userId, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 5 }, getPrice);
    const o = await placeOrder(userId, { symbol: "AAPL", side: "SELL", type: "LIMIT", quantity: 5, limitPrice: 120 }, getPrice);
    // Shares vanish out from under the order (e.g. edited directly).
    await prisma.position.update({ where: { userId_symbol: { userId, symbol: "AAPL" } }, data: { quantity: 1 } });
    await processLimitOrders("AAPL", 125);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.reason).toMatch(/only sell/);
  });
});

describe("resetAccount", () => {
  it("restores the starting cash and clears positions and orders", async () => {
    const { id } = await newUser();
    await placeOrder(id, { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 10 }, getPrice);
    await resetAccount(id);
    expect(await cash(id)).toBe(STARTING_CASH);
    expect(await prisma.position.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.order.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.portfolioSnapshot.count({ where: { userId: id } })).toBe(1);
  });
});
