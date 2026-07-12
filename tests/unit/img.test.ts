import { describe, expect, it } from "vitest";
import { imgSrc, normalizeImageUrl } from "@/lib/img";

describe("imgSrc (3G: fotos livianas)", () => {
  const ali = "https://ae-pic-a1.aliexpress-media.com/kf/Sabc123.jpg";

  it("aliexpress crudo → sufijo de resize del CDN según el slot", () => {
    expect(imgSrc(ali, "aliexpress", 350)).toBe(`${ali}_350x350.jpg`);
    expect(imgSrc(ali, "aliexpress", 640)).toBe(`${ali}_640x640.jpg`);
  });

  it("ya redimensionada → no re-sufija (idempotente)", () => {
    const done = imgSrc(ali, "aliexpress", 350)!;
    expect(imgSrc(done, "aliexpress", 350)).toBe(done);
  });

  it("otras tiendas (ya sirven miniaturas) → URL intacta", () => {
    const amz = "https://m.media-amazon.com/images/I/x._AC_UL320_.jpg";
    expect(imgSrc(amz, "amazon", 350)).toBe(amz);
    // host no-aliexpress con source aliexpress (raro) → tampoco se toca
    expect(imgSrc(amz, "aliexpress", 350)).toBe(amz);
  });

  it("shein crudo → thumbnail del CDN (343KB→15KB verificado); ya-thumbnail intacta", () => {
    expect(imgSrc("//img.ltwebstatic.com/images3_pi/foto.jpg", "shein", 350)).toBe(
      "https://img.ltwebstatic.com/images3_pi/foto_thumbnail_220x293.jpg",
    );
    expect(imgSrc("https://img.ltwebstatic.com/x/foto.jpg", "shein", 640)).toBe(
      "https://img.ltwebstatic.com/x/foto_thumbnail_405x552.jpg",
    );
    const done = "https://img.ltwebstatic.com/x/a_thumbnail_405x552.jpg";
    expect(imgSrc(done, "shein", 350)).toBe(done);
  });

  it("null/undefined → null; normalizeImageUrl es lo mismo sin resize", () => {
    expect(imgSrc(null, "aliexpress", 350)).toBeNull();
    expect(normalizeImageUrl("//a.com/x.jpg")).toBe("https://a.com/x.jpg");
    expect(normalizeImageUrl("https://a.com/x.jpg")).toBe("https://a.com/x.jpg");
  });
});
