import {
  majorityCohort,
  countSignalsNotMatchingCohort,
  type EventSignal,
} from "../cohorts/infer";
import type { CohortId } from "../cohorts/definitions";

export const WARMUP_SIZE = 3;
export const WINDOW_SIZE = 5;
export const SHIFT_THRESHOLD = 3;

export interface SubBucketState {
  current_cohort_id: CohortId | null;
  signal_window: EventSignal[];
  signal_window_size: number;
}

export function applySignalToState(
  state: SubBucketState,
  signal: EventSignal,
): SubBucketState {
  const window = [...state.signal_window, signal];
  if (window.length > WINDOW_SIZE) window.shift();

  // Warmup phase: cohort not yet fixed
  if (state.current_cohort_id === null) {
    if (window.length >= WARMUP_SIZE) {
      const cohort = majorityCohort(window);
      return {
        current_cohort_id: cohort,
        signal_window: window,
        signal_window_size: window.length,
      };
    }
    return {
      current_cohort_id: null,
      signal_window: window,
      signal_window_size: window.length,
    };
  }

  // Active phase: check for shift
  const contradicting = countSignalsNotMatchingCohort(
    window,
    state.current_cohort_id,
  );
  if (contradicting >= SHIFT_THRESHOLD) {
    const newCohort = majorityCohort(window);
    if (newCohort !== state.current_cohort_id) {
      return {
        current_cohort_id: newCohort,
        signal_window: [signal],
        signal_window_size: 1,
      };
    }
  }
  return {
    current_cohort_id: state.current_cohort_id,
    signal_window: window,
    signal_window_size: window.length,
  };
}
