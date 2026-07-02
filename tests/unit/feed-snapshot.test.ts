import { describe, it, expect } from "vitest";
import {
  shouldRestoreSnapshot,
  parseSnapshot,
  SNAPSHOT_TTL_MS,
  type FeedSnapshot,
} from "@/lib/client/feed-snapshot";

const snap = (over: Partial<FeedSnapshot<number>> = {}): FeedSnapshot<number> => ({
  slate_id: "s1",
  items: [1, 2, 3],
  cursor: "c",
  scroll_y: 1200,
  saved_at: 1_000_000,
  ...over,
});

describe("shouldRestoreSnapshot (C6)", () => {
  const now = 1_000_000 + 60_000; // 1 min después

  it("restaura: fresco, mismo slate, con items", () => {
    expect(shouldRestoreSnapshot(snap(), "s1", now)).toBe(true);
  });

  it("descarta al cruzar el TTL compartido de 300s (mismo umbral que el servidor)", () => {
    expect(shouldRestoreSnapshot(snap(), "s1", 1_000_000 + SNAPSHOT_TTL_MS)).toBe(false);
    expect(shouldRestoreSnapshot(snap(), "s1", 1_000_000 + SNAPSHOT_TTL_MS - 1)).toBe(true);
  });

  it("descarta si el SSR sirvió OTRO slate (mezclar dos slates duplica/salta items)", () => {
    expect(shouldRestoreSnapshot(snap(), "s2", now)).toBe(false);
    expect(shouldRestoreSnapshot(snap({ slate_id: null }), null, now)).toBe(false); // sin slate no hay qué casar
  });

  it("descarta snapshots vacíos o corruptos", () => {
    expect(shouldRestoreSnapshot(snap({ items: [] }), "s1", now)).toBe(false);
    expect(shouldRestoreSnapshot(null, "s1", now)).toBe(false);
    expect(parseSnapshot("{bad json")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ items: "x", saved_at: 1 }))).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});
