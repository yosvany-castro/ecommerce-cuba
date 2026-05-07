import { describe, test, expect } from "vitest";
import {
  shouldCallMock,
  LOCAL_HITS_THRESHOLD,
  CONFIDENCE_THRESHOLD,
} from "@/sectors/c-search/decide/shouldCallMock";

describe("shouldCallMock", () => {
  test("count 12 with confidence 0.9 → false (threshold is < 12, not <= 12)", () => {
    expect(shouldCallMock(12, 0.9)).toBe(false);
  });

  test("count 5 with confidence 0.4 → false (low confidence)", () => {
    expect(shouldCallMock(5, 0.4)).toBe(false);
  });

  test("count 5 with confidence 0.9 → true", () => {
    expect(shouldCallMock(5, 0.9)).toBe(true);
  });

  test("count 15 with confidence 0.9 → false (enough local hits)", () => {
    expect(shouldCallMock(15, 0.9)).toBe(false);
  });

  test("constants are 12 and 0.5", () => {
    expect(LOCAL_HITS_THRESHOLD).toBe(12);
    expect(CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  test("count 5 with confidence EXACTLY 0.5 → false (boundary; > not >=)", () => {
    expect(shouldCallMock(5, 0.5)).toBe(false);
  });
});
