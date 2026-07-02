import { describe, test, expect } from "vitest";
import { resolveWindow } from "@/sectors/g-agents/metrics/windows";

const NOW = new Date("2026-06-11T00:00:00.000Z");
const now = () => NOW;

describe("resolveWindow (el off-by-one que duplica/pierde un día de revenue)", () => {
  test("fixed 7d ⇒ [now-7d, now) exactos con reloj inyectado", () => {
    const w = resolveWindow({ kind: "fixed", days: 7 }, now);
    expect(w.from.toISOString()).toBe("2026-06-04T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(w.label).toBe("7d");
  });

  test("fixed 28d ⇒ label correcto", () => {
    const w = resolveWindow({ kind: "fixed", days: 28 }, now);
    expect(w.from.toISOString()).toBe("2026-05-14T00:00:00.000Z");
    expect(w.label).toBe("28d");
  });

  test("since reciente se respeta; since antiguo se clampa a 28d", () => {
    const recent = resolveWindow({ kind: "since", from: new Date("2026-06-09T12:00:00.000Z") }, now);
    expect(recent.from.toISOString()).toBe("2026-06-09T12:00:00.000Z");
    expect(recent.label).toBe("since_change");

    const old = resolveWindow({ kind: "since", from: new Date("2026-01-01T00:00:00.000Z") }, now);
    expect(old.from.toISOString()).toBe("2026-05-14T00:00:00.000Z"); // now - 28d
    expect(old.to.toISOString()).toBe(NOW.toISOString());
  });
});
