import { describe, it, expect } from "vitest";
import { RequestTiming } from "@/lib/timing";

describe("RequestTiming (F5)", () => {
  it("accumulates repeated phase names (per-mode retrieval sums into one entry)", async () => {
    const t = new RequestTiming();
    await t.time("retrieve_modes", () => new Promise((r) => setTimeout(r, 5)));
    await t.time("retrieve_modes", () => new Promise((r) => setTimeout(r, 5)));
    const entries = t.entries();
    expect(entries.filter((e) => e.name === "retrieve_modes")).toHaveLength(1);
    expect(entries[0].ms).toBeGreaterThanOrEqual(8);
  });

  it("records the phase even when fn throws (the failure IS the latency)", async () => {
    const t = new RequestTiming();
    await expect(t.time("boom", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(t.entries().map((e) => e.name)).toContain("boom");
  });

  it("emits an RFC-shaped Server-Timing header with sanitized names + total", async () => {
    const t = new RequestTiming();
    await t.time("fase rara!", () => Promise.resolve());
    const header = t.toServerTimingHeader();
    expect(header).toMatch(/fase_rara_;dur=\d+(\.\d+)?/);
    expect(header).toMatch(/total;dur=\d+(\.\d+)?$/);
  });

  it("log line is valid JSON with surface and integer phases", async () => {
    const t = new RequestTiming();
    await t.time("profile", () => Promise.resolve());
    const parsed = JSON.parse(t.toLogLine("home"));
    expect(parsed.t).toBe("server-timing");
    expect(parsed.surface).toBe("home");
    expect(typeof parsed.total_ms).toBe("number");
    expect(typeof parsed.phases.profile).toBe("number");
  });
});
