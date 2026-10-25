import { describe, expect, it, vi } from "vitest";

// Previous close 100, trading at 110 now.
vi.mock("./priceHub", () => ({
  priceHub: { getPrice: vi.fn(async () => 110), setPinned: vi.fn(), peek: vi.fn(() => undefined) },
}));
vi.mock("./finnhub", () => ({
  getQuote: vi.fn(async () => ({ price: 110, prevClose: 100 })),
  getProfile: vi.fn(async () => null),
  getMarketStatus: vi.fn(async () => ({ isOpen: true })),
}));

import { prisma } from "./db";
import { getPortfolio } from "./portfolio";
import { STARTING_CASH } from "./trading";

const dayChange = (p: Awaited<ReturnType<typeof getPortfolio>>) =>
  p.positions.reduce((a, x) => a + x.quantity * x.price - x.dayBase, 0) + p.closedDayChange;

async function userWith(fills: { side: "BUY" | "SELL"; quantity: number; price: number; today: boolean }[], held: number, avgCost: number) {
  const user = await prisma.user.create({
    data: { email: `${Math.random()}@test.dev`, name: "T", passwordHash: "x", cash: STARTING_CASH },
  });
  for (const f of fills) {
    await prisma.order.create({
      data: {
        userId: user.id,
        symbol: "AAPL",
        side: f.side,
        type: "MARKET",
        quantity: f.quantity,
        status: "FILLED",
        fillPrice: f.price,
        filledAt: f.today ? new Date() : new Date(Date.now() - 3 * 86400_000),
      },
    });
  }
  if (held) await prisma.position.create({ data: { userId: user.id, symbol: "AAPL", quantity: held, avgCost } });
  return user.id;
}

describe("day change", () => {
  it("measures shares held overnight against the previous close", async () => {
    const id = await userWith([{ side: "BUY", quantity: 10, price: 90, today: false }], 10, 90);
    expect(dayChange(await getPortfolio(id))).toBeCloseTo(100); // 10 * (110 - 100)
  });

  it("measures shares bought today against their fill price", async () => {
    const id = await userWith([{ side: "BUY", quantity: 10, price: 105, today: true }], 10, 105);
    expect(dayChange(await getPortfolio(id))).toBeCloseTo(50); // 10 * (110 - 105)
  });

  it("keeps realized gains from positions closed today", async () => {
    const id = await userWith(
      [
        { side: "BUY", quantity: 10, price: 90, today: false },
        { side: "SELL", quantity: 10, price: 104, today: true },
      ],
      0,
      0,
    );
    const p = await getPortfolio(id);
    expect(p.positions).toHaveLength(0);
    expect(dayChange(p)).toBeCloseTo(40); // 10 * (104 - 100)
  });
});
