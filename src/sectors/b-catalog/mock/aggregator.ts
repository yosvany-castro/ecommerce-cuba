import { loadFixture } from "./fixture";
import type { MockProduct, MockCategory } from "./types";

export interface FetchOptions {
  category?: MockCategory;
  query?: string;
  limit?: number;
}

export interface FetchResult {
  products: MockProduct[];
  cost_cents: number;
  latency_ms: number;
}

const PRODUCTS_PER_CALL = 25;
const COST_PER_CALL_CENTS = 4;
const ERROR_RATE = 0.02;
const LATENCY_MIN_MS = 2000;
const LATENCY_MAX_MS = 4000;

let callCount = 0;
let errorCount = 0;

export function getCallCount() { return callCount; }
export function getErrorCount() { return errorCount; }
export function resetCallCount() { callCount = 0; errorCount = 0; }

function jitterMs(): number {
  return LATENCY_MIN_MS + Math.random() * (LATENCY_MAX_MS - LATENCY_MIN_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchFromAggregator(opts: FetchOptions = {}): Promise<FetchResult> {
  callCount++;
  const t0 = performance.now();
  const wait = jitterMs();
  await delay(wait);

  if (Math.random() < ERROR_RATE) {
    errorCount++;
    throw new Error("MOCK_AGGREGATOR_TIMEOUT");
  }

  const all = await loadFixture();
  let pool = all;
  if (opts.category) pool = pool.filter((p) => p.raw_category === opts.category);
  if (opts.query) {
    const q = opts.query.toLowerCase();
    pool = pool.filter((p) =>
      p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }

  // Random sample of size PRODUCTS_PER_CALL with replacement-from-pool
  const out: MockProduct[] = [];
  for (let i = 0; i < PRODUCTS_PER_CALL; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return {
    products: out,
    cost_cents: COST_PER_CALL_CENTS,
    latency_ms: performance.now() - t0,
  };
}
