"use client";
// src/components/tuki/ProductView.tsx — PDP Tuki (dc.html 437–541): galería, variantes
// demo, qty, acordeones (descripción real + specs/envío/opiniones fijas), add al carro,
// rieles de recomendación reales (similar/cross_sell/upsell del slate). Data
// serializable llega de la page server; el peso estimado se pide en background
// tras el primer paint (skeleton mientras — nunca bloquea el render).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import type { StorefrontCard, StorefrontSection } from "@/storefront/contract";
import { estimateDelivery, deliveryDates, deliveryPhrase, type ProviderShipDays } from "@/lib/delivery";
import { gramsToLb } from "@/lib/weight";
import { attrsOf, catOf, fmt, hasPriceRange, imageForColor, matchVariant, minPriceCents, ratingLine, resolveColorHex, stripe } from "./lib";
import { ProductCard, type CardSource } from "./ProductCard";
import { useTukiCart } from "./cart";

type CardAttrs = NonNullable<StorefrontCard["attrs"]>;

// Sin reseñas reales en el catálogo aún — antes había 2 testimonios fijos falsos
// (dc.html 1289) puestos en TODOS los productos; se quitaron por deshonestos.
const DESC_ROWS = ["Devolución gratis hasta 30 días", "Garantía tuki de 12 meses"];

// Subtítulo editorial por tipo de riel (los títulos vienen de ui_sections).
const RAIL_SUBTITLES: Record<string, string> = {
  similar: "elegidos por parecido real a este producto",
  cross_sell: "quienes lo llevaron, sumaron esto",
  upsell: "misma categoría, un escalón arriba",
};

interface WeightInfo {
  grams: number;
  source: "measured" | "provider" | "llm" | "heuristic";
  estimated: boolean;
}

