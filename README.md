# Mock Trader

A minimal Robinhood-style paper-trading app for US stocks. Every new account starts with **$1,000,000 of virtual cash** and trades against **real-time market prices**. No real money and no crypto: just stocks.

## Features

- Email/password accounts. Each new user starts with $1,000,000.
- Live prices streamed from Finnhub's trade feed (WebSocket → server → browser over SSE).
- Market orders in dollars (fractional shares) or shares.
- Limit orders that rest until the price crosses, then fill automatically. They can be canceled.
- Portfolio value, today's gain or loss, and total return, updated on every tick.
- Stock pages with a price chart (1D to 5Y), position details, company info and key stats.
- Watchlist, order history, and a button that resets the account back to $1,000,000.
- **Bitcoin** (`BTC-USD`, priced live from Coinbase) trades 24/7, so you can practise when the stock market is closed. Its "Today" figures run from 00:00 UTC, and its 1D chart shows the last 24 hours.

## Setup

1. Get a free API key at <https://finnhub.io/register>.
2. Copy the env file and add your key:
   ```sh
   cp .env.example .env
   # edit .env and set FINNHUB_API_KEY=...
   # for simulation mode, also set GEMINI_API_KEY (https://aistudio.google.com/apikey)
   ```
3. Install and create the database:
   ```sh
   npm install
   npx prisma migrate dev
   ```
4. Start the app at <http://localhost:3000>:
   ```sh
   npm run dev
   ```

Run the tests with `npm test`.

## Simulation mode: you vs Gemini

After logging in you choose **Trade live** (the normal app) or a **Simulation period**. Periods are back-to-back, non-overlapping 3-month windows: the latest runs from 3 months ago until today, and the others end 3, 6 and 9 months ago. A simulation freezes the whole app at its period's start:

- Prices, charts, P/E, 52-week range, beta and market cap show only what was known on the start date. P/E uses the last quarter whose results were out by then (quarter end + 45 days).
- The $1,000,000 is split into 50 slices of $20,000. You trade one slice yourself with market orders that fill at the start date's close.
- Gemini trades the other 49 slices: 49 independent calls (temperature 1) that each see the same as-of data for ~40 large caps and the S&P 500 and Nasdaq-100 ETFs ([src/server/simUniverse.ts](src/server/simUniverse.ts)). Its picks are hidden until the reveal.
- 49 random portfolios (3 to 8 stocks from the same list, equal dollar amounts, each from a fixed seed) give a no-skill baseline.
- Each of the 49 Gemini runs plays an experienced investor with a preferred style ([src/server/personas.ts](src/server/personas.ts)): momentum trader, value investor, defensive investor, technical trader, contrarian, diversifier and all-round investor, 7 runs each. Every persona sees the same data and is told to weigh its style against the news, fundamentals, chart data and its own knowledge. The results page compares each persona with the matching pure rule.
- Six well-known rules are benchmarks too ([src/server/simRules.ts](src/server/simRules.ts)): momentum (12-1 month), value (lowest P/E), low volatility, trend (golden cross), buy the dip (1-month losers) and equal weight (1/N).
- New simulations also give Gemini technical and candlestick data (price vs 50/200-day averages, RSI, volatility, last 5 days, classic candlestick patterns from [src/server/technicals.ts](src/server/technicals.ts)) and up to three headlines per stock ([src/server/news.ts](src/server/news.ts)). Headlines must be published before 4:00 pm New York time on the start date, name the company, and not mention a later date. Finnhub's free plan only has about a year of news, so the oldest period gets none. Older simulations keep the basic data; the comparison page shows which data each one used.
- When Gemini is done, **Lock in & reveal** values every slice at the period's end (today, for the latest period). The results page shows your rank against Gemini and random, both distributions, a permutation test of Gemini against random, each Gemini run's reasoning, the exact prompt Gemini saw, and a CSV download.
- **Simulation results** (Account menu) compares every finished simulation. It includes a pooled test that compares Gemini and random only within the same period, to see whether an edge repeats across periods rather than appearing once by luck.
- Periods that start before Gemini's reported training cutoff (`GEMINI_KNOWLEDGE_CUTOFF` in [src/lib/sim.ts](src/lib/sim.ts)) are flagged, because the model may already know how they turned out.
- Every decision (each Gemini run with its reasoning, each of your trades, the final values) is written to `data/sim-cache/<simulation id>.json`. The as-of stock data is cached in `data/sim-cache/universe-<date>.json`.

