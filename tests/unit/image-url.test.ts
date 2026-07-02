import { describe, it, expect } from "vitest";
import { productImageUrl, isDataSaver } from "@/lib/image-url";

describe("productImageUrl (F3)", () => {
  const amazon = "https://m.media-amazon.com/images/I/foo.jpg";

  it("proxya por wsrv con ancho/calidad por variante y salida webp", () => {
    const grid = productImageUrl(amazon, "grid")!;
    expect(grid).toContain("https://wsrv.nl/?url=");
    expect(grid).toContain(encodeURIComponent(amazon));
    expect(grid).toContain("w=300");
    expect(grid).toContain("q=60");
    expect(grid).toContain("output=webp");
    expect(productImageUrl(amazon, "pdp")).toContain("w=800");
  });

  it("modo ahorro baja la calidad (grid 45 / pdp 55)", () => {
    expect(productImageUrl(amazon, "grid", { saver: true })).toContain("q=45");
    expect(productImageUrl(amazon, "pdp", { saver: true })).toContain("q=55");
  });

  it("null y rutas locales/relativas pasan intactas (sin proxy)", () => {
    expect(productImageUrl(null, "grid")).toBeNull();
    expect(productImageUrl("/img/placeholder.png", "grid")).toBe("/img/placeholder.png");
  });
});

describe("isDataSaver (default-ON)", () => {
  it("sin cookie = ahorro ON; cookie off lo apaga; Save-Data es PISO", () => {
    expect(isDataSaver(undefined, false)).toBe(true);
    expect(isDataSaver("off", false)).toBe(false);
    expect(isDataSaver("off", true)).toBe(true); // el navegador pidió ahorro: gana
    expect(isDataSaver("on", false)).toBe(true);
  });
});
