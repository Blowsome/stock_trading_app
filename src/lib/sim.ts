export const STARTING_CASH = 1_000_000;

// A simulation splits the starting cash into slices: one for the user, the rest for Gemini.
export const SIM_SLICE = 20_000;
export const GEMINI_RUNS = 49;
/** Random portfolios, as a no-skill baseline to compare Gemini against. */
export const RANDOM_RUNS = 49;
export const SIM_MONTHS = 3;
/** How many back-to-back SIM_MONTHS periods the user can pick from. */
export const SIM_WINDOWS = 4;

/**
 * Roughly where Gemini's own knowledge ends (gemini-3.5-flash reports March 2026). Periods that start
 * before this may already be known to the model, so the UI flags them.
 */
export const GEMINI_KNOWLEDGE_CUTOFF = "2026-03-31";

export type SimStatus = "PREPARING" | "RUNNING" | "READY" | "REVEALED" | "FAILED";

/** What the client knows about the simulation this login is in. */
/** `endDate` is null when positions are valued at the latest price on reveal. */
export type SimInfo = { id: string; startDate: string; endDate: string | null; status: SimStatus };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** "Jul 23, 2026" for a YYYY-MM-DD date. */
export const simDate = (ymd: string) => dateFmt.format(new Date(`${ymd}T00:00:00Z`));

/** "Apr 24, 2026 → Jul 24, 2026", or "Jul 24, 2026 → today". */
export const simPeriod = (start: string, end: string | null) => `${simDate(start)} → ${end ? simDate(end) : "today"}`;
