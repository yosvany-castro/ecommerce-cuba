import { describe, test, expect } from "vitest";
import { toSessionSequences, type EventRow } from "@/thesis/embedders/sessions";

describe("toSessionSequences", () => {
  const rows: EventRow[] = [
    { session_id: "s1", product_id: "a", occurred_at: "2026-01-01T00:00:01Z" },
    { session_id: "s1", product_id: "b", occurred_at: "2026-01-01T00:00:02Z" },
    { session_id: "s1", product_id: "a", occurred_at: "2026-01-01T00:00:03Z" },
    { session_id: "s2", product_id: "c", occurred_at: "2026-01-01T00:00:01Z" },
  ];
  test("groups by session, ordered by time, consecutive dups collapsed", () => {
    const seqs = toSessionSequences(rows);
    expect(seqs).toEqual([["a", "b", "a"], ["c"]]);
  });
  test("drops single-item sessions when minLen=2", () => {
    const seqs = toSessionSequences(rows, 2);
    expect(seqs).toEqual([["a", "b", "a"]]);
  });
  test("empty input → empty", () => {
    expect(toSessionSequences([])).toEqual([]);
  });
});
