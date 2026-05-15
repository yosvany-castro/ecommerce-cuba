import { describe, it, expect } from "vitest";
import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";

describe("voyage embeddings (real API)", () => {
  it("returns 1024-dim normalized vector for a document", async () => {
    const [vec] = await embed(["camiseta de algodón color rojo talla M"], { inputType: "document" });
    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(1024);

    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
  });

  it("embeds multiple texts in one call", async () => {
    const vecs = await embed(
      ["zapato de cuero", "auriculares bluetooth"],
      { inputType: "document" },
    );
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(1024);
    expect(vecs[1]).toHaveLength(1024);
  });

  it("uses input_type=query when requested", async () => {
    const [vec] = await embed(["regalo niña 8 años"], { inputType: "query" });
    expect(vec).toHaveLength(1024);
  });

  it("returns empty array on empty input", async () => {
    const out = await embed([], { inputType: "document" });
    expect(out).toEqual([]);
  });
});
