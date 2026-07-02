// tests/unit/single-flight.test.ts
import { describe, it, expect } from "vitest";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";

describe("single-flight", () => {
  it("dos llamadas concurrentes con la misma key comparten UNA ejecución", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    const [a, b] = await Promise.all([singleFlight("k", fn), singleFlight("k", fn)]);
    expect(calls).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("tras resolverse, la key vuelve a estar libre (no cachea resultados)", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    await singleFlight("k2", fn);
    await singleFlight("k2", fn);
    expect(calls).toBe(2);
  });

  it("un fallo libera la key y no envenena la siguiente llamada", async () => {
    let calls = 0;
    const boom = async () => {
      calls += 1;
      throw new Error("x");
    };
    await expect(singleFlight("k3", boom)).rejects.toThrow("x");
    await expect(singleFlight("k3", boom)).rejects.toThrow("x");
    expect(calls).toBe(2);
  });
});
