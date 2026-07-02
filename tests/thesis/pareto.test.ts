import { describe, test, expect } from "vitest";
import { paretoFrontier, pickByKpi, type ParetoPoint } from "@/thesis/objectives/pareto";

describe("paretoFrontier", () => {
  const pts: ParetoPoint[] = [
    { id: "p1", metrics: { relevance: 1.0, revenue: 0.2 } },
    { id: "p2", metrics: { relevance: 0.6, revenue: 0.9 } },
    { id: "p3", metrics: { relevance: 0.5, revenue: 0.8 } }, // dominated by p2
    { id: "p4", metrics: { relevance: 0.3, revenue: 1.0 } },
  ];
  test("keeps only non-dominated points (maximize all)", () => {
    const f = paretoFrontier(pts, ["relevance", "revenue"]).map((p) => p.id).sort();
    expect(f).toEqual(["p1", "p2", "p4"]);
  });
});

describe("pickByKpi", () => {
  const pts: ParetoPoint[] = [
    { id: "p1", metrics: { relevance: 1.0, revenue: 0.2, sellerGini: 0.1 } },
    { id: "p2", metrics: { relevance: 0.6, revenue: 0.9, sellerGini: 0.2 } },
    { id: "p4", metrics: { relevance: 0.3, revenue: 1.0, sellerGini: 0.7 } },
  ];
  test("maximizes revenue subject to relevance and fairness guardrails", () => {
    const pick = pickByKpi(pts, { kpi: "revenue", guardrails: { relevance: { min: 0.5 }, sellerGini: { max: 0.3 } } });
    expect(pick.id).toBe("p2");
  });
  test("with no feasible point, returns the best-KPI point overall (documented fallback)", () => {
    const pick = pickByKpi(pts, { kpi: "revenue", guardrails: { relevance: { min: 0.99 }, sellerGini: { max: 0.01 } } });
    expect(pick.id).toBe("p4");
  });
});
