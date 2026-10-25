import type { Bar } from "./yahoo";

// Technical indicators and classic candlestick patterns, computed only from bars up to the start date.

const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** Simple moving average of the last `n` closes, or null without enough history. */
export function sma(bars: Bar[], n: number): number | null {
  return bars.length >= n ? avg(bars.slice(-n).map((b) => b.close)) : null;
}

/** Wilder's 14-day RSI: above 70 is usually called overbought, below 30 oversold. */
export function rsi(bars: Bar[], n = 14): number | null {
  if (bars.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Annualized volatility of daily returns over the last `days` bars, in percent. */
export function volatility(bars: Bar[], days = 252): number | null {
  const recent = bars.slice(-(days + 1));
  if (recent.length < 30) return null;
  const r = recent.slice(1).map((b, i) => b.close / recent[i].close - 1);
  const m = avg(r);
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
}

/** Daily percent changes of the last `n` sessions, oldest first. */
export function lastChanges(bars: Bar[], n = 5): number[] {
  const recent = bars.slice(-(n + 1));
  return recent.slice(1).map((b, i) => Number(((b.close / recent[i].close - 1) * 100).toFixed(1)));
}

const body = (b: Bar) => Math.abs(b.close - b.open);
const range = (b: Bar) => b.high - b.low;
const upper = (b: Bar) => b.high - Math.max(b.open, b.close);
const lower = (b: Bar) => Math.min(b.open, b.close) - b.low;
const green = (b: Bar) => b.close > b.open;
const red = (b: Bar) => b.close < b.open;

/**
 * Classic candlestick patterns ending on the last bar (textbook definitions). Hammer and shooting
 * star only count after a 5-day decline or rise, as the definitions require.
 */
export function candlestickPatterns(bars: Bar[]): string[] {
  const found: string[] = [];
  const n = bars.length;
  if (n < 6) return found;
  const [a, b, c] = [bars[n - 3], bars[n - 2], bars[n - 1]];
  const priorMove = bars[n - 2].close / bars[n - 6].close - 1;

  if (range(c) > 0 && body(c) <= 0.1 * range(c)) found.push("doji (indecision)");
  if (body(c) > 0 && lower(c) >= 2 * body(c) && upper(c) <= body(c) && priorMove < 0) found.push("hammer (bullish reversal)");
  if (body(c) > 0 && upper(c) >= 2 * body(c) && lower(c) <= body(c) && priorMove > 0) found.push("shooting star (bearish reversal)");
  if (red(b) && green(c) && c.open <= b.close && c.close >= b.open && body(c) > body(b)) found.push("bullish engulfing");
  if (green(b) && red(c) && c.open >= b.close && c.close <= b.open && body(c) > body(b)) found.push("bearish engulfing");
  if ([a, b, c].every(green) && b.close > a.close && c.close > b.close && b.open > a.open && c.open > b.open) {
    found.push("three white soldiers (bullish)");
  }
  if ([a, b, c].every(red) && b.close < a.close && c.close < b.close && b.open < a.open && c.open < b.open) {
    found.push("three black crows (bearish)");
  }
  return found;
}
