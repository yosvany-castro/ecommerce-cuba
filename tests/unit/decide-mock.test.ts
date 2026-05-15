import { describe, test, expect, vi, afterEach } from "vitest";
import {
  shouldCallMock,
  LOCAL_HITS_THRESHOLD,
  CONFIDENCE_THRESHOLD,
  FRESHNESS_THRESHOLD_HOURS,
} from "@/sectors/c-search/decide/shouldCallMock";

afterEach(() => {
  vi.useRealTimers();
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