export function ProductView({
  card,
  description,
  rails,
  source,
  providerShipDays = null,
}: {
  card: StorefrontCard;
  description: string;
  rails: StorefrontSection[];
  source: CardSource;
  providerShipDays?: ProviderShipDays | null;
}) {
  const router = useRouter();
  const { add } = useTukiCart();

  // Attrs "vivos": arrancan con lo que trajo el server (card.attrs) y se
  // repintan si la hidratación bajo demanda (efecto de abajo) trae
  // colores/tallas/variantes frescos (primera visita, T-attrs). Reset SOLO al
  // navegar a otro producto (patrón React: ajustar estado durante el render
  // en vez de un useEffect que dispara setState — evita el render extra).
  const [liveAttrs, setLiveAttrs] = useState(card.attrs);
  const [liveAttrsId, setLiveAttrsId] = useState(card.id);
  // REGLA DE ORO: el precio jamás cambia solo delante del comprador — arranca
  // SIN selección (null), tanto al cargar como al navegar a otro producto
  // (antes se auto-elegía la primera opción y el precio grande saltaba solo).
  const [selColor, setSelColor] = useState<string | null>(null);
  const [selSize, setSelSize] = useState<string | null>(null);
  // Skeleton "buscando tallas y colores…" mientras la hidratación bajo demanda
  // (efecto de abajo) corre en la primera visita — desaparece al llegar attrs
  // o al fallar (fail-open silencioso, ver el .finally de ese efecto).
  const [hydrating, setHydrating] = useState(!card.attrs?.hydrated_at);
  // Peso estimado: se pide en background tras el paint (skeleton mientras).
  // null = cargando. El valor MOSTRADO acá es el MISMO que viaja al carrito
  // en el snapshot del add (cobro = lo mostrado).
  const [weight, setWeight] = useState<WeightInfo | null>(null);
  if (card.id !== liveAttrsId) {
    setLiveAttrsId(card.id);
    setLiveAttrs(card.attrs);
    setSelColor(null);
    setSelSize(null);
    setHydrating(!card.attrs?.hydrated_at);
    setWeight(null);
  }

  const da = attrsOf({ ...card, attrs: liveAttrs });
  const cat = catOf(card.category);
  const thumbs = liveAttrs?.images && liveAttrs.images.length > 1 ? liveAttrs.images.slice(0, 4) : null;
  const oldC = da.oldPriceCents;
  const offPct = oldC != null ? "−" + Math.round((1 - card.price_cents / oldC) * 100) + "%" : "";
  const rl = ratingLine(da.rating, da.sold);

  const [qty, setQty] = useState(1);
  const [acc, setAcc] = useState<string>("desc");

  const variants = liveAttrs?.variants;
  // Variante que matchea color+talla elegidos: precio/foto/disponibilidad de
  // ESA combinación exacta si el proveedor la trajo; sin match -> base de arriba.
  const variant = matchVariant(variants, selColor, selSize);
  // Dimensiones que el producto TIENE y el comprador aún no eligió. Mientras
  // falte alguna Y el precio pueda saltar entre variantes (hasPriceRange):
  // precio grande "desde $X" + botón deshabilitado — nunca un precio exacto
  // que el usuario no causó con su propia selección (REGLA DE ORO). Sin rango
  // de precio (o sin variantes) el producto se comporta como siempre.
  const needsColor = da.colors.length > 0 && selColor === null;
  const needsSize = da.sizes.length > 0 && selSize === null;
  const priceIsGated = hasPriceRange(card.price_cents, variants) && (needsColor || needsSize);
  const effectivePriceCents = priceIsGated ? minPriceCents(card.price_cents, variants) : (variant?.price_cents ?? card.price_cents);
  // imageForColor: alcanza con el color (matchVariant exige TODAS las
  // dimensiones, así que con talla aún sin elegir nunca matcheaba y la foto
  // del color jamás cambiaba pese al clic).
  const mainImage = variant?.image ?? imageForColor(variants, selColor) ?? card.image_url;
  const isSoldOut = !priceIsGated && variant?.available === false;

  // Tallas imposibles para el color elegido (p.ej. "M" no existe en "Rojo"):
  // solo se calcula cuando TODAS las variantes traen color+talla juntas (ya
  // está todo en memoria, barato) — si el catálogo mezcla variantes
  // parciales (algunas sin color, otras sin talla) no se puede inferir con
  // certeza qué combo falta, así que no se restringe nada (ponytail: caso
  // raro con datos incompletos del proveedor, sin reportar).
  const sizesLockedToColor =
    !!selColor && !!variants?.length && variants.every((v) => v.color !== undefined && v.size !== undefined);
  const possibleSizesRaw = sizesLockedToColor
    ? new Set(variants!.filter((v) => v.color === selColor).map((v) => v.size).filter((s): s is string => !!s))
    : null;
  // set vacío = datos incompletos para ese color -> no restringir (evita
  // bloquear TODAS las tallas por un hueco en la data del proveedor).
  const possibleSizes = possibleSizesRaw && possibleSizesRaw.size > 0 ? possibleSizesRaw : null;

  // product_view UNA vez por producto: ref por id dedupe el doble-mount de
  // StrictMode (mismo id → skip) y re-dispara al navegar a otra PDP (id cambia).
  const trackedId = useRef<string | null>(null);
  useEffect(() => {
    if (trackedId.current === card.id) return;
    trackedId.current = card.id;
    // urgent: la vista debe llegar ANTES de que el usuario vuelva a la home
    // (el batch de 3s perdía la carrera en navegación SPA y el feed nunca se
    // enteraba de lo que miraste).
    track("product_view", { product_id: card.id, source }, { urgent: true });
  }, [card.id, source]);

  // Peso en background: nunca bloquea el render de la PDP (skeleton mientras).
  useEffect(() => {
    const thisId = card.id;
    const ctrl = new AbortController();
    fetch(`/api/products/${thisId}/weight`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<WeightInfo>) : null))
      .then((w) => {
        if (w && typeof w.grams === "number") setWeight(w);
      })
      .catch(() => {}); // sin peso: la fila queda en skeleton, sin inventar
    return () => ctrl.abort();
  }, [card.id]);

  // Hidratación de detalle bajo demanda: dispara UNA vez por producto real
  // (source amazon/aliexpress/walmart/shein) que aún no tiene attrs.hydrated_at.
  // Gate cliente = puro ahorro de request; el gate atómico real vive en el
  // UPDATE...WHERE...IS NULL del servidor (ver route.ts).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (card.attrs?.hydrated_at || hydratedFor.current === card.id) return;
    hydratedFor.current = card.id;
    const thisId = card.id;
    const ctrl = new AbortController();
    fetch(`/api/products/${card.id}/hydrate`, { method: "POST", signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ attrs?: Partial<CardAttrs> }>) : null))
      .then((body) => {
        if (!body?.attrs) return; // sin variantes nuevas / hidratación skip: fail-open silencioso
        const fresh = body.attrs;
        setLiveAttrs((prev) => ({
          ...prev,
          ...(fresh.colors && { colors: fresh.colors }),
          ...(fresh.sizes && { sizes: fresh.sizes }),
          ...(fresh.images && { images: fresh.images }),
          ...(fresh.variants && { variants: fresh.variants }),
          ...(fresh.hydrated_at && { hydrated_at: fresh.hydrated_at }),
        }));
        // NUNCA auto-seleccionar acá: el precio grande saltaría solo en cuanto
        // llegan los attrs frescos (justo el bug reportado). El comprador
        // elige, o ve "desde $X" hasta que lo haga.
      })
      .catch(() => {})
      .finally(() => {
        // Guard de carrera: si ya se navegó a otro producto, ese efecto nuevo
        // ya tomó hydratedFor.current — no apagar SU skeleton desde acá.
        if (hydratedFor.current === thisId) setHydrating(false);
      });
    return () => ctrl.abort();
  }, [card.id, card.attrs?.hydrated_at]);

  const onAdd = () => {
    if (isSoldOut || priceIsGated) return;
    add(
      {
        id: card.id,
        title: card.title,
        price_cents: effectivePriceCents,
        category: card.category ?? null,
        image_url: card.image_url,
        source: card.source,
        // el MISMO peso que el comprador vio en la fila de peso (o el de DB si
        // la fila aún cargaba) — el carrito/checkout facturan sobre este número
        weight_grams: weight?.grams ?? card.weight_grams ?? null,
      },
      qty,
      selColor,
      selSize,
    );
  };

  // Entrega honesta por tienda y vía (antes: "24–48 h" hard-coded, falso para
  // reenvío a Cuba). Presentación en FECHAS concretas (decisión del dueño) y,
  // si el proveedor reportó sus días de envío, el rango se acorta con el dato
  // real del producto.
  const air = estimateDelivery(card.source, "aereo", providerShipDays);
  const sea = estimateDelivery(card.source, "maritimo", providerShipDays);
  const airDates = deliveryDates(air);

  const specs = [
    { k: "Categoría", v: cat.label },
    ...(rl ? [{ k: "Valoración", v: rl }] : []),
    { k: "Entrega estimada", v: `${airDates.from} – ${airDates.to} (aéreo)` },
    ...(weight ? [{ k: weight.estimated ? "Peso estimado" : "Peso", v: `${gramsToLb(weight.grams)} lb (${weight.grams} g)` }] : []),
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
          Vía aérea: llega {deliveryPhrase(air)}. Vía marítima: {deliveryPhrase(sea)} (más económica, ideal para
          pedidos pesados). Fechas estimadas según la tienda de origen ({card.source}); el envío se factura por
          peso. Devolución sin costo dentro de 30 días: la recogemos en tu puerta.
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
          <div style={{ position: "relative", aspectRatio: "3 / 4", maxHeight: 620, borderRadius: 26, background: stripe(cat), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {mainImage ? (
              // LCP de la PDP: prioridad alta, nunca lazy
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mainImage} alt={card.title} fetchPriority="high" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
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
                  loading="lazy"
                  decoding="async"
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
            {rl ? `${rl} · llega ${deliveryPhrase(air)}` : `llega ${deliveryPhrase(air)}`}
            {card.source && ` · de ${card.source}`}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.7px" }}>
              {priceIsGated ? `desde ${fmt(effectivePriceCents)}` : fmt(effectivePriceCents)}
            </span>
            {!priceIsGated && oldC != null && (
              <>
                <span style={{ fontSize: 16, color: "#B0B1AE", textDecoration: "line-through" }}>{fmt(oldC)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: cat.deep, background: cat.tint, borderRadius: 999, padding: "4px 10px" }}>ahorras {fmt(oldC - card.price_cents)}</span>
              </>
            )}
          </div>
          {hydrating && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div style={{ width: 108, height: 11, borderRadius: 6, background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)", backgroundSize: "460px 100%", animation: "shimmer 1.1s linear infinite" }} />
              <span style={{ fontSize: 12, color: "#8E8F94" }}>· buscando tallas y colores…</span>
            </div>
          )}
          {/* Peso: calculado en background — skeleton hasta que llega, jamás bloquea. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            {weight ? (
              <span style={{ fontSize: 12.5, color: "#8E8F94" }}>
                ⚖ {weight.estimated ? "peso estimado" : "peso"}: <b style={{ color: "#55565B" }}>{gramsToLb(weight.grams)} lb</b> ({weight.grams} g)
                {weight.source === "measured" && " · pesado en báscula"}
              </span>
            ) : (
              <>
                <div style={{ width: 88, height: 11, borderRadius: 6, background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)", backgroundSize: "460px 100%", animation: "shimmer 1.1s linear infinite" }} />
                <span style={{ fontSize: 12, color: "#8E8F94" }}>· calculando peso…</span>
              </>
            )}
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 16, color: cat.deep, marginTop: 12 }}>✦ encaja con lo que has estado mirando</div>

          {da.colors.length > 0 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 20 }}>
                Color{selColor && (
                  <>
                    {" "}· <span style={{ color: "#8E8F94", fontWeight: 500 }}>{selColor}</span>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {da.colors.map((cv, i) => {
                  const on = selColor === cv.name;
                  // Orden de preferencia (T4): 1) foto real de esa variante de
                  // color, 2) hex (del proveedor o de nuestro mapa nombre→hex),
                  // 3) sin ninguno -> chip de texto (nunca un círculo gris mintiendo).
                  const photo = imageForColor(variants, cv.name);
                  const hex = cv.hex ?? resolveColorHex(cv.name);
                  if (!photo && !hex) {
                    return (
                      <div
                        key={i}
                        onClick={() => setSelColor(cv.name)}
                        style={{ height: 36, padding: "0 14px", boxSizing: "border-box", borderRadius: 12, display: "flex", alignItems: "center", fontSize: 13.5, fontWeight: 600, cursor: "pointer", background: on ? "#1C1D20" : "#fff", color: on ? "#fff" : "#55565B", border: `1.5px solid ${on ? "#1C1D20" : "#ECECE7"}` }}
                      >
                        {cv.name}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      onClick={() => setSelColor(cv.name)}
                      title={cv.name}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        cursor: "pointer",
                        border: `2px solid ${on ? "#1C1D20" : "rgba(0,0,0,.08)"}`,
                        boxShadow: "inset 0 0 0 3px #FAFAF8",
                        ...(photo
                          ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }
                          : { background: hex }),
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}

          {da.sizes.length > 0 && (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 18 }}>Talla</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {da.sizes.map((sz) => {
                  const on = selSize === sz;
                  const disabled = possibleSizes ? !possibleSizes.has(sz) : false;
                  return (
                    <div
                      key={sz}
                      onClick={() => { if (!disabled) setSelSize(sz); }}
                      style={{ minWidth: 46, height: 42, padding: "0 13px", boxSizing: "border-box", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, cursor: disabled ? "default" : "pointer", background: on ? "#1C1D20" : "#fff", color: on ? "#fff" : disabled ? "#C7C8CB" : "#55565B", border: `1.5px solid ${on ? "#1C1D20" : "#ECECE7"}`, opacity: disabled ? 0.55 : 1 }}
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
              style={{ flex: 1, maxWidth: 340, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: 999, background: isSoldOut || priceIsGated ? "#D8D8D3" : "#1C1D20", color: isSoldOut || priceIsGated ? "#8E8F94" : "#fff", fontSize: 15.5, fontWeight: 700, cursor: isSoldOut || priceIsGated ? "default" : "pointer" }}
            >
              {isSoldOut
                ? "agotado en esta combinación"
                : priceIsGated
                  ? `elige ${needsColor ? "color" : "talla"}`
                  : `Agregar · ${fmt(effectivePriceCents * qty)}`}
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

      {rails.map(
        (rail) =>
          rail.items.length > 0 && (
            <div key={rail.placement_id}>
              <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700, margin: "44px 0 4px" }}>{rail.title}</div>
              {RAIL_SUBTITLES[rail.section_type] && (
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14.5, color: "#8E8F94", marginBottom: 16 }}>
                  {RAIL_SUBTITLES[rail.section_type]}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
                {rail.items.slice(0, 4).map((c) => (
                  <ProductCard key={c.id} card={c} source="direct" variant="grid" />
                ))}
              </div>
            </div>
          ),
      )}
    </div>
  );
}
