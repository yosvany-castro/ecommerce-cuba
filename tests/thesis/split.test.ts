import { describe, test, expect } from "vitest";
import { temporalSplit } from "@/thesis/eval/split";

describe("temporalSplit", () => {
  const purchases = [
    { user_id: "u1", product_id: "p1", occurred_at: "2026-01-01T00:00:00Z" },
    { user_id: "u1", product_id: "p2", occurred_at: "2026-02-01T00:00:00Z" },
    { user_id: "u1", product_id: "p3", occurred_at: "2026-03-01T00:00:00Z" },
    { user_id: "u2", product_id: "p4", occurred_at: "2026-01-15T00:00:00Z" },
  ];

  test("latest purchase per user with >=2 purchases becomes test", () => {
    const { test: te } = temporalSplit(purchases);
    expect(te.find((r) => r.user_id === "u1")?.product_id).toBe("p3");
  });

  test("user with a single purchase contributes no test row", () => {
    const { test: te } = temporalSplit(purchases);
    expect(te.some((r) => r.user_id === "u2")).toBe(false);
  });

  test("train holds all non-test purchases", () => {
    const { train } = temporalSplit(purchases);
    const u1train = train.filter((r) => r.user_id === "u1").map((r) => r.product_id).sort();
    expect(u1train).toEqual(["p1", "p2"]);
    expect(train.some((r) => r.user_id === "u2" && r.product_id === "p4")).toBe(true);
  });

  test("every test row's timestamp is strictly after that user's train rows", () => {
    const { train, test: te } = temporalSplit(purchases);
    for (const t of te) {
      const userTrain = train.filter((r) => r.user_id === t.user_id);
      const maxTrain = Math.max(...userTrain.map((r) => Date.parse(r.occurred_at)));
      expect(Date.parse(t.occurred_at) > maxTrain).toBe(true);
    }
  });

  test("tie on latest timestamp is broken deterministically by product_id", () => {
    const tied = [
      { user_id: "u3", product_id: "pb", occurred_at: "2026-05-01T00:00:00Z" },
      { user_id: "u3", product_id: "pa", occurred_at: "2026-05-01T00:00:00Z" },
      { user_id: "u3", product_id: "p0", occurred_at: "2026-04-01T00:00:00Z" },
    ];
    const { test: te } = temporalSplit(tied);
    // both share max timestamp; deterministic max-by (occurred_at, product_id) → "pb"
    expect(te.find((r) => r.user_id === "u3")?.product_id).toBe("pb");
  });

  test("empty input yields empty splits", () => {
    const { train, test: te } = temporalSplit([]);
    expect(train.length === 0 && te.length === 0).toBe(true);
  });
});
