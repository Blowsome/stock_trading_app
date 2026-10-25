"use client";

import { useState } from "react";
import { api, revalidate } from "@/lib/api";
import { displaySymbol, isCrypto, unitLabel } from "@/lib/assets";
import { shares, usd } from "@/lib/format";
import { simDate } from "@/lib/sim";
import { useSim } from "@/lib/simContext";
import { useMarketStatus } from "./MarketBadge";

type Side = "BUY" | "SELL";
type Kind = "MARKET" | "LIMIT";
type Unit = "DOLLARS" | "SHARES";

type Props = {
  symbol: string;
  price: number | undefined;
  buyingPower: number;
  owned: number;
  /** Shares already committed to open sell orders. */
  reservedShares: number;
};

export function OrderPanel({ symbol, price, buyingPower, owned, reservedShares }: Props) {
  const market = useMarketStatus();
  const sim = useSim();
  const [side, setSide] = useState<Side>("BUY");
  const [kind, setKind] = useState<Kind>("MARKET");
  const [unit, setUnit] = useState<Unit>("DOLLARS");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sellable = Math.max(0, owned - reservedShares);
  const name = displaySymbol(symbol);
  const unitName = unitLabel(symbol);
  const unitTitle = isCrypto(symbol) ? unitName : "Shares";
  const effectiveUnit: Unit = kind === "LIMIT" ? "SHARES" : unit;
  const value = Number(amount) || 0;
  const limitPrice = Number(limit) || 0;
  const refPrice = kind === "LIMIT" ? limitPrice : (price ?? 0);
  const qty = effectiveUnit === "SHARES" ? value : refPrice ? value / refPrice : 0;
  const total = effectiveUnit === "DOLLARS" ? value : qty * refPrice;

  let problem: string | null = null;
  if (!value) problem = "Enter an amount";
  else if (kind === "LIMIT" && !limitPrice) problem = "Enter a limit price";
  else if (effectiveUnit === "DOLLARS" && value < 1) problem = "Minimum order is $1.00";
  else if (side === "BUY" && total > buyingPower + 0.005) problem = `Not enough buying power (${usd(buyingPower)})`;
  else if (side === "SELL" && qty > sellable + 1e-6) problem = `You have ${shares(sellable)} ${unitName} available`;

  function reset() {
    setAmount("");
    setLimit("");
    setReview(false);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { symbol, side, type: kind };
      if (effectiveUnit === "DOLLARS") body.notional = value;
      else body.quantity = value;
      if (kind === "LIMIT") body.limitPrice = limitPrice;
      const { order } = await api<{ order: { status: string; quantity: number; fillPrice: number | null } }>("/api/orders", { body });
      setDone(
        order.status === "FILLED"
          ? `${side === "BUY" ? "Bought" : "Sold"} ${shares(order.quantity)} ${name} at ${usd(order.fillPrice!)}`
          : `Limit order placed: ${side === "BUY" ? "buy" : "sell"} ${shares(order.quantity)} ${name} at ${usd(limitPrice)}`,
      );
      reset();
      revalidate("/api/portfolio", "/api/orders", "/api/sim");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const select = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-muted";
  const input = "w-36 rounded-md border border-line bg-surface px-3 py-1.5 text-right outline-none focus:accent-border";

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex border-b border-line px-5">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setReview(false);
              setDone(null);
            }}
            className={`-mb-px mr-6 border-b-2 py-4 text-sm font-semibold ${side === s ? "accent-text accent-border" : "border-transparent hover:accent-text"}`}
          >
            {s === "BUY" ? "Buy" : "Sell"} {name}
          </button>
        ))}
      </div>

      <div className="space-y-4 px-5 py-5 text-sm">
        {/* Simulations freeze time at one close, so only market orders make sense. */}
        {!sim && <div className="flex items-center justify-between">
          <label htmlFor="order-type">Order type</label>
          <select id="order-type" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setReview(false); }} className={select}>
            <option value="MARKET">Market order</option>
            <option value="LIMIT">Limit order</option>
          </select>
        </div>}

        {kind === "MARKET" && (
          <div className="flex items-center justify-between">
            <label htmlFor="order-unit">{side === "BUY" ? "Buy in" : "Sell in"}</label>
            <select id="order-unit" value={unit} onChange={(e) => { setUnit(e.target.value as Unit); setAmount(""); setReview(false); }} className={select}>
              <option value="DOLLARS">Dollars</option>
              <option value="SHARES">{unitTitle}</option>
            </select>
          </div>
        )}

        {kind === "LIMIT" && (
          <div className="flex items-center justify-between">
            <label htmlFor="limit-price">Limit price</label>
            <input id="limit-price" type="number" inputMode="decimal" min="0" step="0.01" placeholder="$0.00" value={limit}
              onChange={(e) => { setLimit(e.target.value); setReview(false); }} className={input} />
          </div>
        )}

        <div className="flex items-center justify-between">
          <label htmlFor="amount">{effectiveUnit === "DOLLARS" ? "Amount" : unitTitle}</label>
          <div className="flex items-center gap-2">
            {side === "SELL" && sellable > 0 && (
              <button
                type="button"
                onClick={() => { setUnit("SHARES"); setAmount(String(sellable)); setReview(false); }}
                className="accent-text text-xs font-semibold"
              >
                Sell all
              </button>
            )}
            <input id="amount" type="number" inputMode="decimal" min="0" step="any" placeholder={effectiveUnit === "DOLLARS" ? "$0.00" : "0"}
              value={amount} onChange={(e) => { setAmount(e.target.value); setReview(false); }} className={input} />
          </div>
        </div>

        <div className="flex justify-between text-muted">
          <span>{sim ? `Close on ${simDate(sim.startDate)}` : "Market price"}</span>
          <span className="text-fg">{price ? usd(price) : "—"}</span>
        </div>

        <div className="flex justify-between border-t border-line pt-4 font-semibold">
          <span>{effectiveUnit === "DOLLARS" ? "Est. quantity" : side === "BUY" ? "Est. cost" : "Est. credit"}</span>
          <span>{effectiveUnit === "DOLLARS" ? shares(Number(qty.toFixed(6))) : usd(total)}</span>
        </div>

        {review && !problem && (
          <p className="rounded-md bg-elevated p-3 text-muted">
            {kind === "MARKET"
              ? `You are placing a market order to ${side === "BUY" ? "buy" : "sell"} ${effectiveUnit === "DOLLARS" ? usd(value) + " of" : `${shares(value)} ${unitName} of`} ${name}. ${sim ? `It fills at the ${simDate(sim.startDate)} close.` : "It fills at the latest price."}`
              : `You are placing a limit order to ${side === "BUY" ? "buy" : "sell"} ${shares(value)} ${unitName} of ${name} at ${usd(limitPrice)} or better. It stays open until it fills or you cancel it.`}
          </p>
        )}
        {!sim && market && !market.isOpen && !isCrypto(symbol) && kind === "MARKET" && (
          <p className="text-xs text-muted">The market is closed. Practice orders fill at the last traded price.</p>
        )}
        {error && <p className="text-down" role="alert">{error}</p>}
        {done && <p className="text-up" role="status">✓ {done}</p>}

        {review ? (
          <div className="flex gap-3">
            <button onClick={() => setReview(false)} className="flex-1 rounded-full border border-line py-3 font-semibold">
              Edit
            </button>
            <button disabled={busy} onClick={submit} className="accent-bg flex-1 rounded-full py-3 font-semibold text-black disabled:opacity-60">
              {busy ? "Submitting…" : side === "BUY" ? "Buy" : "Sell"}
            </button>
          </div>
        ) : (
          <button
            disabled={!!problem || !price}
            onClick={() => { setReview(true); setDone(null); setError(null); }}
            className="accent-bg w-full rounded-full py-3 font-semibold text-black transition disabled:opacity-40"
          >
            {problem && value ? problem : "Review order"}
          </button>
        )}
      </div>

      <div className="border-t border-line px-5 py-4 text-center text-xs text-muted">
        {side === "BUY" ? `${usd(buyingPower)} buying power available` : `${shares(sellable)} ${unitName} available`}
      </div>
    </div>
  );
}
