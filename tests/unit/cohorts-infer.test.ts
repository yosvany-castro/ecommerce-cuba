import { describe, test, expect } from "vitest";
import {
  inferSignalFromProductMetadata,
  inferSignalFromNormalizedQuery,
  majorityCohort,
  countSignalsNotMatchingCohort,
  type EventSignal,
} from "@/sectors/d-personalization/cohorts/infer";

describe("inferSignalFromProductMetadata", () => {
  test("femenino adulto product → femenino_adulta cohort", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "femenino",
      age_target: { min: 26, max: 50 },
    });
    expect(sig).toEqual({
      cohort_id: "femenino_adulta",
      gender: "femenino",
      age_band: "adulto",
    });
  });

  test("masculino nino product → masculino_nino", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "masculino",
      age_target: { min: 4, max: 10 },
    });
    expect(sig.cohort_id).toBe("masculino_nino");
    expect(sig.gender).toBe("masculino");
    expect(sig.age_band).toBe("nino");
  });

  test("femenino mayor product → femenino_mayor", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "femenino",
      age_target: { min: 65, max: 85 },
    });
    expect(sig.cohort_id).toBe("femenino_mayor");
  });

  test("unisex product → unisex_indeterminado", () => {
    const sig = inferSignalFromProductMetadata({
      gender_target: "unisex",
      age_target: { min: 0, max: 99 },
    });
    expect(sig.cohort_id).toBe("unisex_indeterminado");
  });

  test("missing fields → unisex_indeterminado", () => {
    expect(inferSignalFromProductMetadata({}).cohort_id).toBe("unisex_indeterminado");
    expect(inferSignalFromProductMetadata(null).cohort_id).toBe("unisex_indeterminado");
    expect(inferSignalFromProductMetadata(undefined).cohort_id).toBe(
      "unisex_indeterminado",
    );
  });

  test("only gender, no age → unisex_indeterminado (need both)", () => {
    expect(
      inferSignalFromProductMetadata({ gender_target: "femenino" }).cohort_id,
    ).toBe("unisex_indeterminado");
  });
});

describe("inferSignalFromNormalizedQuery", () => {
  test("regalo abuelo → masculino_mayor", () => {
    const sig = inferSignalFromNormalizedQuery({
      recipient_gender: "masculino",
      recipient_age_min: 65,
      recipient_age_max: 85,
    });
    expect(sig.cohort_id).toBe("masculino_mayor");
  });

  test("query without age info → unisex_indeterminado", () => {
    const sig = inferSignalFromNormalizedQuery({
      recipient_gender: "femenino",
      recipient_age_min: null,
      recipient_age_max: null,
    });
    expect(sig.cohort_id).toBe("unisex_indeterminado");
  });
});

describe("majorityCohort", () => {
  test("returns most common concrete cohort", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
    ];
    expect(majorityCohort(sigs)).toBe("femenino_adulta");
  });

  test("ignores unisex_indeterminado when concrete signals exist", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
    ];
    expect(majorityCohort(sigs)).toBe("femenino_adulta");
  });

  test("all unisex → unisex_indeterminado", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
      { cohort_id: "unisex_indeterminado", gender: null, age_band: null },
    ];
    expect(majorityCohort(sigs)).toBe("unisex_indeterminado");
  });

  test("empty signals → unisex_indeterminado", () => {
    expect(majorityCohort([])).toBe("unisex_indeterminado");
  });
});

describe("countSignalsNotMatchingCohort", () => {
  test("counts signals whose cohort differs", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
    ];
    expect(countSignalsNotMatchingCohort(sigs, "femenino_adulta")).toBe(3);
  });

  test("all match → 0", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
      { cohort_id: "femenino_adulta", gender: "femenino", age_band: "adulto" },
    ];
    expect(countSignalsNotMatchingCohort(sigs, "femenino_adulta")).toBe(0);
  });

  test("none match → all counted", () => {
    const sigs: EventSignal[] = [
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
      { cohort_id: "masculino_nino", gender: "masculino", age_band: "nino" },
    ];
    expect(countSignalsNotMatchingCohort(sigs, "femenino_adulta")).toBe(2);
  });
});
