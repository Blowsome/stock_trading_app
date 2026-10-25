import { describe, expect, it } from "vitest";
import { PERSONAS, personaForRun, systemPrompt } from "./personas";
import { RULES } from "./simRules";

describe("personas", () => {
  it("gives each of the 7 styles 7 of the 49 runs, taking turns", () => {
    const runs = Array.from({ length: 49 }, (_, i) => personaForRun(i + 1));
    for (const p of PERSONAS) expect(runs.filter((r) => r === p.key)).toHaveLength(7);
    expect(new Set(runs.slice(0, 7)).size).toBe(7); // the first seven runs already cover every style
  });

  it("mirrors every rule with a persona of the same key, plus an all-round investor", () => {
    expect(PERSONAS.map((p) => p.key)).toEqual([...RULES.map((r) => r.key), "allround"]);
  });

  it("asks for an experienced investor who weighs everything, not a mechanical rule", () => {
    const s = systemPrompt("value");
    expect(s).toContain("Value investor");
    expect(s).toContain("don't follow one signal mechanically");
    expect(s).toContain("news, the fundamentals, the price and chart data");
    expect(systemPrompt(null)).toBe("You are a disciplined equity portfolio manager. Answer only with the requested JSON.");
  });
});
