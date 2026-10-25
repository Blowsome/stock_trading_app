import { getCompanyNews, type RawArticle } from "./finnhub";
import { NEWS_KEYWORDS } from "./simUniverse";

// News for a simulation, with guards against anything published after the start date's close.

export type NewsItem = { time: string; source: string; headline: string; summary?: string };

const NEWS_DAYS = 14;
const PER_STOCK = 4;
const SUMMARY_CHARS = 250;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** 4:00 pm New York time on `ymd`, as epoch milliseconds (handles daylight saving). */
export function marketCloseUtc(ymd: string): number {
  for (const utcHour of [20, 21]) {
    const t = Date.parse(`${ymd}T${utcHour}:00:00Z`);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(t);
    if (Number(hour) === 16) return t;
  }
  throw new Error(`Could not find the market close for ${ymd}`);
}

/**
 * True if the text names a date after `ymd`: an ISO date, "Month Day[, Year]", or a later year.
 * A crude net for articles that were edited after publication.
 */
export function mentionsLaterDate(text: string, ymd: string): boolean {
  const [year] = ymd.split("-").map(Number);
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) if (m[0] > ymd) return true;
  for (const m of text.matchAll(/\b(20\d\d)\b/g)) if (Number(m[1]) > year) return true;
  const re = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (20\\d\\d))?\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const y = m[3] ? Number(m[3]) : year;
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    if (iso > ymd) return true;
  }
  return false;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text names the company (keywords ignore case; the ticker must match exactly). */
function names(text: string, symbol: string, keywords: string[]) {
  if (new RegExp(`(^|[^A-Za-z])${escape(symbol)}([^A-Za-z]|$)`).test(text)) return true;
  return keywords.some((k) => new RegExp(`(^|[^A-Za-z])${escape(k)}`, "i").test(text));
}

const isAbout = (a: RawArticle, symbol: string, keywords: string[]) => names(`${a.headline} ${a.summary ?? ""}`, symbol, keywords);

/**
 * A headline like "JPMorgan Cuts Procter & Gamble (PG) Target" is about another company: it tags a
 * different ticker in parentheses and not this one.
 */
function aboutAnotherCompany(headline: string, symbol: string, keywords: string[]) {
  const tags = [...headline.matchAll(/\(([A-Z]{1,5}(?:\.[A-Z])?)\)/g)].map((m) => m[1]);
  if (tags.length > 0 && !tags.includes(symbol)) return true;
  // "JPMorgan Initiates Hims & Hers With Overweight": the company is acting as an analyst.
  const analyst = /^\s*(\S+\s){0,2}(initiates?|upgrades?|downgrades?|raises|lifts|boosts|cuts|lowers|trims|reiterates|maintains|starts)\b/i;
  const lead = headline.match(analyst)?.[0] ?? "";
  return !!lead && keywords.some((k) => new RegExp(`^\\s*${escape(k)}`, "i").test(lead));
}

/** Promotional or listicle articles with little real information. */
const CLICKBAIT = [
  /^is .{0,80}\b(a )?(good|great|smart|top|best|buy)\b/i,
  /\bbest\b.{0,40}\bstocks?\b/i,
  /\btop \d+\b/i,
  /\bstocks? to (buy|watch|own|hold)\b/i,
  /\bshould you (buy|sell)\b/i,
  /\b(buy|sell),? or hold\b/i,
  /\bis it time to (buy|sell)\b/i,
  /\b(could|will) .{0,40}\b(soar|double|triple|make you)\b/i,
  /\bmillionaire\b/i,
  /\b\d+ (reasons|things|stocks)\b/i,
  /^zacks\b/i,
];

