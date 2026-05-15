import {
  cohortIdFor,
  ageToBand,
  type CohortId,
  type AgeBand,
} from "./definitions";

export interface EventSignal {
  cohort_id: CohortId;
  gender: "femenino" | "masculino" | null;
  age_band: AgeBand | null;
}

interface ProductMetadataLike {
  gender_target?: string | null;
  age_target?: { min?: number; max?: number } | null;
}

export function inferSignalFromProductMetadata(
  meta: ProductMetadataLike | null | undefined,
): EventSignal {
  if (!meta) {
    return { cohort_id: "unisex_indeterminado", gender: null, age_band: null };
  }
  const rawGender = meta.gender_target;
  const gender =
    rawGender === "femenino" || rawGender === "masculino" ? rawGender : null;
  const at = meta.age_target;
  const repAge =
    at && typeof at.min === "number" && typeof at.max === "number"
      ? Math.round((at.min + at.max) / 2)
      : null;
  const cohort_id = cohortIdFor(
    gender ?? (rawGender === "unisex" ? "unisex" : null),
    repAge,
  );
  return {
    cohort_id,
    gender,
    age_band: ageToBand(repAge),
  };
}

export function inferSignalFromNormalizedQuery(n: {
  recipient_gender?: string | null;
  recipient_age_min?: number | null;
  recipient_age_max?: number | null;
}): EventSignal {
  return inferSignalFromProductMetadata({
    gender_target: n.recipient_gender ?? null,
    age_target:
      n.recipient_age_min !== null &&
      n.recipient_age_min !== undefined &&
      n.recipient_age_max !== null &&
      n.recipient_age_max !== undefined
        ? { min: n.recipient_age_min, max: n.recipient_age_max }
        : null,
  });
}

export function majorityCohort(signals: EventSignal[]): CohortId {
  const counts = new Map<CohortId, number>();
  for (const s of signals) {
    if (s.cohort_id === "unisex_indeterminado") continue;
    counts.set(s.cohort_id, (counts.get(s.cohort_id) ?? 0) + 1);
  }
  if (counts.size === 0) return "unisex_indeterminado";
  let best: CohortId = "unisex_indeterminado";
  let bestN = -1;
  for (const [c, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

export function countSignalsNotMatchingCohort(
  signals: EventSignal[],
  cohort: CohortId,
): number {
  return signals.filter((s) => s.cohort_id !== cohort).length;
}
