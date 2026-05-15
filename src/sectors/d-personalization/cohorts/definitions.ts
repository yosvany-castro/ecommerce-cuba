export const AGE_BANDS = ["bebe", "nino", "joven", "adulto", "mayor"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_BAND_RANGES: Record<AgeBand, { min: number; max: number }> = {
  bebe: { min: 0, max: 3 },
  nino: { min: 4, max: 11 },
  joven: { min: 12, max: 25 },
  adulto: { min: 26, max: 59 },
  mayor: { min: 60, max: 130 },
};

export const COHORT_IDS = [
  "femenino_bebe",
  "femenino_nina",
  "femenino_joven",
  "femenino_adulta",
  "femenino_mayor",
  "masculino_bebe",
  "masculino_nino",
  "masculino_joven",
  "masculino_adulto",
  "masculino_mayor",
  "unisex_indeterminado",
] as const;
export type CohortId = (typeof COHORT_IDS)[number];

export const GENDER_BY_COHORT: Record<CohortId, "femenino" | "masculino" | null> = {
  femenino_bebe: "femenino",
  femenino_nina: "femenino",
  femenino_joven: "femenino",
  femenino_adulta: "femenino",
  femenino_mayor: "femenino",
  masculino_bebe: "masculino",
  masculino_nino: "masculino",
  masculino_joven: "masculino",
  masculino_adulto: "masculino",
  masculino_mayor: "masculino",
  unisex_indeterminado: null,
};

export const AGE_BAND_BY_COHORT: Record<CohortId, AgeBand | null> = {
  femenino_bebe: "bebe",
  femenino_nina: "nino",
  femenino_joven: "joven",
  femenino_adulta: "adulto",
  femenino_mayor: "mayor",
  masculino_bebe: "bebe",
  masculino_nino: "nino",
  masculino_joven: "joven",
  masculino_adulto: "adulto",
  masculino_mayor: "mayor",
  unisex_indeterminado: null,
};

const FEMININE_LABEL: Record<AgeBand, CohortId> = {
  bebe: "femenino_bebe",
  nino: "femenino_nina",
  joven: "femenino_joven",
  adulto: "femenino_adulta",
  mayor: "femenino_mayor",
};

const MASCULINE_LABEL: Record<AgeBand, CohortId> = {
  bebe: "masculino_bebe",
  nino: "masculino_nino",
  joven: "masculino_joven",
  adulto: "masculino_adulto",
  mayor: "masculino_mayor",
};

export function ageToBand(age: number | null | undefined): AgeBand | null {
  if (age === null || age === undefined) return null;
  for (const band of AGE_BANDS) {
    const r = AGE_BAND_RANGES[band];
    if (age >= r.min && age <= r.max) return band;
  }
  return null;
}

export function cohortIdFor(
  gender: "femenino" | "masculino" | "unisex" | null | undefined,
  age: number | null | undefined,
): CohortId {
  if (!gender || gender === "unisex") return "unisex_indeterminado";
  const band = ageToBand(age);
  if (!band) return "unisex_indeterminado";
  return gender === "femenino" ? FEMININE_LABEL[band] : MASCULINE_LABEL[band];
}

export function parseCohort(
  cohort_id: CohortId,
): { gender: "femenino" | "masculino" | null; age_band: AgeBand | null } {
  return {
    gender: GENDER_BY_COHORT[cohort_id],
    age_band: AGE_BAND_BY_COHORT[cohort_id],
  };
}
