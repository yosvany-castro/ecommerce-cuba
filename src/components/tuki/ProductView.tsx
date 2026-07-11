"use client";
// src/components/tuki/ProductView.tsx — PDP Tuki (dc.html 437–541): galería, variantes
// demo, qty, acordeones (descripción real + specs/envío/opiniones fijas), add al carro,
// cross-sell real (combos). Data serializable llega de la page server; sin fetch propio.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import type { StorefrontCard } from "@/storefront/contract";
import { catOf, demoAttrs, fmt, mergeAttrs, stripe } from "./lib";
import { ProductCard, type CardSource } from "./ProductCard";
import { useTukiCart } from "./cart";

// Reviews fijas del diseño (dc.html 1289) — no hay reseñas reales en el catálogo aún.
const REVIEWS = [
  { who: "Marta G.", stars: "★★★★★", text: "Llegó al día siguiente y es tal cual las fotos. Cero drama." },
  { who: "Pablo R.", stars: "★★★★☆", text: "Muy buena relación calidad-precio. Repetiría sin pensarlo." },
];
const DESC_ROWS = ["Devolución gratis hasta 30 días", "Garantía tuki de 12 meses"];

export function ProductView({
  card,
  description,
  combos,
  source,
}: {
  card: StorefrontCard;
  description: string;
  combos: StorefrontCard[];
  source: CardSource;
}) {
  const router = useRouter();
  const { add } = useTukiCart();
  const da = mergeAttrs(demoAttrs(card.id, card.category, card.price_cents), card.attrs);
  const cat = catOf(card.category);
  const thumbs = card.attrs?.images && card.attrs.images.length > 1 ? card.attrs.images.slice(0, 4) : null;
  const oldC = da.oldPriceCents;
  const offPct = oldC != null ? "−" + Math.round((1 - card.price_cents / oldC) * 100) + "%" : "";

  const [selColor, setSelColor] = useState<string | null>(da.colors[0]?.name ?? null);
  const [selSize, setSelSize] = useState<string | null>(da.sizes[0] ?? null);
  const [qty, setQty] = useState(1);
  const [acc, setAcc] = useState<string>("desc");

  // product_view UNA vez por producto: ref por id dedupe el doble-mount de
  // StrictMode (mismo id → skip) y re-dispara al navegar a otra PDP (id cambia).
  const trackedId = useRef<string | null>(null);
  useEffect(() => {
    if (trackedId.current === card.id) return;
    trackedId.current = card.id;
    track("product_view", { product_id: card.id, source });
  }, [card.id, source]);

  // Hidratación de detalle bajo demanda: dispara UNA vez por producto real
  // (source amazon/aliexpress/walmart/shein) que aún no tiene attrs.hydrated_at.
  // Gate cliente = puro ahorro de request; el gate atómico real vive en el
  // UPDATE...WHERE...IS NULL del servidor (ver route.ts).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (card.attrs?.hydrated_at || hydratedFor.current === card.id) return;
    hydratedFor.current = card.id;
    const ctrl = new AbortController();
    fetch(`/api/products/${card.id}/hydrate`, { method: "POST", signal: ctrl.signal }).catch(() => {});
    return () => ctrl.abort();
  }, [card.id, card.attrs?.hydrated_at]);

  const onAdd = () =>
    add(
      { id: card.id, title: card.title, price_cents: card.price_cents, category: card.category ?? null, image_url: card.image_url },
      qty,
      selColor,
      selSize,
    );

  const specs = [
    { k: "Categoría", v: cat.label },
    { k: "Valoración", v: `★ ${da.rating} · ${da.sold} ventas` },
    { k: "Entrega", v: "24–48 h" },
    { k: "SKU", v: "TK-" + card.id.slice(0, 8).toUpperCase() },
  ];

  const sections: { id: string; label: string; body: React.ReactNode }[] = [
    {
      id: "desc",
      label: "Descripción",
      body: (
        <>
          <div style={{ fontSize: 14, color: "#55565B", lineHeight: 1.65, maxWidth: 560 }}>{description}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {DESC_ROWS.map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "#55565B" }}>
                <div style={{ width: 6, height: 6, borderRadius: 2, background: cat.deep }} />
                {t}
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "specs",
      label: "Especificaciones",
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, maxWidth: 460 }}>
          {specs.map((rw) => (
            <div key={rw.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <span style={{ color: "#8E8F94" }}>{rw.k}</span>
              <span style={{ fontWeight: 600, color: "#1C1D20" }}>{rw.v}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "ship",
      label: "Envío y devoluciones",
      body: (
        <div style={{ fontSize: 14, color: "#55565B", lineHeight: 1.65, maxWidth: 560 }}>
          Envío estándar en 24–48 h. Gratis desde $50.00. Devolución sin costo dentro de 30 días: la recogemos en tu puerta.
        </div>
      ),
    },
    {
      id: "rev",
      label: "Opiniones",
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
          {REVIEWS.map((rv) => (
            <div key={rv.who} style={{ background: "#fff", border: "1px solid #EFEFEA", borderRadius: 16, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{rv.who}</span>
                <span style={{ color: "#C99B3F", letterSpacing: 1 }}>{rv.stars}</span>
              </div>
              <div style={{ fontSize: 13.5, color: "#55565B", marginTop: 6, lineHeight: 1.55 }}>{rv.text}</div>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div style={{ animation: "screenIn .3s ease both", maxWidth: 1160, margin: "0 auto", padding: "26px 28px 90px" }}>
      <div style={{ fontSize: 13, color: "#8E8F94" }}>
        <span onClick={() => router.push("/")} className="tk-hov-dark tk-hov-underline" style={{ cursor: "pointer" }}>
          Inicio
        </span>{" "}
        /{" "}
        <span onClick={() => router.push(`/c/${cat.id}`)} className="tk-hov-dark tk-hov-underline" style={{ cursor: "pointer" }}>
          {cat.label}
        </span>{" "}
        / <span style={{ color: "#1C1D20", fontWeight: 600 }}>{card.title}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "480px 1fr", gap: 48, marginTop: 20, alignItems: "start" }}>
        {/* galería */}
        <div>
          <div style={{ position: "relative", height: 440, borderRadius: 26, background: stripe(cat), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {card.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.image_url} alt={card.title} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9a9b98" }}>foto producto grande</span>
            )}
            {oldC != null && (
              <div style={{ position: "absolute", top: 16, left: 16, background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: 700 }}>
                {offPct} hoy
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {thumbs ? (
              thumbs.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={card.title}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{ width: 76, height: 76, borderRadius: 14, objectFit: "cover", border: i === 0 ? "2px solid #1C1D20" : "2px solid transparent" }}
                />
              ))
            ) : (
              <>
                <div style={{ width: 76, height: 76, borderRadius: 14, background: stripe(cat), border: "2px solid #1C1D20" }} />
                <div style={{ width: 76, height: 76, borderRadius: 14, background: stripe(cat), opacity: 0.7 }} />
                <div style={{ width: 76, height: 76, borderRadius: 14, background: stripe(cat), opacity: 0.5 }} />
                <div style={{ width: 76, height: 76, borderRadius: 14, background: stripe(cat), opacity: 0.35, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#77787D", fontWeight: 600 }}>
                  +3
                </div>
              </>
            )}
          </div>
        </div>

        {/* info */}
        <div>
          <div style={{ display: "inline-block", background: cat.tint, color: cat.deep, borderRadius: 999, padding: "5px 13px", fontSize: 12, fontWeight: 700 }}>{cat.label}</div>
          <div style={{ fontFamily: "var(--font-brico)", fontSize: 34, fontWeight: 700, letterSpacing: "-0.7px", marginTop: 10, lineHeight: 1.1 }}>{card.title}</div>
          <div style={{ fontSize: 13.5, color: "#8E8F94", marginTop: 8 }}>
            ★ {da.rating} · {da.sold} vendidos · envío 24–48 h
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.7px" }}>{fmt(card.price_cents)}</span>
            {oldC != null && (
              <>
                <span style={{ fontSize: 16, color: "#B0B1AE", textDecoration: "line-through" }}>{fmt(oldC)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: cat.deep, background: cat.tint, borderRadius: 999, padding: "4px 10px" }}>ahorras {fmt(oldC - card.price_cents)}</span>
              </>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 16, color: cat.deep, marginTop: 12 }}>✦ encaja con lo que has estado mirando</div>

          {da.colors.length > 0 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 20 }}>
                Color · <span style={{ color: "#8E8F94", fontWeight: 500 }}>{selColor}</span>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                {da.colors.map((cv, i) => (
                  <div
                    key={i}
                    onClick={() => setSelColor(cv.name)}
                    style={{ width: 36, height: 36, borderRadius: "50%", background: cv.hex ?? "#D8D8D3", cursor: "pointer", border: `2px solid ${selColor === cv.name ? "#1C1D20" : "rgba(0,0,0,.08)"}`, boxShadow: "inset 0 0 0 3px #FAFAF8" }}
                  />
                ))}
              </div>
            </>
          )}

          {da.sizes.length > 0 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 18 }}>Talla</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {da.sizes.map((sz) => {
                  const on = selSize === sz;
                  return (
                    <div
                      key={sz}
                      onClick={() => setSelSize(sz)}
                      style={{ minWidth: 46, height: 42, padding: "0 13px", boxSizing: "border-box", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, cursor: "pointer", background: on ? "#1C1D20" : "#fff", color: on ? "#fff" : "#55565B", border: `1.5px solid ${on ? "#1C1D20" : "#ECECE7"}` }}
                    >
                      {sz}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <div style={{ flex: "none", display: "flex", alignItems: "center", background: "#fff", border: "1px solid #ECECE7", borderRadius: 999 }}>
              <div onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ width: 44, height: 54, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "#55565B" }}>
                −
              </div>
              <div style={{ width: 24, textAlign: "center", fontSize: 15.5, fontWeight: 700 }}>{qty}</div>
              <div onClick={() => setQty((q) => q + 1)} style={{ width: 44, height: 54, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "#55565B" }}>
                +
              </div>
            </div>
            <div
              onClick={onAdd}
              className="tk-hov-cta"
              style={{ flex: 1, maxWidth: 340, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 15.5, fontWeight: 700, cursor: "pointer" }}
            >
              Agregar · {fmt(card.price_cents * qty)}
            </div>
          </div>

          <div style={{ marginTop: 26, borderTop: "1px solid #ECECE7" }}>
            {sections.map((s) => {
              const open = acc === s.id;
              return (
                <div key={s.id} style={{ borderBottom: "1px solid #ECECE7" }}>
                  <div onClick={() => setAcc((a) => (a === s.id ? "" : s.id))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 2px", cursor: "pointer" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</span>
                    <span style={{ fontSize: 20, color: "#8E8F94", transform: open ? "rotate(45deg)" : "rotate(0deg)", transition: "transform .25s", display: "inline-block" }}>+</span>
                  </div>
                  {open && <div style={{ padding: "0 2px 18px", animation: "screenIn .25s ease both" }}>{s.body}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {combos.length > 0 && (
        <>
          <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700, margin: "44px 0 4px" }}>Combínalo con</div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: "#8E8F94", marginBottom: 16 }}>quienes lo llevaron, sumaron esto</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {combos.map((c) => (
              <ProductCard key={c.id} card={c} source="direct" variant="grid" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
