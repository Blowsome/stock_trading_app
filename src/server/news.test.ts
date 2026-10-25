import { describe, expect, it } from "vitest";
import { filterNews, marketCloseUtc, mentionsLaterDate, shortSummary } from "./news";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("marketCloseUtc", () => {
  it("is 4pm New York time in summer and winter", () => {
    expect(new Date(marketCloseUtc("2026-04-24")).toISOString()).toBe("2026-04-24T20:00:00.000Z"); // EDT
    expect(new Date(marketCloseUtc("2026-01-23")).toISOString()).toBe("2026-01-23T21:00:00.000Z"); // EST
  });
});

describe("mentionsLaterDate", () => {
  it("catches dates after the start date in common formats", () => {
    expect(mentionsLaterDate("Apple to report earnings on April 30", "2026-04-24")).toBe(true);
    expect(mentionsLaterDate("Results due 2026-05-01", "2026-04-24")).toBe(true);
    expect(mentionsLaterDate("Outlook for 2027 improves", "2026-04-24")).toBe(true);
    expect(mentionsLaterDate("Sales rose in Jan. 15, 2026 quarter", "2026-04-24")).toBe(false);
    expect(mentionsLaterDate("Stock climbs on April 23", "2026-04-24")).toBe(false);
    expect(mentionsLaterDate("Shares jump after strong iPhone demand", "2026-04-24")).toBe(false);
  });
});

describe("filterNews", () => {
  const article = (iso: string, headline: string) => ({ datetime: at(iso), headline: `Apple: ${headline}`, source: "Test", related: "AAPL" });

  it("never lets an article from after the start date's close through", () => {
    const out = filterNews(
      [
        article("2026-04-24T19:59:00Z", "Before the close"),
        // The real leak Finnhub returned for a to=2026-04-24 query: 7:55 pm New York time.
        article("2026-04-24T23:55:00Z", "After the close"),
        article("2026-04-25T14:00:00Z", "Next day"),
      ],
      "AAPL",
      "2026-04-24",
      ["Apple"],
    );
    expect(out.map((n) => n.headline)).toEqual(["Apple: Before the close"]);
  });

  it("keeps at most four distinct articles, spread over different days, newest first", () => {
    const out = filterNews(
      ["2026-04-18", "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23"].flatMap((d) => [
        article(`${d}T12:00:00Z`, `news on ${d}`),
        article(`${d}T13:00:00Z`, `News on ${d}`),
      ]),
      "AAPL",
      "2026-04-24",
      ["Apple"],
    );
    expect(out).toHaveLength(4);
    expect(new Set(out.map((n) => n.time.slice(0, 10))).size).toBe(4);
    expect(out.map((n) => n.time)).toEqual([...out.map((n) => n.time)].sort().reverse());
  });

  it("drops market stories that don't name the company", () => {
    const story = (headline: string, summary = "") => ({ datetime: at("2026-04-23T12:00:00Z"), headline, summary, source: "Test", related: "AAPL" });
    const out = filterNews(
      [
        story("Kalshi taps Pyth to settle bets on gold"),
        story("Cramer previews big tech earnings", "Apple and Microsoft report next week."),
        story("AAPL options heat up"),
        story("Pineapple prices soar"),
      ],
      "AAPL",
      "2026-04-24",
      ["Apple"],
    );
    expect(out.map((n) => n.headline).sort()).toEqual(["AAPL options heat up", "Cramer previews big tech earnings"]);
  });
});

