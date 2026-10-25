import { describe, expect, it } from "vitest";
import { RULES, equalWeight, type Signals } from "./simRules";

const s = (symbol: string, o: Partial<Signals> = {}): Signals => ({
  symbol,
  etf: false,
  price: 100,
  ret1m: 0,
  ret12m: 0,
  pe: 20,
  vol: 30,
  ma50: 95,
  ma200: 90,
  ...o,
});
const rule = (key: string) => RULES.find((r) => r.key === key)!;

describe("rules", () => {
  const signals = [
    s("A", { ret12m: 50, ret1m: 0, pe: 10, vol: 15 }),
    s("B", { ret12m: 50, ret1m: 40, pe: -5, vol: 50, ma50: 80 }),
    s("C", { ret12m: 5, ret1m: -12, pe: 35, vol: 25, price: 85 }),
    s("SPY", { etf: true, ret12m: 99, pe: 1, vol: 1 }),
  ];

  it("momentum skips the latest month and leaves out ETFs", () => {
    expect(rule("momentum").pick(signals)[0]).toBe("A"); // B's gain came mostly in the last month
    expect(rule("momentum").pick(signals)).not.toContain("SPY");
  });

  it("value takes the lowest positive P/E, low volatility the calmest stocks", () => {
    expect(rule("value").pick(signals)).toEqual(["A", "C"]);
    expect(rule("lowvol").pick(signals)[0]).toBe("A");
  });

  it("trend needs a golden cross and a price above the 200-day average", () => {
    expect(rule("trend").pick(signals)).toEqual(["A"]); // B: 50-day below 200-day; C: price below 200-day
  });

  it("buy-the-dip takes last month's biggest losers", () => {
    expect(rule("reversal").pick(signals)[0]).toBe("C");
  });

  it("splits money equally and keeps cash when nothing qualifies", () => {
    expect(equalWeight(["B", "A"], 20_000)).toEqual([
      { symbol: "A", dollars: 10_000 },
      { symbol: "B", dollars: 10_000 },
    ]);
    expect(equalWeight([], 20_000)).toEqual([]);
  });
});
