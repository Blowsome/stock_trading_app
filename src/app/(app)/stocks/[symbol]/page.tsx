import { notFound } from "next/navigation";
import { StockView } from "@/components/StockView";
import { normalizeSymbol } from "@/server/symbols";

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol(decodeURIComponent((await params).symbol));
  if (!symbol) notFound();
  return <StockView key={symbol} symbol={symbol} />;
}
