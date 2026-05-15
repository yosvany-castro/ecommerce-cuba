import { loadFixture } from "./fixture";
import type { MockProduct, MockCategory } from "./types";
import { generateProductsWithLLM } from "./llm-generator";

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

export type AggregatorMode = "auto" | "fixture" | "llm" | "fixture-only";

const DEFAULT_PRODUCTS_PER_CALL = 25;
const COST_PER_CALL_CENTS = 4;
const DEFAULT_ERROR_RATE = 0.02;
const LATENCY_MIN_MS = 2000;
const LATENCY_MAX_MS = 4000;

function currentErrorRate(): number {
  const v = process.env.MOCK_AGGREGATOR_ERROR_RATE;
  if (v === undefined) return DEFAULT_ERROR_RATE;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : DEFAULT_ERROR_RATE;
}

function currentMode(): AggregatorMode {
  return (process.env.MOCK_AGGREGATOR_MODE as AggregatorMode) ?? "auto";
}

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

async function fixturePath(opts: FetchOptions, N: number): Promise<MockProduct[]> {
  const all = await loadFixture();
  let pool = all;
  if (opts.category) pool = pool.filter((p) => p.raw_category === opts.category);
  if (opts.query) {
    const q = opts.query.toLowerCase();
    pool = pool.filter(
      (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }
  if (pool.length === 0) return [];
  const out: MockProduct[] = [];
  for (let i = 0; i < N; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

export async function fetchFromAggregator(opts: FetchOptions = {}): Promise<FetchResult> {
  const N = opts.limit ?? DEFAULT_PRODUCTS_PER_CALL;
  callCount++;
  const t0 = performance.now();
  const wait = jitterMs();
  await delay(wait);

  if (Math.random() < currentErrorRate()) {
    errorCount++;
    throw new Error("MOCK_AGGREGATOR_TIMEOUT");
  }

  const mode = currentMode();
  const useLLM =
    mode === "llm" ||
    (mode === "auto" && !!opts.query && opts.query.trim().length > 0);

  let products: MockProduct[];
  if (useLLM && opts.query) {
    try {
      products = await generateProductsWithLLM({
        query: opts.query,
        category: opts.category,
        limit: N,
      });
    } catch (e) {
      console.warn("[mock-aggregator] LLM generator failed, falling back to fixture:", e);
      products = await fixturePath(opts, N);
    }
  } else {
    products = await fixturePath(opts, N);
  }

  return {
    products,
    cost_cents: COST_PER_CALL_CENTS,
    latency_ms: performance.now() - t0,
  };
}
