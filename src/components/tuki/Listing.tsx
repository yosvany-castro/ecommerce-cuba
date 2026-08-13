"use client";
// src/components/tuki/Listing.tsx — grilla + BARRA de filtros (diseño v2: muere
// el sidebar; pasillos como chips, quick pills, dropdown de orden y pills
// removibles de filtros activos). Usado por búsqueda (T6) y categoría (T7).
// Todo el filtrado es client-side sobre FilterableCard[].
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import type { StorefrontCard } from "@/storefront/contract";
import { attrsOf, CATS } from "./lib";
import { ProductCard, type CardSource } from "./ProductCard";
import { FiltersDrawer } from "./FiltersDrawer";
import { advCount, applyFilters, EMPTY_ADV, PRICE_LABELS, SORT_LABELS, type AdvState, type FilterableCard } from "./filters";

export interface ListingHeader {
  crumb: string;
  title: string;
  why: string;
  deep: string;
  tint: string;
}

// Brief: las 6 CATS reales (sin la "Ofertas" virtual del diseño; no es categoría del catálogo).
const SIDE_CATS = Object.values(CATS);
// v2: quick pills solo oferta y rating — "Precio ↑" vive en el dropdown de
// orden, y "Envío gratis" MURIÓ (no existe envío gratis en el modelo por libra;
// el filtro viejo era un proxy falso por precio ≥ $20).
const QUICK: [("oferta" | "r4"), string][] = [["oferta", "En oferta"], ["r4", "★ 4.6+"]];

