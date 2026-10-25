import { priceHub } from "./priceHub";
import { snapshotAll, recordSnapshot } from "./portfolio";
import { resumeSimulations } from "./simulation";
import { pendingSymbols, processLimitOrders, refreshPendingSymbols } from "./trading";

const SWEEP_MS = 20_000;
const SNAPSHOT_MS = 5 * 60_000;
const TICK_THROTTLE_MS = 2_000;

async function fill(symbol: string, price: number) {
  const users = await processLimitOrders(symbol, price);
  await Promise.all([...new Set(users)].map((u) => recordSnapshot(u).catch(() => {})));
}

/** Starts limit-order matching, portfolio snapshots and unfinished simulations. Safe to call more than once. */
export function startBackground() {
  const g = globalThis as unknown as { __bgStarted?: boolean };
  if (g.__bgStarted) return;
  g.__bgStarted = true;

  refreshPendingSymbols().catch((e) => console.error("[background] pending symbols:", e));
  resumeSimulations().catch((e) => console.error("[background] simulations:", e));

  // Match on live trades, at most once per symbol every couple of seconds.
  const lastRun = new Map<string, number>();
  priceHub.onTick((symbol, price) => {
    if (!pendingSymbols().has(symbol)) return;
    const now = Date.now();
    if (now - (lastRun.get(symbol) ?? 0) < TICK_THROTTLE_MS) return;
    lastRun.set(symbol, now);
    fill(symbol, price).catch((e) => console.error("[limit]", e));
  });

  // Fallback sweep using quotes, for when the socket is quiet or down.
  setInterval(async () => {
    for (const symbol of pendingSymbols()) {
      const price = await priceHub.getPrice(symbol).catch(() => null);
      if (price) await fill(symbol, price).catch((e) => console.error("[limit]", e));
    }
  }, SWEEP_MS);

  setInterval(() => snapshotAll().catch((e) => console.error("[snapshot]", e)), SNAPSHOT_MS);
}