/** Kinds of news that move stocks; each match adds to an article's score. */
const IMPORTANT = [
  /\b(earnings|revenue|sales|eps|profit|loss|results|quarter|q[1-4])\b/i,
  /\b(beat|beats|miss|misses|missed|tops|topped|falls short|surpass\w*|above|below) (estimates|expectations|consensus|forecasts?)\b|\bconsensus\b/i,
  /\b(guidance|outlook|forecast|raises|cuts|lowers|reaffirms)\b/i,
  /\b(upgrade[sd]?|downgrade[sd]?|price target|rating|initiates? coverage)\b/i,
  /\b(acquir\w*|acquisition|merger|buyout|takeover|deal|stake|spin-?off)\b/i,
  /\b(lawsuit|sues?|sued|settlement|probe|investigation|antitrust|sec|doj|ftc|fine[ds]?|penalty)\b/i,
  /\b(fda|approv\w*|recall|trial|patent)\b/i,
  /\b(layoffs?|job cuts|strike|ceo|cfo|resign\w*|appoint\w*|steps? down)\b/i,
  /\b(dividend|buyback|repurchase|contract|orders?|tariffs?)\b/i,
];

function score(a: RawArticle, symbol: string, keywords: string[]) {
  const text = `${a.headline} ${a.summary ?? ""}`;
  let s = IMPORTANT.filter((re) => re.test(text)).length * 2;
  if (names(a.headline, symbol, keywords)) s += 3; // the company is the subject, not a passing mention
  if (/[$%]|\b\d+(\.\d+)? ?(billion|million)\b/i.test(text)) s += 1; // concrete numbers
  if ((a.summary ?? "").length >= 120) s += 1; // enough substance to be useful
  return s;
}

/** A clean, shortened summary that ends on a word boundary. */
export function shortSummary(text: string | undefined, max = SUMMARY_CHARS): string | undefined {
  const clean = (text ?? "").replace(/\s*\[(…|\.\.\.)\]\s*$/, "").replace(/\s+/g, " ").trim();
  if (clean.length < 20) return undefined;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/**
 * Picks the most informative articles about the company published before the close on `ymd`:
 * no clickbait, nothing mentioning a later date (headline or summary), ranked by how much they
 * say, spread over different days where possible, and returned newest first.
 */
export function filterNews(articles: RawArticle[], symbol: string, ymd: string, keywords: string[] = [], max = PER_STOCK): NewsItem[] {
  const cutoff = marketCloseUtc(ymd);
  const seen = new Set<string>();
  const candidates = articles
    .filter((a) => a.datetime * 1000 < cutoff)
    .filter((a) => a.headline && isAbout(a, symbol, keywords))
    .filter((a) => !aboutAnotherCompany(a.headline, symbol, keywords))
    .filter((a) => !CLICKBAIT.some((re) => re.test(a.headline)))
    .filter((a) => !mentionsLaterDate(`${a.headline} ${a.summary ?? ""}`, ymd))
    .filter((a) => {
      const key = a.headline.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((a) => ({ a, score: score(a, symbol, keywords), day: new Date(a.datetime * 1000).toISOString().slice(0, 10) }))
    .sort((x, y) => y.score - x.score || y.a.datetime - x.a.datetime);

  // First the best article from each day, then fill up with the next best overall.
  const picked: typeof candidates = [];
  const days = new Set<string>();
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!days.has(c.day)) {
      picked.push(c);
      days.add(c.day);
    }
  }
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked
    .sort((x, y) => y.a.datetime - x.a.datetime)
    .map(({ a }) => ({
      time: new Date(a.datetime * 1000).toISOString(),
      source: a.source,
      headline: a.headline.trim(),
      ...(shortSummary(a.summary) && { summary: shortSummary(a.summary) }),
    }));
}

const daysBefore = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

/** Up to four informative articles about `symbol` known before the close on `ymd`. */
export async function newsAsOf(symbol: string, ymd: string): Promise<NewsItem[]> {
  return filterNews(await getCompanyNews(symbol, daysBefore(ymd, NEWS_DAYS), ymd), symbol, ymd, NEWS_KEYWORDS[symbol] ?? []);
}
