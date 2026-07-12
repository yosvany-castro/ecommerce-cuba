import { describe, expect, it } from "vitest";
import { imgSrc, normalizeImageUrl } from "@/lib/img";

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

  it("amazon: token de tamaño reescrito para cards; PDP intacta", () => {
    const amz = "https://m.media-amazon.com/images/I/x._AC_SY300_SX300_QL70_FMwebp_.jpg";
    expect(imgSrc(amz, "amazon", 350)).toBe("https://m.media-amazon.com/images/I/x._AC_SX220_QL60_FMwebp_.jpg");
    expect(imgSrc(amz, "amazon", 640)).toBe(amz);
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
