"use client";

import Link from "next/link";
import { useState } from "react";
import { api, revalidate } from "@/lib/api";
import { displaySymbol } from "@/lib/assets";
import { shares, usd } from "@/lib/format";

export type OrderRow = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  limitPrice: number | null;
  fillPrice: number | null;
  status: "FILLED" | "PENDING" | "CANCELED" | "REJECTED";
  reason: string | null;
  createdAt: string;
  filledAt: string | null;
};

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS: Record<OrderRow["status"], string> = {
  FILLED: "Filled",
  PENDING: "Open",
  CANCELED: "Canceled",
  REJECTED: "Rejected",
};

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/orders/${id}`, { method: "DELETE" });
      revalidate("/api/orders", "/api/portfolio");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (orders.length === 0) return <p className="py-6 text-sm text-muted">No orders yet.</p>;

  return (
    <div className="overflow-x-auto">
      {error && <p className="mb-2 text-sm text-down">{error}</p>}
      <table className="w-full min-w-[600px] text-sm">
        <thead className="text-left text-muted">
          <tr className="border-b border-line">
            <th className="py-3 font-normal">Order</th>
            <th className="py-3 font-normal">Date</th>
            <th className="py-3 text-right font-normal">Quantity</th>
            <th className="py-3 text-right font-normal">Price</th>
            <th className="py-3 text-right font-normal">Total</th>
            <th className="py-3 text-right font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const px = o.fillPrice ?? o.limitPrice;
            return (
              <tr key={o.id} className="border-b border-line">
                <td className="py-3">
                  <Link href={`/stocks/${o.symbol}`} className="font-semibold hover:underline">{displaySymbol(o.symbol)}</Link>{" "}
                  <span className="text-muted">
                    {o.type === "LIMIT" ? "Limit" : "Market"} {o.side === "BUY" ? "buy" : "sell"}
                    {o.type === "LIMIT" && o.limitPrice != null && ` @ ${usd(o.limitPrice)}`}
                  </span>
                </td>
                <td className="py-3 text-muted">{when.format(new Date(o.filledAt ?? o.createdAt))}</td>
                <td className="py-3 text-right">{shares(o.quantity)}</td>
                <td className="py-3 text-right">{px != null ? usd(px) : "—"}</td>
                <td className="py-3 text-right">{px != null ? usd(px * o.quantity) : "—"}</td>
                <td className="py-3 text-right">
                  {o.status === "PENDING" ? (
                    <button disabled={busy === o.id} onClick={() => cancel(o.id)} className="font-semibold text-down hover:underline disabled:opacity-50">
                      {busy === o.id ? "Canceling…" : "Cancel"}
                    </button>
                  ) : (
                    <span className={o.status === "FILLED" ? "" : "text-muted"} title={o.reason ?? undefined}>
                      {STATUS[o.status]}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
