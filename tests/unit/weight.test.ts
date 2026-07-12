import { describe, expect, it } from "vitest";
import { estimateWeightGrams, extractInlineWeightGrams, gramsToLb, packagedGrams, parseWeightToGrams } from "@/lib/weight";

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

describe("packagedGrams (peso neto del marketplace → peso de paquete facturable)", () => {
  it("suma pad por categoría + 8% de relleno", () => {
    expect(packagedGrams(1000, "ropa")).toBe(1120); // 1000*1.08 + 40
    expect(packagedGrams(500, "electronica")).toBe(690); // 540 + 150
    expect(packagedGrams(500)).toBe(640); // sin categoría → pad 100
  });
});

describe("estimateWeightGrams (heurística determinista compartida cliente/server)", () => {
  it("el peso inline del texto es NETO → sale con empaque sumado", () => {
    const r = estimateWeightGrams({ title: "Pesa rusa 8 kg", category: "hogar" });
    expect(r.method).toBe("inline");
    expect(r.grams).toBe(packagedGrams(8000, "hogar"));
  });
  it("inline > keyword > categoría", () => {
    expect(estimateWeightGrams({ title: "Pesa rusa 8 kg", category: "hogar" }).method).toBe("inline");
    const fan = estimateWeightGrams({ title: "Ventilador de pie oscilante", category: "hogar" });
    expect(fan.method).toBe("keyword");
    expect(fan.grams).toBeGreaterThan(3000);
    const generic = estimateWeightGrams({ title: "Producto misterioso", category: "belleza" });
    expect(generic.method).toBe("category");
    expect(generic.grams).toBe(250);
  });
  it("tokens cortos con frontera de palabra: 'Collar' no es 'olla' (bug visto en eval)", () => {
    const dress = estimateWeightGrams({ title: "Sexy Square Collar Floral Lace Maxi Dress", category: "ropa" });
    expect(dress.grams).toBeLessThan(1000); // es un vestido, no una olla de 3.5 kg
    expect(estimateWeightGrams({ title: "Olla arrocera 1.8L antiadherente", category: "hogar" }).grams).toBe(3500);
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
