import { describe, it, expect } from "vitest";
import { injectPins, PIN_CAP } from "@/sectors/d-personalization/slate/pins";
import type { SlateItem } from "@/sectors/d-personalization/slate/store";

const item = (id: string, position: number): SlateItem => ({
  product_id: id,
  position,
  source: "exploit",
  propensity: 0.9,
});

describe("injectPins (C5)", () => {
  const slate = [item("a", 1), item("b", 2), item("c", 3), item("d", 4)];

  it("mueve los pineados al frente preservando sus metadatos y renumera contiguo", () => {
    const out = injectPins(slate, ["c"]);
    expect(out.map((x) => x.product_id)).toEqual(["c", "a", "b", "d"]);
    expect(out.map((x) => x.position)).toEqual([1, 2, 3, 4]);
    expect(out[0].propensity).toBe(0.9); // metadatos del item original conservados
  });

  it("respeta el orden de pineado, dedupea y aplica el cap", () => {
    const pins = ["d", "b", "d", "a", "c", "x"]; // 5 únicos > PIN_CAP=4
    const out = injectPins(slate, pins);
    expect(out.slice(0, PIN_CAP).map((x) => x.product_id)).toEqual(["d", "b", "a", "c"]);
    expect(out.map((x) => x.product_id)).not.toContain("x"); // el 5º cayó por cap
  });

  it("un pin que ya no está en los candidatos entra igual (el resolver lo filtrará si murió)", () => {
    const out = injectPins(slate, ["zz"]);
    expect(out[0].product_id).toBe("zz");
    expect(out[0].source).toBe("exploit");
    expect(out).toHaveLength(5);
  });

  it("sin pins = identidad (misma lista, posiciones intactas)", () => {
    expect(injectPins(slate, [])).toEqual(slate);
  });
});
