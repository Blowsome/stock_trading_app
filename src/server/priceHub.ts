import { CRYPTO } from "@/lib/assets";
import { apiKey, getQuote } from "./finnhub";

// The socket uses exchange symbols for crypto (COINBASE:BTC-USD); the app uses BTC-USD.
const toFeed = (s: string) => CRYPTO[s]?.feed ?? s;
const fromFeed = new Map(Object.entries(CRYPTO).map(([s, c]) => [c.feed, s]));

export type Tick = { symbol: string; price: number; time: number };
type Listener = (ticks: Tick[]) => void;
type TickHook = (symbol: string, price: number) => void;

// Trades younger than this are trusted over the (15s cached) REST quote.
const FRESH_MS = 60_000;
const FLUSH_MS = 1_000;
// Finnhub free tier allows 50 symbols on one socket.
const MAX_SYMBOLS = 50;

/**
 * Holds the single Finnhub WebSocket for the whole server, tracks the latest
 * trade price per symbol and fans out coalesced ticks to SSE listeners.
 */
class PriceHub {
  private ws: WebSocket | null = null;
  private connecting = false;
  private retry = 0;
  private listeners = new Map<string, Set<Listener>>();
  private pinned = new Set<string>(); // symbols with pending orders
  private subscribed = new Set<string>();
  private last = new Map<string, Tick>();
  private dirty = new Map<string, Tick>();
  private hooks = new Set<TickHook>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** Subscribes a listener to live ticks; returns the unsubscribe function. */
  subscribe(symbols: string[], listener: Listener): () => void {
    for (const s of symbols) {
      let set = this.listeners.get(s);
      if (!set) this.listeners.set(s, (set = new Set()));
      set.add(listener);
    }
    this.sync();
    return () => {
      for (const s of symbols) {
        const set = this.listeners.get(s);
        set?.delete(listener);
        if (set && set.size === 0) this.listeners.delete(s);
      }
      this.sync();
    };
  }

  /** Keeps symbols subscribed with no listeners, so pending limit orders see every trade. */
  setPinned(symbols: Iterable<string>) {
    this.pinned = new Set(symbols);
    this.sync();
  }

  onTick(hook: TickHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  /** Latest live trade if fresh, otherwise the REST quote. Null for unknown symbols. */
  async getPrice(symbol: string): Promise<number | null> {
    const t = this.last.get(symbol);
    if (t && Date.now() - t.time < FRESH_MS) return t.price;
    const q = await getQuote(symbol);
    if (!q) return t?.price ?? null;
    if (!t || q.time * 1000 > t.time) this.last.set(symbol, { symbol, price: q.price, time: q.time * 1000 });
    return q.price;
  }

  peek(symbol: string): Tick | undefined {
    return this.last.get(symbol);
  }

  private wanted(): Set<string> {
    const all = [...this.pinned, ...this.listeners.keys()];
    return new Set(all.slice(0, MAX_SYMBOLS));
  }

  private sync() {
    const wanted = this.wanted();
    if (wanted.size === 0) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }
    for (const s of wanted) if (!this.subscribed.has(s)) this.send({ type: "subscribe", symbol: toFeed(s) });
    for (const s of this.subscribed) if (!wanted.has(s)) this.send({ type: "unsubscribe", symbol: toFeed(s) });
    this.subscribed = wanted;
  }

  private send(msg: object) {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      // socket closing; resubscribed on reconnect
    }
  }

  private connect() {
    if (this.connecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    this.connecting = true;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey()}`);
    } catch (e) {
      this.connecting = false;
      console.error("[priceHub] cannot open socket:", e);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connecting = false;
      this.retry = 0;
      this.subscribed = new Set();
      this.sync();
    };
    ws.onmessage = (ev) => this.handleMessage(String(ev.data));
    ws.onerror = () => {
      // onclose follows and schedules the reconnect
    };
    ws.onclose = () => {
      this.connecting = false;
      this.ws = null;
      this.subscribed = new Set();
      if (this.wanted().size === 0) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    this.flushTimer ??= setInterval(() => this.flush(), FLUSH_MS);
  }

  private handleMessage(raw: string) {
    let msg: { type?: string; data?: { s: string; p: number; t: number }[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "trade" || !msg.data) return;
    for (const d of msg.data) {
      const symbol = fromFeed.get(d.s) ?? d.s;
      const prev = this.last.get(symbol);
      if (prev && d.t < prev.time) continue;
      const tick = { symbol, price: d.p, time: d.t };
      this.last.set(symbol, tick);
      this.dirty.set(symbol, tick);
    }
  }

  private flush() {
    if (this.dirty.size === 0) return;
    const ticks = [...this.dirty.values()];
    this.dirty.clear();
    const byListener = new Map<Listener, Tick[]>();
    for (const t of ticks) {
      for (const l of this.listeners.get(t.symbol) ?? []) {
        let arr = byListener.get(l);
        if (!arr) byListener.set(l, (arr = []));
        arr.push(t);
      }
      for (const h of this.hooks) {
        try {
          h(t.symbol, t.price);
        } catch (e) {
          console.error("[priceHub] tick hook failed:", e);
        }
      }
    }
    for (const [l, arr] of byListener) {
      try {
        l(arr);
      } catch {
        // listener's stream is gone; it unsubscribes on abort
      }
    }
  }
}

const g = globalThis as unknown as { __priceHub?: PriceHub };
export const priceHub = (g.__priceHub ??= new PriceHub());
