import { describe, test, expect } from "vitest";
import { modesForEvents } from "@/sectors/d-personalization/multimode/thresholds";

describe("modesForEvents thresholds", () => {
  test("0-4 events → 0 modes", () => {
    expect(modesForEvents(0)).toBe(0);
    expect(modesForEvents(4)).toBe(0);
  });

  test("5-19 events → 1 mode", () => {
    expect(modesForEvents(5)).toBe(1);
    expect(modesForEvents(19)).toBe(1);
  });

  test("20-99 events → 2 modes", () => {
    expect(modesForEvents(20)).toBe(2);
    expect(modesForEvents(99)).toBe(2);
  });

  test("100+ events → 3 modes (capped)", () => {
    expect(modesForEvents(100)).toBe(3);
    expect(modesForEvents(1000)).toBe(3);
  });

  test("negative input → 0", () => {
    expect(modesForEvents(-1)).toBe(0);
  });
});
