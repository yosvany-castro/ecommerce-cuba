import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { isHoldout } from "@/sectors/d-personalization/holdout";

describe("isHoldout (F2)", () => {
  it("determinista: la misma identidad cae SIEMPRE en el mismo brazo", () => {
    const id = { user_id: null, anonymous_id: randomUUID() };
    const first = isHoldout(id);
    for (let i = 0; i < 5; i++) expect(isHoldout(id)).toBe(first);
  });

  it("la tasa empírica ronda el 10% (±2pp sobre 20k identidades)", () => {
    let hits = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      if (isHoldout({ user_id: null, anonymous_id: randomUUID() })) hits++;
    }
    const rate = hits / N;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.12);
  });

  it("user_id manda sobre anonymous_id (el login no cambia de brazo a la persona)", () => {
    const user_id = randomUUID();
    const a = isHoldout({ user_id, anonymous_id: randomUUID() });
    const b = isHoldout({ user_id, anonymous_id: randomUUID() });
    expect(a).toBe(b);
  });

  it("sin identidad ⇒ jamás holdout", () => {
    expect(isHoldout({ user_id: null, anonymous_id: null })).toBe(false);
  });
});
