import { describe, test, expect } from "vitest";
import {
  COHORT_IDS,
  AGE_BAND_RANGES,
  cohortIdFor,
  parseCohort,
  ageToBand,
  type CohortId,
} from "@/sectors/d-personalization/cohorts/definitions";

describe("Cohort definitions", () => {
  test("has exactly 11 cohorts", () => {
    expect(COHORT_IDS.length).toBe(11);
  });

  test("includes all documented cohort IDs", () => {
    const expected: CohortId[] = [
      "femenino_bebe", "femenino_nina", "femenino_joven",
      "femenino_adulta", "femenino_mayor",
      "masculino_bebe", "masculino_nino", "masculino_joven",
      "masculino_adulto", "masculino_mayor",
      "unisex_indeterminado",
    ];
    for (const id of expected) expect(COHORT_IDS).toContain(id);
  });

  test("AGE_BAND_RANGES covers the 5 bands", () => {
    expect(AGE_BAND_RANGES.bebe).toEqual({ min: 0, max: 3 });
    expect(AGE_BAND_RANGES.nino).toEqual({ min: 4, max: 11 });
    expect(AGE_BAND_RANGES.joven).toEqual({ min: 12, max: 25 });
    expect(AGE_BAND_RANGES.adulto).toEqual({ min: 26, max: 59 });
    expect(AGE_BAND_RANGES.mayor).toEqual({ min: 60, max: 130 });
  });

  test("ageToBand maps correctly across boundaries", () => {
    expect(ageToBand(0)).toBe("bebe");
    expect(ageToBand(3)).toBe("bebe");
    expect(ageToBand(4)).toBe("nino");
    expect(ageToBand(11)).toBe("nino");
    expect(ageToBand(12)).toBe("joven");
    expect(ageToBand(25)).toBe("joven");
    expect(ageToBand(26)).toBe("adulto");
    expect(ageToBand(59)).toBe("adulto");
    expect(ageToBand(60)).toBe("mayor");
    expect(ageToBand(130)).toBe("mayor");
    expect(ageToBand(null)).toBeNull();
    expect(ageToBand(undefined)).toBeNull();
    expect(ageToBand(200)).toBeNull();
  });

  test("cohortIdFor concrete mappings", () => {
    expect(cohortIdFor("femenino", 35)).toBe("femenino_adulta");
    expect(cohortIdFor("masculino", 70)).toBe("masculino_mayor");
    expect(cohortIdFor("masculino", 8)).toBe("masculino_nino");
    expect(cohortIdFor("femenino", 2)).toBe("femenino_bebe");
    expect(cohortIdFor("femenino", 20)).toBe("femenino_joven");
  });

  test("cohortIdFor falls back to unisex_indeterminado", () => {
    expect(cohortIdFor(null, 35)).toBe("unisex_indeterminado");
    expect(cohortIdFor("femenino", null)).toBe("unisex_indeterminado");
    expect(cohortIdFor("unisex", 35)).toBe("unisex_indeterminado");
    expect(cohortIdFor(undefined, undefined)).toBe("unisex_indeterminado");
  });

  test("parseCohort round-trips", () => {
    expect(parseCohort("femenino_adulta")).toEqual({
      gender: "femenino", age_band: "adulto",
    });
    expect(parseCohort("masculino_nino")).toEqual({
      gender: "masculino", age_band: "nino",
    });
    expect(parseCohort("unisex_indeterminado")).toEqual({
      gender: null, age_band: null,
    });
  });
});
