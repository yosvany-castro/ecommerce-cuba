import { describe, test, expect, vi, afterEach } from "vitest";
import {
  shouldCallMock,
  countStrongHits,
  currentStrongHitMinScore,
  DEFAULT_STRONG_HIT_MIN_SCORE,
  LOCAL_HITS_THRESHOLD,
  CONFIDENCE_THRESHOLD,
  FRESHNESS_THRESHOLD_HOURS,
} from "@/sectors/c-search/decide/shouldCallMock";

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SEARCH_STRONG_HIT_MIN_SCORE;
});

describe("shouldCallMock — base criteria (count + confidence)", () => {
  test("count 12 with confidence 0.9 → false (threshold is < 12, not <= 12)", () => {
    expect(shouldCallMock(12, 0.9, null)).toBe(false);
  });

  test("count 5 with confidence 0.4 → false (low confidence)", () => {
    expect(shouldCallMock(5, 0.4, null)).toBe(false);
  });

  test("count 5 with confidence 0.9, no freshness → true", () => {
    expect(shouldCallMock(5, 0.9, null)).toBe(true);
  });

  test("count 15 with confidence 0.9 → false (enough local hits)", () => {
    expect(shouldCallMock(15, 0.9, null)).toBe(false);
  });

  test("constants are 12 / 0.5 / 24", () => {
    expect(LOCAL_HITS_THRESHOLD).toBe(12);
    expect(CONFIDENCE_THRESHOLD).toBe(0.5);
    expect(FRESHNESS_THRESHOLD_HOURS).toBe(24);
  });

  test("count 5 with confidence EXACTLY 0.5 → false (boundary; > not >=)", () => {
    expect(shouldCallMock(5, 0.5, null)).toBe(false);
  });
});

describe("shouldCallMock — freshness criterion", () => {
  test("returns false when category was refreshed < 24h ago even with low count + high confidence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00Z"));
    const fiveHoursAgo = new Date("2026-05-07T07:00:00Z");
    expect(shouldCallMock(2, 0.9, fiveHoursAgo)).toBe(false);
  });

  test("returns true when last refresh > 24h ago and other criteria met", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00Z"));
    const twoDaysAgo = new Date("2026-05-05T12:00:00Z");
    expect(shouldCallMock(2, 0.9, twoDaysAgo)).toBe(true);
  });

  test("returns true when lastRefreshedAt is null (no products in category yet)", () => {
    expect(shouldCallMock(2, 0.9, null)).toBe(true);
  });

  test("freshness exactly 24h ago → true (boundary; < not <=)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00Z"));
    const exactly24hAgo = new Date("2026-05-06T12:00:00Z");
    expect(shouldCallMock(2, 0.9, exactly24hAgo)).toBe(true);
  });
});

describe("countStrongHits (F4 T7) — piso de similitud para hits fuertes", () => {
  const cos = (n: number, score: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, score }));

  test("40 cosine flojos (score .3) + 0 bm25 + minScore .55 → 0", () => {
    expect(countStrongHits([], cos(40, 0.3), 0.55)).toBe(0);
  });

  test("15 cosine ≥ .55 → 15", () => {
    expect(countStrongHits([], cos(15, 0.55), 0.55)).toBe(15);
  });

  test("5 bm25 + 3 cosine fuertes con 2 solapados → 6 (union de ids únicos)", () => {
    const bm25 = ["a", "b", "c", "d", "e"];
    const cosine = [
      { id: "a", score: 0.9 }, // solapado con bm25
      { id: "b", score: 0.9 }, // solapado con bm25
      { id: "x", score: 0.9 }, // nuevo fuerte por coseno
    ];
    expect(countStrongHits(bm25, cosine, 0.55)).toBe(6);
  });

  test("minScore 0 → cuenta todos los cosine (comportamiento viejo)", () => {
    expect(countStrongHits([], cos(40, 0.3), 0)).toBe(40);
  });

  test("minScore 0 con scores negativos → cuenta todos ([-0.2, 0.3] = 2)", () => {
    const cosine = [
      { id: "a", score: -0.2 },
      { id: "b", score: 0.3 },
    ];
    expect(countStrongHits([], cosine, 0)).toBe(2);
  });

  test("bm25 cuenta aunque su score coseno sea flojo (match léxico = fuerte)", () => {
    expect(countStrongHits(["a"], [{ id: "a", score: 0.1 }], 0.55)).toBe(1);
  });
});

describe("currentStrongHitMinScore (F4 T7) — env override", () => {
  test("default is 0.55", () => {
    expect(DEFAULT_STRONG_HIT_MIN_SCORE).toBe(0.55);
    expect(currentStrongHitMinScore()).toBe(0.55);
  });

  test("env override is parsed", () => {
    process.env.SEARCH_STRONG_HIT_MIN_SCORE = "0";
    expect(currentStrongHitMinScore()).toBe(0);
    process.env.SEARCH_STRONG_HIT_MIN_SCORE = "0.7";
    expect(currentStrongHitMinScore()).toBe(0.7);
  });

  test("garbage env falls back to default", () => {
    process.env.SEARCH_STRONG_HIT_MIN_SCORE = "not-a-number";
    expect(currentStrongHitMinScore()).toBe(0.55);
  });
});
