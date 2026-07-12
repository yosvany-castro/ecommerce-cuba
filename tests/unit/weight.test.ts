import { describe, expect, it } from "vitest";
import { estimateWeightGrams, extractInlineWeightGrams, gramsToLb, parseWeightToGrams } from "@/lib/weight";

describe("parseWeightToGrams", () => {
  it("unidades reales de los fixtures de Amazon", () => {
    expect(parseWeightToGrams("20 Grams")).toBe(20);
    expect(parseWeightToGrams("1.76 ounces")).toBe(50);
    expect(parseWeightToGrams("76.4 Grams")).toBe(76);
    expect(parseWeightToGrams("0.5 Pounds")).toBe(227);
    expect(parseWeightToGrams("1.2 Kilograms")).toBe(1200);
  });
  it("unidad rara o basura → null, sin inventar", () => {
    expect(parseWeightToGrams("0.1 Hundredths Pounds")).toBeNull();
    expect(parseWeightToGrams("grande")).toBeNull();
    expect(parseWeightToGrams("")).toBeNull();
    expect(parseWeightToGrams("-5 kg")).toBeNull();
  });
});

describe("extractInlineWeightGrams", () => {
  it("peso escrito en el título", () => {
    expect(extractInlineWeightGrams("Mancuerna recubierta 5 kg par")).toBe(5000);
    expect(extractInlineWeightGrams("Café molido 500g tueste oscuro")).toBe(500);
  });
  it("specs de red no son pesos (2.4G / 5G)", () => {
    expect(extractInlineWeightGrams("Mouse inalámbrico 2.4G ergonómico")).toBeNull();
    expect(extractInlineWeightGrams("Router WiFi 5G doble banda 1gb")).toBeNull();
  });
});

describe("estimateWeightGrams (heurística determinista compartida cliente/server)", () => {
  it("inline > keyword > categoría", () => {
    expect(estimateWeightGrams({ title: "Pesa rusa 8 kg", category: "hogar" }).method).toBe("inline");
    const fan = estimateWeightGrams({ title: "Ventilador de pie oscilante", category: "hogar" });
    expect(fan.method).toBe("keyword");
    expect(fan.grams).toBeGreaterThan(3000);
    const generic = estimateWeightGrams({ title: "Producto misterioso", category: "belleza" });
    expect(generic.method).toBe("category");
    expect(generic.grams).toBe(250);
  });
  it("mini/portátil reduce el peso de la keyword", () => {
    const mini = estimateWeightGrams({ title: "Mini ventilador portátil USB", category: "electronica" });
    const full = estimateWeightGrams({ title: "Ventilador oscilante", category: "electronica" });
    expect(mini.grams).toBeLessThan(full.grams);
  });
});

describe("gramsToLb", () => {
  it("redondeo a 1 decimal, mínimo 0.1", () => {
    expect(gramsToLb(453.592)).toBe(1);
    expect(gramsToLb(10)).toBe(0.1);
    expect(gramsToLb(2268)).toBe(5);
  });
});
