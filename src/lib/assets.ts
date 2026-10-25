/** Non-stock assets. Bitcoin trades 24/7, priced from Coinbase's BTC-USD market. */
export const CRYPTO: Record<string, { name: string; ticker: string; feed: string; yahoo: string }> = {
  "BTC-USD": { name: "Bitcoin", ticker: "BTC", feed: "COINBASE:BTC-USD", yahoo: "BTC-USD" },
};

export const isCrypto = (symbol: string) => symbol in CRYPTO;

/** Short name shown in the UI: "BTC" for Bitcoin, the ticker otherwise. */
export const displaySymbol = (symbol: string) => CRYPTO[symbol]?.ticker ?? symbol;

/** "BTC" for Bitcoin, "share(s)" for stocks. */
export const unitLabel = (symbol: string, quantity = 2) =>
  CRYPTO[symbol]?.ticker ?? (quantity === 1 ? "share" : "shares");