export function Listing({
  cards,
  source,
  header,
  activeCat,
  initialAdv,
  overlay,
  notice,
}: {
  cards: StorefrontCard[];
  source: CardSource;
  header: ListingHeader;
  /** id de la categoría actual (página /c/[cat]) — resalta su chip. */
  activeCat?: string;
  /** filtros iniciales (sugerencias-filtro del buscador: «q» en oferta / mejor valorados). */
  initialAdv?: Partial<AdvState>;
  overlay?: React.ReactNode; // reemplaza la grilla (loader de búsqueda en loading)
  notice?: React.ReactNode; // pill sobre la grilla (badge de caché)
}) {
  const router = useRouter();
  const [adv, setAdv] = useState<AdvState>(() => ({ ...EMPTY_ADV, ...initialAdv }));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const filterable: FilterableCard[] = useMemo(
    () => cards.map((c) => ({ card: c, attrs: attrsOf(c) })),
    [cards],
  );
  const shown = useMemo(() => applyFilters(filterable, adv), [filterable, adv]);
  const nAdv = advCount(adv);

  const pickCat = (id: string) => {
    track("category_click", { category: id });
    router.push(`/c/${id}`);
  };
  const toggleQuick = (key: "oferta" | "r4") => {
    track("filter_applied", { filter_type: key, filter_value: adv[key] ? "off" : "on" });
    setAdv((a) => ({ ...a, [key]: !a[key] }));
  };
  const pickSort = (id: AdvState["sort"]) => {
    track("filter_applied", { filter_type: "sort", filter_value: id });
    setAdv((a) => ({ ...a, sort: id }));
    setSortOpen(false);
  };

  // Pills removibles de filtros activos (v2): precio, colores, oferta, r4.
  const pills: { label: string; remove: () => void }[] = [];
  if (adv.price) pills.push({ label: PRICE_LABELS[adv.price], remove: () => setAdv((a) => ({ ...a, price: null })) });
  for (const cn of adv.colors) pills.push({ label: cn, remove: () => setAdv((a) => ({ ...a, colors: a.colors.filter((x) => x !== cn) })) });
  if (adv.oferta) pills.push({ label: "En oferta", remove: () => setAdv((a) => ({ ...a, oferta: false })) });
  if (adv.r4) pills.push({ label: "★ 4.6+", remove: () => setAdv((a) => ({ ...a, r4: false })) });

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

      {/* pasillos como chips (v2) */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 18 }}>
        {SIDE_CATS.map((c) => {
          const on = c.id === activeCat;
          return (
            <div
              key={c.id}
              onClick={() => pickCat(c.id)}
              className="tk-hov-bd-dark"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, background: on ? c.tint : "#fff", border: "1px solid #ECECE7", fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer" }}
            >
              <div style={{ width: 9, height: 9, borderRadius: 3, background: c.deep }} />
              {c.label}
            </div>
          );
        })}
      </div>

      {/* barra de filtros (v2: reemplaza el sidebar) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingBottom: 12, borderBottom: "1px solid #EFEFEA" }}>
        <div
          onClick={() => setDrawerOpen(true)}
          style={{ flex: "none", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 999, border: `1.5px solid ${nAdv ? "#1C1D20" : "#D8D8D3"}`, background: nAdv ? "#1C1D20" : "#fff", color: nAdv ? "#fff" : "#3A3B40", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20">
            <line x1="3" y1="6" x2="17" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="3" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="8" cy="6" r="2.4" fill={nAdv ? "#1C1D20" : "#fff"} stroke="currentColor" strokeWidth="1.8" />
            <circle cx="12.5" cy="14" r="2.4" fill={nAdv ? "#1C1D20" : "#fff"} stroke="currentColor" strokeWidth="1.8" />
          </svg>
          {nAdv ? `Más filtros · ${nAdv}` : "Más filtros"}
        </div>
        {QUICK.map(([k, lbl]) => {
          const on = adv[k];
          return (
            <div
              key={k}
              onClick={() => toggleQuick(k)}
              style={{ flex: "none", whiteSpace: "nowrap", padding: "9px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? "#1C1D20" : "#ECECE7"}`, background: on ? "#1C1D20" : "#fff", color: on ? "#fff" : "#3A3B40" }}
            >
              {lbl}
            </div>
          );
        })}
        <div style={{ flex: "none", marginLeft: "auto", position: "relative" }}>
          <div
            onClick={() => setSortOpen((v) => !v)}
            className="tk-hov-bd-dark"
            style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 999, border: "1px solid #ECECE7", background: "#fff", fontSize: 12.5, color: "#3A3B40", cursor: "pointer" }}
          >
            Ordenar: <b>{SORT_LABELS[adv.sort]}</b> <span style={{ fontSize: 9 }}>▾</span>
          </div>
          {sortOpen && (
            <div style={{ position: "absolute", top: 44, right: 0, width: 205, background: "#fff", border: "1px solid #EFEFEA", borderRadius: 14, boxShadow: "0 14px 34px rgba(28,29,32,.13)", padding: 6, zIndex: 40, animation: "dropIn .2s ease both" }}>
              {(Object.keys(SORT_LABELS) as AdvState["sort"][]).map((id) => (
                <div
                  key={id}
                  onClick={() => pickSort(id)}
                  className="tk-hov-bg"
                  style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 11px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", fontWeight: adv.sort === id ? 700 : 500 }}
                >
                  {SORT_LABELS[id]}
                  <span>{adv.sort === id ? "✓" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* pills de filtros activos (v2) */}
      {pills.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11, alignItems: "center" }}>
          {pills.map((p) => (
            <div key={p.label} onClick={p.remove} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, background: "#E9F1FB", color: "#4C6E96", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {p.label} <span style={{ fontSize: 10 }}>✕</span>
            </div>
          ))}
          <div onClick={() => setAdv(EMPTY_ADV)} style={{ padding: "7px 4px", fontSize: 12, color: "#8E8F94", textDecoration: "underline", cursor: "pointer" }}>
            limpiar todo
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {overlay ?? (
          <>
            {notice}
            <div style={{ fontSize: 13, color: "#8E8F94", marginBottom: 14 }}>{shown.length} productos · ordenado para ti</div>
            {shown.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                {shown.map(({ card }) => (
                  <ProductCard key={card.id} card={card} source={source} variant="grid" />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 24, color: "#55565B" }}>nada por aquí…</div>
                <div style={{ fontSize: 14, color: "#8E8F94", marginTop: 8 }}>
                  {nAdv > 0 ? "prueba quitando filtros o busca otra cosa" : "prueba con otras palabras — o pega el link del producto"}
                </div>
                {nAdv > 0 && (
                  <div
                    onClick={() => setAdv(EMPTY_ADV)}
                    style={{ display: "inline-flex", marginTop: 16, padding: "12px 22px", borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Limpiar filtros
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {drawerOpen && <FiltersDrawer adv={adv} setAdv={setAdv} count={shown.length} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
