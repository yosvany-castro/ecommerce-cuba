import { describe, it, expect } from "vitest";
import { systemClock, fixedClock, FixedClock } from "@/lib/time/clock";

describe("Clock", () => {
  it("systemClock returns close to Date.now()", () => {
    const before = Date.now();
    const t = systemClock.now();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("fixedClock returns exactly the time it was set to", () => {
    const c: FixedClock = fixedClock(new Date("2026-05-06T12:00:00Z"));
    expect(c.now()).toBe(new Date("2026-05-06T12:00:00Z").getTime());
  });

  it("fixedClock can advance by milliseconds", () => {
    const c = fixedClock(new Date("2026-05-06T12:00:00Z"));
    c.advance(15 * 24 * 3600_000); // +15 days
    expect(c.now()).toBe(new Date("2026-05-21T12:00:00Z").getTime());
  });

  it("fixedClock.set() resets the time to a new value", () => {
    const c = fixedClock(new Date("2026-05-06T12:00:00Z"));
    expect(c.now()).toBe(new Date("2026-05-06T12:00:00Z").getTime());

    c.set(new Date("2030-01-01T00:00:00Z"));
    expect(c.now()).toBe(new Date("2030-01-01T00:00:00Z").getTime());

    // set() with a number works too
    c.set(0);
    expect(c.now()).toBe(0);
  });
});
