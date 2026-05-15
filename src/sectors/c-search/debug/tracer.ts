import type { SearchTrace } from "./trace";

export interface ITracer {
  start(label: string): void;
  end(label: string): void;
  set<K extends keyof SearchTrace>(key: K, value: SearchTrace[K]): void;
  finish(): SearchTrace;
}

export class Tracer implements ITracer {
  private trace: Partial<SearchTrace>;
  private timers = new Map<string, number>();
  private startTime: number;

  constructor(rawQuery: string) {
    this.startTime = performance.now();
    this.trace = {
      raw_query: rawQuery,
      hash: "",
      retrieval: { bm25: [], cosine: [], fused: [] },
      cache: { exact_hit: false, semantic_hit: false },
      filters_applied: {},
      freshness: { category_checked: null, last_refreshed_at: null, hours_old: null },
      decision: { should_call_mock: false, reason: "not evaluated" },
      mock_fallback: { invoked: false },
      embedding: null,
      normalized: null,
      timings_ms: { total: 0 },
    };
  }

  start(label: string) {
    this.timers.set(label, performance.now());
  }

  end(label: string) {
    const s = this.timers.get(label);
    if (s !== undefined && this.trace.timings_ms) {
      (this.trace.timings_ms as Record<string, number>)[label] = performance.now() - s;
    }
  }

  set<K extends keyof SearchTrace>(key: K, value: SearchTrace[K]) {
    (this.trace as Record<string, unknown>)[key] = value;
  }

  finish(): SearchTrace {
    if (this.trace.timings_ms) {
      (this.trace.timings_ms as Record<string, number>).total =
        performance.now() - this.startTime;
    }
    return this.trace as SearchTrace;
  }
}

export class NoopTracer implements ITracer {
  start(): void {}
  end(): void {}
  set(): void {}
  finish(): SearchTrace {
    throw new Error("NoopTracer.finish() should never be called");
  }
}
