import { describe, test, expect } from "vitest";
import { Tracer, NoopTracer } from "@/sectors/c-search/debug/tracer";

describe("Tracer", () => {
  test("collects timings via start/end and total via finish", async () => {
    const t = new Tracer("hola mundo");
    t.start("embed");
    await new Promise((r) => setTimeout(r, 30));
    t.end("embed");
    t.start("bm25");
    await new Promise((r) => setTimeout(r, 20));
    t.end("bm25");
    const trace = t.finish();
    expect(trace.raw_query).toBe("hola mundo");
    expect(trace.timings_ms.embed).toBeGreaterThanOrEqual(25);
    expect(trace.timings_ms.bm25).toBeGreaterThanOrEqual(15);
    expect(trace.timings_ms.total).toBeGreaterThanOrEqual(45);
  });

  test("set() assigns top-level fields and they appear in finish() output", () => {
    const t = new Tracer("test");
    t.set("cache", { exact_hit: true, semantic_hit: false });
    t.set("decision", { should_call_mock: false, reason: "cache_hit" });
    const trace = t.finish();
    expect(trace.cache.exact_hit).toBe(true);
    expect(trace.decision.reason).toBe("cache_hit");
  });

  test("default Tracer state has empty retrieval arrays + initial flags", () => {
    const t = new Tracer("foo");
    const trace = t.finish();
    expect(trace.retrieval.bm25).toEqual([]);
    expect(trace.retrieval.cosine).toEqual([]);
    expect(trace.retrieval.fused).toEqual([]);
    expect(trace.cache.exact_hit).toBe(false);
    expect(trace.cache.semantic_hit).toBe(false);
    expect(trace.mock_fallback.invoked).toBe(false);
    expect(trace.freshness.category_checked).toBeNull();
  });
});

describe("NoopTracer", () => {
  test("start/end/set don't throw (silent no-op contract)", () => {
    const t = new NoopTracer();
    expect(() => {
      t.start("anything");
      t.end("anything");
      t.set("cache", { exact_hit: true, semantic_hit: true });
    }).not.toThrow();
  });

  test("finish() throws (must never be called on NoopTracer)", () => {
    const t = new NoopTracer();
    expect(() => t.finish()).toThrow();
  });
});
