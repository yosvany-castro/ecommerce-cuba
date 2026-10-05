import { describe, expect, it } from "vitest";
import { imgSrc, imgSrcSet, imgTiny, normalizeImageUrl } from "@/lib/img";

describe("imgSrc (3G: fotos livianas)", () => {
  const ali = "https://ae-pic-a1.aliexpress-media.com/kf/Sabc123.jpg";

  it("aliexpress crudo → variante q75 webp del CDN según el slot (−50% verificado)", () => {
    expect(imgSrc(ali, "aliexpress", 350)).toBe(`${ali}_220x220q75.jpg_.webp`);
    expect(imgSrc(ali, "aliexpress", 640)).toBe(`${ali}_640x640q75.jpg_.webp`);
  });

  it("ya redimensionada → no re-sufija (idempotente)", () => {
    const done = imgSrc(ali, "aliexpress", 350)!;
    expect(imgSrc(done, "aliexpress", 350)).toBe(done);
  });

  it("amazon: token de tamaño reescrito para cards; PDP a 640 reales (la guardada es SX300)", () => {
    const amz = "https://m.media-amazon.com/images/I/x._AC_SY300_SX300_QL70_FMwebp_.jpg";
    expect(imgSrc(amz, "amazon", 350)).toBe("https://m.media-amazon.com/images/I/x._AC_SX220_QL60_FMwebp_.jpg");
    expect(imgSrc(amz, "amazon", 640)).toBe("https://m.media-amazon.com/images/I/x._AC_SX640_QL65_FMwebp_.jpg");
    // host amazon con source aliexpress (raro) → no se toca
    expect(imgSrc(amz, "aliexpress", 350)).toBe(amz);
  });

  it("shein crudo → thumbnail del CDN (jpg 343KB→15KB, webp 150KB→12KB verificados)", () => {
    expect(imgSrc("//img.ltwebstatic.com/images3_pi/foto.jpg", "shein", 350)).toBe(
      "https://img.ltwebstatic.com/images3_pi/foto_thumbnail_220x293.jpg",
    );
    // el agujero: originales .webp pasaban a tamaño completo
    expect(imgSrc("https://img.ltwebstatic.com/x/foto.webp", "shein", 640)).toBe(
      "https://img.ltwebstatic.com/x/foto_thumbnail_405x552.webp",
    );
  });

  it("shein ya-thumbnail → se REESCRIBE al tamaño del slot (una _900x se colaba entera)", () => {
    expect(imgSrc("https://img.ltwebstatic.com/x/a_thumbnail_900x.jpg", "shein", 350)).toBe(
      "https://img.ltwebstatic.com/x/a_thumbnail_220x293.jpg",
    );
    expect(imgSrc("https://img.ltwebstatic.com/x/a_square_thumbnail_405x552.jpg", "shein", 350)).toBe(
      "https://img.ltwebstatic.com/x/a_square_thumbnail_220x293.jpg",
    );
    const done = "https://img.ltwebstatic.com/x/a_thumbnail_405x552.jpg";
    expect(imgSrc(done, "shein", 640)).toBe(done);
  });

  it("null/undefined → null; normalizeImageUrl es lo mismo sin resize", () => {
    expect(imgSrc(null, "aliexpress", 350)).toBeNull();
    expect(normalizeImageUrl("//a.com/x.jpg")).toBe("https://a.com/x.jpg");
    expect(normalizeImageUrl("https://a.com/x.jpg")).toBe("https://a.com/x.jpg");
  });
});

describe("imgSrc 640 + imgSrcSet (2026-10-05: fotos borrosas)", () => {
  const amz = "https://m.media-amazon.com/images/I/61LP09dUn9L._AC_SY300_SX300_QL70_FMwebp_.jpg";
  const wm = "https://i5.walmartimages.com/seo/x.jpeg?odnHeight=180&odnWidth=180&odnBg=FFFFFF";
  it("Amazon/Walmart grandes salen a 640 de verdad", () => {
    expect(imgSrc(amz, "amazon", 640)).toBe("https://m.media-amazon.com/images/I/61LP09dUn9L._AC_SX640_QL65_FMwebp_.jpg");
    expect(imgSrc(wm, "walmart", 640)).toContain("odnHeight=640&odnWidth=640");
  });
  it("srcset por ancho desde la URL de tarjeta", () => {
    const ae = imgSrc("https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg", "aliexpress", 350)!;
    expect(imgSrcSet(ae)).toBe(
      "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg_220x220q75.jpg_.webp 220w, https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg_350x350q75.jpg_.webp 350w",
    );
    expect(imgSrcSet(imgSrc(amz, "amazon", 350), 640)).toContain("._AC_SX640_QL65_FMwebp_.jpg 640w");
    expect(imgSrcSet(imgSrc(amz, "amazon", 350))).not.toContain("640w"); // tarjetas: techo 350
    expect(imgSrcSet(wm, 640)).toContain("odnHeight=640&odnWidth=640&odnBg=FFFFFF 640w");
    expect(imgTiny(ae)).toBe("https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg_50x50q75.jpg_.webp");
    expect(imgSrcSet("https://example.com/a.jpg")).toBeUndefined();
  });
});
