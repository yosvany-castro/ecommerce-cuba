import { describe, expect, it } from "vitest";

// Guardia del blindaje de tests/helpers/setup.ts: si esto falla, los tests
// podrían gastar cuota real de Apify/RapidAPI (pasó el 2026-10-05).
describe("tests sin APIs pagadas", () => {
  it.skipIf(process.env.ALLOW_PAID_APIS_IN_TESTS === "1")("proveedor mock y sin credenciales pagadas", async () => {
    expect(process.env.APIFY_TOKEN).toBeUndefined();
    expect(process.env.RAPIDAPI_KEY).toBeUndefined();
    const { activeProvider } = await import("@/sectors/b-catalog/provider");
    expect(activeProvider.name).toBe("mock");
  });
});
