import { describe, it, expect } from "vitest";
import { stabilizeSlate } from "@/sectors/d-personalization/slate/stabilize";
import type { SlateItem } from "@/sectors/d-personalization/slate/store";

const items = (ids: string[]): SlateItem[] =>
  ids.map((id, i) => ({ product_id: id, position: i + 1, source: "exploit", propensity: 0.9 }));

describe("stabilizeSlate (E5 — churn cap)", () => {
  const headSize = 10;
  const churnCap = 0.3; // budget = 3

  it("rotación dentro del presupuesto: el ranking nuevo pasa intacto", () => {
    const prev = items(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    // 3 entrantes nuevos (= budget): n1..n3
    const next = items(["n1", "a", "n2", "b", "c", "n3", "d", "e", "f", "g", "h"]);
    const out = stabilizeSlate(next, prev, { headSize, churnCap });
    expect(out.map((x) => x.product_id)).toEqual(next.map((x) => x.product_id));
    expect(out.map((x) => x.position)).toEqual(out.map((_, i) => i + 1)); // contiguo
  });

  it("exceso de rotación: conserva los mejores entrantes, rellena con el head anterior, desplaza el resto", () => {
    const prev = items(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    // 6 entrantes (> budget 3); a..d sobreviven en el ranking nuevo, e..j al fondo
    const next = items(["n1", "n2", "n3", "n4", "n5", "n6", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const out = stabilizeSlate(next, prev, { headSize, churnCap });
    const head = out.slice(0, headSize).map((x) => x.product_id);

    // entrantes conservados = los 3 mejor rankeados
    expect(head).toEqual(expect.arrayContaining(["n1", "n2", "n3"]));
    expect(head).not.toContain("n4"); // desplazado
    // el head mantiene ≥70% de caras conocidas (7 de 10 del head anterior)
    const known = head.filter((id) => prev.slice(0, headSize).some((p) => p.product_id === id));
    expect(known.length).toBe(7);
    // los desplazados bajan JUSTO tras el head (siguen alcanzables al scrollear)
    expect(out[headSize].product_id).toBe("n4");
    // permutación completa, sin pérdidas ni duplicados
    expect([...out].map((x) => x.product_id).sort()).toEqual(next.map((x) => x.product_id).sort());
  });

  it("primer slate de la sesión (sin previo) = identidad", () => {
    const next = items(["a", "b", "c"]);
    expect(stabilizeSlate(next, [], { headSize, churnCap })).toEqual(next);
  });

  it("items del head anterior que ya NO son candidatos (dismissed) no se resucitan", () => {
    const prev = items(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    // 'a' y 'b' ya no existen en el slate nuevo (excluidos upstream)
    const next = items(["n1", "n2", "n3", "n4", "n5", "n6", "c", "d", "e", "f", "g", "h"]);
    const out = stabilizeSlate(next, prev, { headSize, churnCap });
    const ids = out.map((x) => x.product_id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
  });
});
