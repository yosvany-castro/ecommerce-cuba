import { describe, test, expect } from "vitest";
import { canonicalize, hashQuery } from "@/sectors/c-search/cache/hash";

describe("canonicalize", () => {
  test.each([
    ["Hello World", "hello world"],
    ["WORLD HELLO", "hello world"],
    ["Sábanas", "sabanas"],
    ["  multiple   spaces  ", "multiple spaces"],
    ["regalo niña 8 años", "8 anos nina regalo"],
    ["niña 8 años regalo", "8 anos nina regalo"],
    ["8 años niña regalo", "8 anos nina regalo"],
  ])("canonicalize(%j) === %j", (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });

  test("empty string → empty string", () => {
    expect(canonicalize("")).toBe("");
  });
});

describe("hashQuery", () => {
  test("returns hex-64 string", () => {
    expect(hashQuery("hello world")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", () => {
    const h1 = hashQuery("hello world");
    const h2 = hashQuery("hello world");
    expect(h1).toBe(h2);
  });

  test("different canonical inputs produce different hashes", () => {
    expect(hashQuery("hello")).not.toBe(hashQuery("world"));
  });

  test("order-independent: hashQuery('world hello') === hashQuery('hello world')", () => {
    expect(hashQuery("world hello")).toBe(hashQuery("hello world"));
  });

  test("3 Spanish permutations all hash identically", () => {
    const a = hashQuery("regalo niña 8 años");
    const b = hashQuery("niña 8 años regalo");
    const c = hashQuery("8 años niña regalo");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
