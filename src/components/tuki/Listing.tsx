"use client";
// src/components/tuki/Listing.tsx — grilla + BARRA de filtros (diseño v2: muere
// el sidebar; pasillos como chips, quick pills, dropdown de orden y pills
// removibles de filtros activos). Usado por búsqueda (T6) y categoría (T7).
// Todo el filtrado es client-side sobre FilterableCard[].
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import type { StorefrontCard, StorefrontSection } from "@/storefront/contract";
import { attrsOf, CATS, FILTER_COLORS } from "./lib";
import { ProductCard, type CardSource } from "./ProductCard";
import { advCount, applyFilters, EMPTY_ADV, facetOptions, STORE_LABELS, PRICE_LABELS, SORT_LABELS, type AdvState, type FilterableCard } from "./filters";
import { deliveryDates } from "@/lib/delivery";

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

const nLabel = (base: string, n: number) => (n ? `${base} · ${n}` : base);
const etaDate = (maxDays: number) => deliveryDates({ minDays: maxDays, maxDays, via: "aereo" }).to;
const hexOf = (label: string) => FILTER_COLORS.find((c) => c.name.toLowerCase() === label.toLowerCase())?.hex;

function FacetBtn({ label, active, open, toggle, onClick }: { label: string; active: boolean; open?: boolean; toggle?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ flex: "none", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${active || open ? "#1C1D20" : "#E3E3DE"}`, background: active ? "#1C1D20" : "#fff", color: active ? "#fff" : "#3A3B40", transition: "all .15s" }}
    >
      {label}
      {!toggle && <span style={{ fontSize: 9, transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}>▾</span>}
    </div>
  );
}

function OptChip({ label, count, on, swatch, onClick }: { label: string; count?: number; on: boolean; swatch?: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 12, fontSize: 13, cursor: "pointer", border: `1.5px solid ${on ? "#1C1D20" : "#ECECE7"}`, background: on ? "#F4F4F1" : "#fff", fontWeight: on ? 700 : 500 }}
    >
      {swatch && <span style={{ width: 14, height: 14, borderRadius: "50%", background: swatch, border: "1px solid rgba(0,0,0,.12)" }} />}
      {label}
      {count !== undefined && <span style={{ fontSize: 11.5, color: "#8E8F94", fontWeight: 500 }}>{count}</span>}
      {on && <span style={{ fontSize: 11 }}>✓</span>}
    </div>
  );
}

// Destacados (anuncios propios + agente) dentro de la grilla: primero 2 filas
// de resultados, luego uno cada 3 filas. ponytail: 4 columnas fijas, como la grilla.
const FEATURED_FIRST = 8;
const FEATURED_EVERY = 12;
/** cuántas secciones caben intercaladas en n resultados */
const featuredInline = (n: number) => (n < FEATURED_FIRST ? 0 : Math.floor((n - FEATURED_FIRST) / FEATURED_EVERY) + 1);

function FeaturedRow({ sec, source }: { sec: StorefrontSection; source: CardSource }) {
  return (
    <div data-testid="tuki-listing-featured" style={{ gridColumn: "1 / -1", background: "#EFEFF7", borderRadius: 22, padding: "18px 20px 14px", margin: "6px 0" }}>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, color: "#77787D" }}>destacado</div>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px", margin: "2px 0 12px" }}>{sec.title}</div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 4 }}>
        {sec.items.map((card) => (
          <ProductCard key={card.id} card={card} source={source} variant="aisle" />
        ))}
      </div>
    </div>
  );
}

export function Listing({
  cards,
  source,
  header,
  activeCat,
  initialAdv,
  featured = [],
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
  /** Secciones DESTACADAS del listado (superficie 'search' del slate — seed +
   * placements del agente). Se pintan entre la barra de filtros y la grilla. */
  featured?: StorefrontSection[];
  overlay?: React.ReactNode; // reemplaza la grilla (loader de búsqueda en loading)
  notice?: React.ReactNode; // pill sobre la grilla (badge de caché)
}) {
  const router = useRouter();
  const [adv, setAdv] = useState<AdvState>(() => ({ ...EMPTY_ADV, ...initialAdv }));
  const [openFacet, setOpenFacet] = useState<"sort" | "price" | "stores" | "colors" | "sizes" | "eta" | null>(null);
  const toggleFacet = (f: NonNullable<typeof openFacet>) => setOpenFacet((cur) => (cur === f ? null : f));

  const filterable: FilterableCard[] = useMemo(
    () => cards.map((c) => ({ card: c, attrs: attrsOf(c) })),
    [cards],
  );
  const shown = useMemo(() => applyFilters(filterable, adv), [filterable, adv]);
  const facets = useMemo(() => facetOptions(filterable, adv), [filterable, adv]);
  const nAdv = advCount(adv);
  const liveFeatured = overlay ? [] : featured.filter((sec) => sec.items.length > 0);

  // categorías: el orden base es "más barato primero" (decisión T2c en
  // category-page.ts) — llamarlo "Para ti" era mentira.
  const sortLabel = (id: AdvState["sort"]) => (id === "rel" && source === "category" ? "Más baratos primero" : SORT_LABELS[id]);
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
    setOpenFacet(null);
  };
  const toggleIn = (k: "stores" | "colors" | "sizes", v: string) => {
    track("filter_applied", { filter_type: k, filter_value: v });
    setAdv((a) => ({ ...a, [k]: a[k].includes(v) ? a[k].filter((x) => x !== v) : [...a[k], v] }));
  };
  const setOne = <K extends "price" | "etaMax">(k: K, v: AdvState[K]) => {
    track("filter_applied", { filter_type: k, filter_value: String(v) });
    setAdv((a) => ({ ...a, [k]: v }));
  };

  // Pills removibles de filtros activos (v2): precio, colores, oferta, r4.
  const pills: { label: string; remove: () => void }[] = [];
  if (adv.price) pills.push({ label: PRICE_LABELS[adv.price], remove: () => setAdv((a) => ({ ...a, price: null })) });
  for (const cn of adv.colors) pills.push({ label: cn, remove: () => setAdv((a) => ({ ...a, colors: a.colors.filter((x) => x !== cn) })) });
  if (adv.oferta) pills.push({ label: "En oferta", remove: () => setAdv((a) => ({ ...a, oferta: false })) });
  if (adv.r4) pills.push({ label: "★ 4.6+", remove: () => setAdv((a) => ({ ...a, r4: false })) });
  for (const st of adv.stores) pills.push({ label: STORE_LABELS[st] ?? st, remove: () => toggleIn("stores", st) });
  for (const sz of adv.sizes) pills.push({ label: `Talla ${sz}`, remove: () => toggleIn("sizes", sz) });
  if (adv.etaMax !== null) pills.push({ label: `Llega antes del ${etaDate(adv.etaMax)}`, remove: () => setOne("etaMax", null) });

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

      {/* barra de facetas (v3): un solo lugar para filtrar y ordenar. Cada menú
          abre un panel ANCHO bajo la barra (no se corta en teléfono) con las
          opciones REALES del listado y su cantidad — nada que lleve a 0. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
        <FacetBtn label={`Ordenar: ${sortLabel(adv.sort)}`} active={false} open={openFacet === "sort"} onClick={() => toggleFacet("sort")} />
        {(facets.price.length > 0 || !!adv.price) && <FacetBtn label={adv.price ? PRICE_LABELS[adv.price] : "Precio"} active={!!adv.price} open={openFacet === "price"} onClick={() => toggleFacet("price")} />}
        {(facets.stores.length > 1 || adv.stores.length > 0) && <FacetBtn label={nLabel("Tienda", adv.stores.length)} active={adv.stores.length > 0} open={openFacet === "stores"} onClick={() => toggleFacet("stores")} />}
        {facets.colors.length > 0 && <FacetBtn label={nLabel("Color", adv.colors.length)} active={adv.colors.length > 0} open={openFacet === "colors"} onClick={() => toggleFacet("colors")} />}
        {facets.sizes.length > 0 && <FacetBtn label={nLabel("Talla", adv.sizes.length)} active={adv.sizes.length > 0} open={openFacet === "sizes"} onClick={() => toggleFacet("sizes")} />}
        {(facets.eta.length > 1 || adv.etaMax !== null) && (
          <FacetBtn label={adv.etaMax !== null ? `Llega antes del ${etaDate(adv.etaMax)}` : "Llega antes de"} active={adv.etaMax !== null} open={openFacet === "eta"} onClick={() => toggleFacet("eta")} />
        )}
        {QUICK.map(([k, lbl]) => (
          <FacetBtn key={k} label={lbl} active={adv[k]} toggle onClick={() => toggleQuick(k)} />
        ))}
      </div>

      {openFacet && (
        <div style={{ marginTop: 8, background: "#fff", border: "1px solid #EFEFEA", borderRadius: 16, padding: "14px 16px", boxShadow: "0 12px 30px rgba(28,29,32,.08)", animation: "dropIn .18s ease both" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {openFacet === "sort" &&
              (Object.keys(SORT_LABELS) as AdvState["sort"][]).map((id) => (
                <OptChip key={id} label={sortLabel(id)} on={adv.sort === id} onClick={() => pickSort(id)} />
              ))}
            {openFacet === "price" &&
              facets.price.map((o) => (
                <OptChip key={o.value} label={o.label} count={o.count} on={adv.price === o.value} onClick={() => setOne("price", adv.price === o.value ? null : o.value)} />
              ))}
            {openFacet === "stores" &&
              facets.stores.map((o) => <OptChip key={o.value} label={o.label} count={o.count} on={adv.stores.includes(o.value)} onClick={() => toggleIn("stores", o.value)} />)}
            {openFacet === "colors" &&
              facets.colors.map((o) => (
                <OptChip key={o.value} label={o.label} count={o.count} swatch={hexOf(o.value)} on={adv.colors.includes(o.value)} onClick={() => toggleIn("colors", o.value)} />
              ))}
            {openFacet === "sizes" &&
              facets.sizes.map((o) => <OptChip key={o.value} label={o.label} count={o.count} on={adv.sizes.includes(o.value)} onClick={() => toggleIn("sizes", o.value)} />)}
            {openFacet === "eta" &&
              facets.eta.map((o) => (
                <OptChip key={o.value} label={`antes del ${etaDate(o.value)}`} count={o.count} on={adv.etaMax === o.value} onClick={() => setOne("etaMax", adv.etaMax === o.value ? null : o.value)} />
              ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span style={{ fontSize: 12, color: "#8E8F94" }}>{shown.length} productos con lo elegido</span>
            <span onClick={() => setOpenFacet(null)} style={{ fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>listo ✓</span>
          </div>
        </div>
      )}

      {/* pills de filtros activos */}
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
            <div style={{ fontSize: 13, color: "#8E8F94", marginBottom: 14 }}>{shown.length} productos · {adv.sort === "rel" && source === "category" ? "los más baratos primero" : "ordenado para ti"}</div>
            {shown.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                {shown.map(({ card }, i) => {
                  // destacados/anuncios INTERCALADOS: los resultados van
                  // primero; la sección k entra tras FIRST + k·EVERY productos.
                  const k = i + 1 - FEATURED_FIRST;
                  const sec = k >= 0 && k % FEATURED_EVERY === 0 ? liveFeatured[k / FEATURED_EVERY] : undefined;
                  return (
                    <Fragment key={card.id}>
                      <ProductCard card={card} source={source} variant="grid" eager={i < 8} />
                      {sec && <FeaturedRow sec={sec} source={source} />}
                    </Fragment>
                  );
                })}
              </div>
            ) : null}
            {shown.length === 0 && (
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
            {/* pocos resultados: los destacados que no alcanzaron a intercalarse van al final */}
            {liveFeatured.slice(featuredInline(shown.length)).map((sec) => (
              <FeaturedRow key={sec.placement_id} sec={sec} source={source} />
            ))}
          </>
        )}
      </div>

    </div>
  );
}