describe("choosing informative news", () => {
  const item = (iso: string, headline: string, summary = "") => ({ datetime: at(iso), headline, summary, source: "Test", related: "BA" });
  // Modelled on Boeing's real articles before 2026-04-24.
  const boeing = [
    item("2026-04-24T00:07:00Z", "Boeing Q1 Earnings Call Highlights", "Boeing executives said the company began 2026 with improved performance across its three major businesses, with higher revenue."),
    item("2026-04-23T20:25:00Z", "Is The Boeing Company (BA) One of the Best US Stocks to Invest in for Long Term?", "Boeing is included among the 10 Best US Stocks."),
    item("2026-04-23T17:51:00Z", "Is The Boeing Company (BA) A Good Stock To Buy Now?", "We came across a bullish thesis on Boeing on r/stocks."),
    item("2026-04-23T12:21:00Z", "BA Q1 Deep Dive: Production Stabilization", "Boeing announced better-than-expected revenue in Q1, with sales up 14% to $22.22 billion, above consensus estimates."),
    item("2026-04-23T12:58:00Z", "Zacks Earnings Trends Highlights: Boeing, GE Vernova and D.R. Horton", "Boeing was highlighted."),
    item("2026-04-22T09:00:00Z", "Boeing shares edge higher", "Boeing stock moved."),
    item("2026-04-21T09:00:00Z", "Analyst upgrades Boeing, raises price target to $260", "An analyst upgraded Boeing citing production gains."),
    item("2026-04-20T09:00:00Z", "Boeing wins Air Force contract", "Boeing won a $1.2 billion order for tankers."),
  ];

  it("drops clickbait and ranks earnings, ratings and deals first", () => {
    const out = filterNews(boeing, "BA", "2026-04-24", ["Boeing"]).map((n) => n.headline);
    expect(out).not.toContain("Is The Boeing Company (BA) A Good Stock To Buy Now?");
    expect(out).not.toContain("Is The Boeing Company (BA) One of the Best US Stocks to Invest in for Long Term?");
    expect(out).not.toContain("Zacks Earnings Trends Highlights: Boeing, GE Vernova and D.R. Horton");
    expect(out).toContain("BA Q1 Deep Dive: Production Stabilization");
    expect(out).toContain("Analyst upgrades Boeing, raises price target to $260");
    expect(out).toContain("Boeing wins Air Force contract");
    expect(out).not.toContain("Boeing shares edge higher");
  });

  it("includes the summary, and drops an article whose summary mentions a later date", () => {
    const out = filterNews(
      [
        item("2026-04-23T12:00:00Z", "Boeing earnings beat", "Revenue rose 14% to $22.22 billion, above consensus."),
        item("2026-04-23T13:00:00Z", "Boeing guidance", "Boeing will update guidance on May 5."),
      ],
      "BA",
      "2026-04-24",
      ["Boeing"],
    );
    expect(out).toEqual([
      { time: "2026-04-23T12:00:00.000Z", source: "Test", headline: "Boeing earnings beat", summary: "Revenue rose 14% to $22.22 billion, above consensus." },
    ]);
  });

  it("shortens summaries on a word boundary and strips trailing ellipsis markers", () => {
    expect(shortSummary("Workers are being hired to replace retirees […]")).toBe("Workers are being hired to replace retirees");
    const long = shortSummary("word ".repeat(100))!;
    expect(long.length).toBeLessThanOrEqual(251);
    expect(long.endsWith("word…")).toBe(true);
    expect(shortSummary("too short")).toBeUndefined();
  });

  it("drops articles about another company and prefers ones naming this company in the headline", () => {
    const jpm = (iso: string, headline: string, summary: string) => ({ datetime: at(iso), headline, summary, source: "Test", related: "JPM" });
    const out = filterNews(
      [
        jpm("2026-04-22T12:00:00Z", "JPMorgan Cuts PT on Huntington Bancshares (HBAN)", "JPMorgan cut the price target on Huntington to $19."),
        jpm("2026-04-21T12:00:00Z", "JPMorgan Cuts Procter & Gamble (PG) Target", "JPMorgan lowered its price target on P&G."),
        jpm("2026-04-20T12:00:00Z", "Bank stocks rally on rate hopes", "JPMorgan and peers gained 2%."),
        jpm("2026-04-19T12:00:00Z", "JPMorgan Initiates Hims & Hers With Overweight", "JPMorgan started coverage of Hims & Hers."),
        jpm("2026-04-18T12:00:00Z", "Truist Lifts PT on JPMorgan Chase to $332", "Truist raised its JPMorgan target."),
        jpm("2026-04-15T12:00:00Z", "JPMorgan (JPM) profit beats estimates", "JPMorgan earnings rose 10% to $15 billion."),
      ],
      "JPM",
      "2026-04-24",
      ["JPMorgan"],
    );
    expect(out.map((n) => n.headline)).toEqual([
      "Bank stocks rally on rate hopes",
      "Truist Lifts PT on JPMorgan Chase to $332",
      "JPMorgan (JPM) profit beats estimates",
    ]);
  });
});
