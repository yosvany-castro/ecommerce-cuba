import { describe, test, expect } from "vitest";
import {
  applySignalToState,
  WARMUP_SIZE,
  WINDOW_SIZE,
  SHIFT_THRESHOLD,
  type SubBucketState,
} from "@/sectors/d-personalization/session/shift-detection";
import type { EventSignal } from "@/sectors/d-personalization/cohorts/infer";

const femAdulta: EventSignal = {
  cohort_id: "femenino_adulta",
  gender: "femenino",
  age_band: "adulto",
};
const mascNino: EventSignal = {
  cohort_id: "masculino_nino",
  gender: "masculino",
  age_band: "nino",
};

function emptyState(): SubBucketState {
  return {
    current_cohort_id: null,
    signal_window: [],
    signal_window_size: 0,
  };
}

describe("constants", () => {
  test("WARMUP=3, WINDOW=5, SHIFT_THRESHOLD=3", () => {
    expect(WARMUP_SIZE).toBe(3);
    expect(WINDOW_SIZE).toBe(5);
    expect(SHIFT_THRESHOLD).toBe(3);
  });
});

describe("applySignalToState — warmup", () => {
  test("first signal stays null cohort, window grows", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdulta);
    expect(s.current_cohort_id).toBeNull();
    expect(s.signal_window_size).toBe(1);
  });

  test("third signal fixes the cohort", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    expect(s.current_cohort_id).toBe("femenino_adulta");
    expect(s.signal_window_size).toBe(3);
  });

  test("warmup with mixed signals picks majority", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, mascNino);
    s = applySignalToState(s, femAdulta);
    expect(s.current_cohort_id).toBe("femenino_adulta");
  });
});

describe("applySignalToState — no shift", () => {
  test("all signals match → cohort stays", () => {
    let s = emptyState();
    for (let i = 0; i < 8; i++) s = applySignalToState(s, femAdulta);
    expect(s.current_cohort_id).toBe("femenino_adulta");
    expect(s.signal_window.length).toBe(WINDOW_SIZE);
  });

  test("2 contradictions in window (below threshold) → no shift", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    // window now = [fA, fA, fA]
    s = applySignalToState(s, mascNino);
    s = applySignalToState(s, mascNino);
    // window = [fA, fA, fA, mN, mN] → 2 contradictions, below threshold
    expect(s.current_cohort_id).toBe("femenino_adulta");
  });
});

describe("applySignalToState — shift", () => {
  test("3 of 5 contradict after warmup → cohort flips, window resets to 1", () => {
    let s = emptyState();
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    s = applySignalToState(s, femAdulta);
    // window = [fA, fA, fA], cohort = femenino_adulta
    s = applySignalToState(s, mascNino);
    s = applySignalToState(s, mascNino);
    s = applySignalToState(s, mascNino);
    // window before the last one was [fA, fA, fA, mN, mN]
    // After adding 3rd mN: window shifts to [fA, fA, mN, mN, mN] → 3 contradict → shift
    expect(s.current_cohort_id).toBe("masculino_nino");
    expect(s.signal_window_size).toBe(1);
    expect(s.signal_window[0].cohort_id).toBe("masculino_nino");
  });
});

describe("applySignalToState — window cap", () => {
  test("window never exceeds WINDOW_SIZE", () => {
    let s = emptyState();
    for (let i = 0; i < 15; i++) s = applySignalToState(s, femAdulta);
    expect(s.signal_window.length).toBe(WINDOW_SIZE);
  });
});
