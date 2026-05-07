/**
 * Requires `pnpm dev` running on http://localhost:3000.
 * Run before phase close: `pnpm dev &; sleep 8; pnpm test:integration tests/integration/health.test.ts`
 */
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";

describe("health endpoints (real)", () => {
  it("/api/health/db returns ok with extension and table count", async () => {
    const res = await fetch(`${BASE}/api/health/db`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.vector_extension).toBe(true);
    expect(body.tables_count).toBeGreaterThan(15);
  });

  it("/api/health/voyage returns ok with embedding dim", async () => {
    const res = await fetch(`${BASE}/api/health/voyage`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dim).toBe(1024);
    expect(typeof body.unit_norm).toBe("boolean");
    expect(body.unit_norm).toBe(true);
  });

  it("/api/health/anthropic returns ok with model", async () => {
    const res = await fetch(`${BASE}/api/health/anthropic`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model).toContain("claude-haiku");
    expect(body.input_tokens).toBeGreaterThan(0);
    expect(body.output_tokens).toBeGreaterThan(0);
  });
});
