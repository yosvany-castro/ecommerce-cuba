"use client";
// src/components/tuki/Listing.tsx — grilla + sidebar + quick filters compartidos (dc.html 301–434).
// Usado por búsqueda (T6) y categoría (T7). Todo el filtrado es client-side sobre FilterableCard[].
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import type { StorefrontCard } from "@/storefront/contract";
import { CATS, demoAttrs } from "./lib";
import { ProductCard, type CardSource } from "./ProductCard";
import { FiltersDrawer } from "./FiltersDrawer";
import { advCount, applyFilters, EMPTY_ADV, type AdvState, type FilterableCard } from "./filters";

export interface ListingHeader {
  crumb: string;
  title: string;
  why: string;
  deep: string;
  tint: string;
}

// Brief: las 6 CATS reales (sin la "Ofertas" virtual del diseño; no es categoría del catálogo).
const SIDE_CATS = Object.values(CATS);
const QUICK: [string, string][] = [["oferta", "En oferta"], ["r4", "★ 4.6+"], ["envio", "Envío gratis"], ["precio", "Precio ↑"]];
const label11 = { fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: "#8E8F94" } as const;

export function Listing({
  cards,
  source,
  header,
  sidebar,
  overlay,
  notice,
}: {
  cards: StorefrontCard[];
  source: CardSource;
  header: ListingHeader;
  sidebar: boolean;
  overlay?: React.ReactNode; // reemplaza la grilla (loader de búsqueda en loading)
  notice?: React.ReactNode; // pill sobre la grilla (badge de caché)
}) {
  const router = useRouter();
  const [adv, setAdv] = useState<AdvState>(EMPTY_ADV);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filterable: FilterableCard[] = useMemo(
    () => cards.map((c) => ({ card: c, attrs: demoAttrs(c.id, c.category, c.price_cents) })),
    [cards],
  );
  const shown = useMemo(() => applyFilters(filterable, adv), [filterable, adv]);
  const nAdv = advCount(adv);

  const pickCat = (id: string) => {
    track("category_click", { category: id });
    router.push(`/c/${id}`);
  };
  // ponytail: el diseño tenía `cf` (quick) y `adv` (drawer) separados con lógica de
  // oferta/r4/envío DUPLICADA; consolidado en adv — mismos campos = mismo filtro,
  // una sola fuente de verdad (applyFilters). "Precio ↑" alterna sort asc/rel.
  const quickOn = (k: string) => (k === "precio" ? adv.sort === "asc" : adv[k as "oferta" | "r4" | "envio"]);
  const toggleQuick = (k: string) => {
    if (k === "precio") {
      const next: AdvState["sort"] = adv.sort === "asc" ? "rel" : "asc";
      track("filter_applied", { filter_type: "sort", filter_value: next });
      setAdv((a) => ({ ...a, sort: next }));
    } else {
      const key = k as "oferta" | "r4" | "envio";
      track("filter_applied", { filter_type: key, filter_value: !adv[key] });
      setAdv((a) => ({ ...a, [key]: !a[key] }));
    }
  };

  return (
    <div style={{ animation: "screenIn .3s ease both", maxWidth: 1280, margin: "0 auto", padding: "26px 28px 80px" }}>
      <div style={{ fontSize: 13, color: "#8E8F94" }}>
        <span onClick={() => router.push("/")} className="tk-hov-dark tk-hov-underline" style={{ cursor: "pointer" }}>
          Inicio
        </span>{" "}
        / <span style={{ color: "#1C1D20", fontWeight: 600 }}>{header.crumb}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 10 }}>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 32, fontWeight: 700, letterSpacing: "-0.6px" }}>{header.title}</div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 16, color: header.deep }}>{header.why}</div>
      </div>

      <div style={{ display: "flex", gap: 28, marginTop: 24, alignItems: "flex-start" }}>
        {sidebar && (
          <div style={{ flex: "none", width: 240, position: "sticky", top: 0 }}>
            <div style={{ background: "#fff", border: "1px solid #EFEFEA", borderRadius: 20, padding: 18 }}>
              <div style={label11}>PASILLOS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
                {SIDE_CATS.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => pickCat(c.id)}
                    className="tk-hov-bg"
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 11, cursor: "pointer", fontSize: 13.5, fontWeight: 500 }}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: 4, background: c.deep }} />
                    {c.label}
                  </div>
                ))}
              </div>
              <div style={{ height: 1, background: "#F1F1EE", margin: "14px 0" }} />
              <div style={label11}>RÁPIDOS</div>
              <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
                {QUICK.map(([k, lbl]) => {
                  const on = quickOn(k);
                  return (
                    <div key={k} onClick={() => toggleQuick(k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", cursor: "pointer" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 6, border: `1.5px solid ${on ? "#1C1D20" : "#D8D8D3"}`, background: on ? "#1C1D20" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 800 }}>
                        {on ? "✓" : ""}
                      </div>
                      <span style={{ fontSize: 13.5, color: "#3A3B40" }}>{lbl}</span>
                    </div>
                  );
                })}
              </div>
              <div
                onClick={() => setDrawerOpen(true)}
                style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 999, border: `1.5px solid ${nAdv ? "#1C1D20" : "#D8D8D3"}`, background: nAdv ? "#1C1D20" : "#fff", color: nAdv ? "#fff" : "#3A3B40", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                <svg width="15" height="15" viewBox="0 0 20 20">
                  <line x1="3" y1="6" x2="17" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <line x1="3" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="8" cy="6" r="2.4" fill={nAdv ? "#1C1D20" : "#fff"} stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="12.5" cy="14" r="2.4" fill={nAdv ? "#1C1D20" : "#fff"} stroke="currentColor" strokeWidth="1.8" />
                </svg>
                {nAdv ? `Más filtros · ${nAdv}` : "Más filtros"}
              </div>
            </div>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {overlay ?? (
            <>
              {notice}
              <div style={{ fontSize: 13, color: "#8E8F94", marginBottom: 14 }}>{shown.length} productos · ordenado para ti</div>
              {shown.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
                  {shown.map(({ card }) => (
                    <ProductCard key={card.id} card={card} source={source} variant="grid" />
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 24, color: "#55565B" }}>nada por aquí…</div>
                  <div style={{ fontSize: 14, color: "#8E8F94", marginTop: 8 }}>prueba quitando filtros o busca otra cosa</div>
                  <div
                    onClick={() => setAdv(EMPTY_ADV)}
                    style={{ display: "inline-flex", marginTop: 16, padding: "12px 22px", borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Limpiar filtros
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {drawerOpen && <FiltersDrawer adv={adv} setAdv={setAdv} count={shown.length} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