Gemini models and limits:

- Runs use free-tier models in order (`DEFAULT_MODELS` in [src/server/gemini.ts](src/server/gemini.ts): 3.5 Flash, then 3.5 Flash-Lite, Flash-Lite latest, 3.1 Flash-Lite, then the newer Flash models). Each model has its own free quota. When one is rate limited (429), overloaded (503) or retired for your key (404), it rests (until midnight Pacific for a daily quota) and the next model takes over. `GEMINI_MODEL` is tried first, and `GEMINI_MODELS` replaces the list. The results page shows which model made each run.
- If every model is out of quota, the simulation pauses and the banner offers **Retry Gemini**. Unfinished runs stay unfinished rather than turning into cash, and Retry continues from there.
- A run whose answer can't be used, even after one retry, keeps its slice in cash. It counts toward the combined $1M total but not toward Gemini's statistics.
- Gemini is told not to use knowledge after the start date, but its training data may include later events. Newer models are more likely to know what happened.

## How it works

| Piece | Where |
| --- | --- |
| Live price feed: one Finnhub WebSocket shared by all users | [src/server/priceHub.ts](src/server/priceHub.ts) |
| Quotes, profiles, stats and search, cached to fit the free tier's 60 calls/min | [src/server/finnhub.ts](src/server/finnhub.ts) |
| Chart history from Yahoo Finance's public chart endpoint | [src/server/yahoo.ts](src/server/yahoo.ts) |
| Order execution, buying power, limit matching and account reset | [src/server/trading.ts](src/server/trading.ts) |
| Portfolio valuation, day change and snapshots for the portfolio chart | [src/server/portfolio.ts](src/server/portfolio.ts) |
| Background limit-order matching and snapshots, started at boot | [src/server/background.ts](src/server/background.ts) |
| Simulation: as-of market data, Gemini runs, reveal and stats | [src/server/asOf.ts](src/server/asOf.ts), [src/server/gemini.ts](src/server/gemini.ts), [src/server/simulation.ts](src/server/simulation.ts) |
| Data model (SQLite through Prisma) | [prisma/schema.prisma](prisma/schema.prisma) |

### Trading rules

- **Market orders** fill right away at the latest trade price (or the latest quote when no trades are streaming).
- **Limit orders** that are already marketable fill at once, at the current (better) price. Otherwise they stay open. A buy limit reserves `shares × limit` of buying power, and a sell limit reserves the shares.
- No margin and no short selling.
- **Today's return** compares shares held overnight with the previous close, and shares bought today with their fill price. Gains from positions sold today are kept.
- **Outside market hours**, market orders still fill at the last traded price. This is a deliberate simplification for practice; a real broker would queue them until the open.

### Limitations

- Finnhub's free plan allows 60 REST calls per minute. The app caps itself at `FINNHUB_MAX_CALLS` calls per `FINNHUB_WINDOW_SECONDS` (default 50 per 60 seconds). Responses are cached and shared across users. When the budget runs out, the app serves the last cached data instead of calling again. The live trade WebSocket doesn't count toward this limit.
- Finnhub's free plan streams up to 50 symbols at once over a single connection.
- Yahoo's chart endpoint is unofficial and can change or rate-limit without warning. If it does, charts show "Chart unavailable" while trading keeps working.
- The portfolio chart is built from snapshots taken after each trade and every 5 minutes while the market is open and the server is running. Gaps appear when the server is off.
