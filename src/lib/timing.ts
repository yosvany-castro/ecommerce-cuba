/**
 * Per-request phase timing (PageSlate foundation F5).
 *
 * The latency work of Etapas B-C (slate hit ~50-80ms, página-2 ≤150ms) is
 * only decidable with REAL phase numbers — "the feed takes ~850ms" hides
 * which of its ~15 round-trips pay for what. This accumulator is the single
 * instrument: route handlers emit it as a `Server-Timing` header (visible in
 * DevTools, parseable by RUM later); Server Components (which cannot set
 * headers) persist a sampled structured log line via `after()`.
 *
 * Deliberately boring: explicit object, no async-context magic, ~zero cost
 * when unused (all call sites accept `timing?`).
 */

export interface TimingEntry {
  name: string;
  ms: number;
}

export class RequestTiming {
  private entries_: TimingEntry[] = [];
  private readonly t0 = performance.now();

  /** Time an async phase. Phases with the same name accumulate. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.add(name, performance.now() - start);
    }
  }

  add(name: string, ms: number): void {
    const existing = this.entries_.find((e) => e.name === name);
    if (existing) existing.ms += ms;
    else this.entries_.push({ name, ms });
  }

  entries(): TimingEntry[] {
    return [...this.entries_];
  }

  totalMs(): number {
    return performance.now() - this.t0;
  }

  /** RFC Server-Timing header value: `phase;dur=12.3, other;dur=4.5, total;dur=...` */
  toServerTimingHeader(): string {
    const parts = this.entries_.map((e) => `${e.name.replace(/[^a-zA-Z0-9_-]/g, "_")};dur=${e.ms.toFixed(1)}`);
    parts.push(`total;dur=${this.totalMs().toFixed(1)}`);
    return parts.join(", ");
  }

  /** One-line structured log (sampled persistence path for Server Components). */
  toLogLine(surface: string): string {
    return JSON.stringify({
      t: "server-timing",
      surface,
      total_ms: Math.round(this.totalMs()),
      phases: Object.fromEntries(this.entries_.map((e) => [e.name, Math.round(e.ms)])),
    });
  }
}
