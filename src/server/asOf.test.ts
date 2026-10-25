import { describe, expect, it } from "vitest";
import { monthsBefore } from "./asOf";

describe("monthsBefore", () => {
  it("steps back whole months", () => {
    expect(monthsBefore(new Date("2026-10-24T12:00:00Z"), 3)).toBe("2026-07-24");
    expect(monthsBefore(new Date("2026-10-24T12:00:00Z"), 12)).toBe("2025-10-24");
  });

  it("clamps to the end of a shorter month instead of spilling over", () => {
    expect(monthsBefore(new Date("2026-05-31T12:00:00Z"), 3)).toBe("2026-02-28");
    expect(monthsBefore(new Date("2026-03-31T12:00:00Z"), 1)).toBe("2026-02-28");
  });
});
