import { describe, test, expect } from "vitest";
import { costCentsFromRun, collectItems } from "@/sectors/b-catalog/apify/client";

describe("costCentsFromRun", () => {
  test("uses real usage when present, rounded up to cents", () => {
    expect(costCentsFromRun(0.0421, 10, 0.003)).toBe(5);
  });

  test("falls back to itemCount * perItemUsd estimate when usage is null", () => {
    expect(costCentsFromRun(null, 10, 0.003)).toBe(3);
  });

  test("floors at 1 cent even for a zero-item, zero-usage run", () => {
    expect(costCentsFromRun(null, 0, 0.003)).toBe(1);
  });
});

describe("collectItems", () => {
  test("concatenates pages and stops once limitItems is reached", async () => {
    const pages = [
      { items: [1, 2, 3, 4, 5], total: 8 },
      { items: [6, 7, 8], total: 8 },
    ];
    const calls: { limit: number; offset: number }[] = [];
    const fakeDataset = {
      listItems: async (opts: { limit: number; offset: number }) => {
        calls.push(opts);
        const page = pages[calls.length - 1];
        if (!page) throw new Error("unexpected extra page request");
        return page;
      },
    };

    const items = await collectItems(fakeDataset, 6);

    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calls).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 5 },
    ]);
  });

  test("stops once dataset total is exhausted, even below limitItems", async () => {
    const fakeDataset = {
      listItems: async (_opts: { limit: number; offset: number }) => ({
        items: [1, 2, 3],
        total: 3,
      }),
    };

    const items = await collectItems(fakeDataset, 100);

    expect(items).toEqual([1, 2, 3]);
  });
});
