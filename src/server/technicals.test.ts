import { describe, expect, it } from "vitest";
import { candlestickPatterns, rsi, sma, volatility } from "./technicals";
import type { Bar } from "./yahoo";

const bar = (open: number, high: number, low: number, close: number, i = 0): Bar => ({
  time: i,
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  open,
  high,
  low,
  close,
  volume: 0,
});
/** A gentle five-day trend before the candles under test. */
const lead = (start: number, step: number) => Array.from({ length: 5 }, (_, i) => bar(start + i * step, start + i * step + 0.5, start + i * step - 0.5, start + (i + 1) * step, i));

describe("indicators", () => {
  const rising = Array.from({ length: 30 }, (_, i) => bar(100 + i, 101 + i, 99 + i, 100 + i, i));

  it("averages the last n closes", () => {
    expect(sma(rising, 5)).toBe(127);
    expect(sma(rising, 50)).toBeNull();
  });

  it("puts RSI at 100 for a steady rise and near 50 for a zigzag", () => {
    expect(rsi(rising)).toBe(100);
    const zigzag = Array.from({ length: 40 }, (_, i) => bar(100, 101, 99, i % 2 ? 101 : 100, i));
    expect(rsi(zigzag)!).toBeGreaterThan(40);
    expect(rsi(zigzag)!).toBeLessThan(60);
  });

  it("measures zero volatility for a flat price", () => {
    expect(volatility(Array.from({ length: 40 }, (_, i) => bar(100, 100, 100, 100, i)))).toBe(0);
  });
});

describe("candlestickPatterns", () => {
  it("finds a bullish engulfing candle", () => {
    const bars = [...lead(110, -1), bar(105, 105.5, 102.5, 103, 5), bar(102.5, 106.5, 102, 106, 6)];
    expect(candlestickPatterns(bars)).toContain("bullish engulfing");
  });

  it("finds a hammer only after a decline", () => {
    const hammer = bar(100, 100.6, 96, 100.5, 6);
    expect(candlestickPatterns([...lead(110, -2), bar(101, 101.5, 100, 100.2, 5), hammer])).toContain("hammer (bullish reversal)");
    expect(candlestickPatterns([...lead(90, 2), bar(99, 100, 98.5, 99.8, 5), hammer])).not.toContain("hammer (bullish reversal)");
  });

  it("finds a doji and three white soldiers", () => {
    expect(candlestickPatterns([...lead(100, 0), bar(100, 101, 99, 100, 5), bar(100, 102, 98, 100.1, 6)])).toContain("doji (indecision)");
    const soldiers = [...lead(100, 0), bar(100, 102.2, 99.8, 102, 5), bar(101, 104.2, 100.8, 104, 6), bar(103, 106.2, 102.8, 106, 7)];
    expect(candlestickPatterns(soldiers)).toContain("three white soldiers (bullish)");
  });
});
