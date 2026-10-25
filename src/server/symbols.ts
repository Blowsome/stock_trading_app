const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Normalizes a ticker and returns null if it is not a plausible US symbol. */
export function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}
