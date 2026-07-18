"use client";
// src/components/tuki/CartDrawer.tsx — drawer de carrito Tuki (dc.html 738–820) + upsell
// real (cart_addons de /api/slate/resolve). Downsell del diseño OMITIDO: no hay señal
// backend equivalente (YAGNI, ver plan T9).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCard, StorefrontSection } from "@/storefront/contract";
import { hasMultipleStores } from "@/lib/delivery";
import { shipQuote } from "@/lib/shipping";
import { catOf, fmt, stripe } from "./lib";
import { useTukiCart } from "./cart";
import type { TukiCartItem } from "./cart-core";

function itemVars(item: TukiCartItem) {
  const varLine = [item.color, item.size].filter(Boolean).join(" · ");
  return {
    nameVar: item.title + (varLine ? ` (${varLine})` : ""),
    // T3: tienda al final, discreta — "$4.99 c/u · aliexpress".
    meta: (varLine ? varLine + " · " : "") + fmt(item.price_cents) + " c/u" + (item.source ? " · " + item.source : ""),
  };
}

// Mini-card compartida entre el riel del carro y la pantalla previa al pago.
function UpsellMini({ p, onOpen, onAdd, wide }: { p: StorefrontCard; onOpen: () => void; onAdd: () => void; wide?: boolean }) {
  return (
    <div onClick={onOpen} style={{ flex: "none", width: wide ? "auto" : 120, background: "#fff", borderRadius: 14, border: "1px solid #EFEFEA", padding: "7px 7px 9px", cursor: "pointer" }}>
      <div style={{ height: wide ? 110 : 66, borderRadius: 10, background: stripe(catOf(p.category)), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {p.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt={p.title} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 7.5, color: "#9a9b98" }}>foto</span>
        )}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, margin: "6px 3px 0", lineHeight: 1.25, height: 28, overflow: "hidden" }}>{p.title}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "3px 3px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(p.price_cents)}</span>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="tk-hov-plus"
          style={{ width: 24, height: 24, borderRadius: "50%", background: "#1C1D20", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer" }}
        >
          +
        </div>
      </div>
    </div>
  );
}

export function CartDrawer() {
  const router = useRouter();
  const { items, count, subtotal, weightLb, open, setOpen, inc, dec, remove, add } = useTukiCart();
  const [upsell, setUpsell] = useState<StorefrontCard[]>([]);
  // Pantalla previa al pago (cross-sell discreto): se muestra UNA vez al tocar
  // "Ir a pagar" si hay recomendados; saltable con un toque. Se resetea al
  // abrir/cerrar el drawer.
  const [preCheckout, setPreCheckout] = useState(false);
  useEffect(() => {
    setPreCheckout(false);
  }, [open]);

  // Escape + scroll-lock del body mientras el drawer está abierto; se restauran al cerrar.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  // Upsell real: refetch al abrir y al cambiar el set de productos, debounce 300ms.
  // Carrito vacío ⇒ no llama (la regla del backend exige cart_item_count>=1).
  // AbortController cubre debounce (timeout aún no disparado) y respuesta stale
  // (fetch en vuelo cuando los ids vuelven a cambiar o el drawer se cierra).
  const ids = items.map((i) => i.product_id).join(",");
  useEffect(() => {
    // ponytail: no reseteamos `upsell` aquí — con carrito vacío o drawer cerrado
    // la sección de upsell no se renderiza (cartHas=false), así que un valor
    // stale no se ve; se refresca solo cuando vuelve a haber items.
    if (!open || items.length === 0) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/slate/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ surface: "cart", surface_args: { cart_product_ids: ids.split(",") } }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { sections: StorefrontSection[] };
        setUpsell(body.sections[0]?.items ?? []);
      } catch {
        /* abortado o de red: el upsell se queda invisible, el drawer sigue andando */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids]);

  if (!open) return null;

  const cartHas = items.length > 0;
  // Estimado honesto por libra — misma aritmética que el checkout (lib/shipping)
  const quote = shipQuote(weightLb, "aereo");
  const ship = cartHas && quote ? quote.ship_cents : 0;
  const totF = fmt(subtotal + ship);
  const shipF = fmt(ship);
  const upsellLine = "y esto le encanta a gente como tú…";
  const cartIds = new Set(items.map((i) => i.product_id));
  const upsellShown = upsell.filter((p) => !cartIds.has(p.id));

  const close = () => setOpen(false);

  return (
    <>
      <div
        onClick={close}
        style={{ position: "fixed", inset: 0, background: "rgba(28,29,32,.4)", zIndex: 80, animation: "fadeIn .25s ease both" }}
      />
      <div
        data-testid="tuki-cart-drawer"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 430,
          maxWidth: "92vw",
          background: "#FAFAF8",
          zIndex: 81,
          boxShadow: "-20px 0 60px rgba(28,29,32,.2)",
          animation: "drawerIn .35s cubic-bezier(.2,.8,.2,1) both",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "20px 22px", borderBottom: "1px solid #EFEFEA" }}>
          <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700 }}>Tu carro</div>
          {cartHas && (
            <div style={{ background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
              {count}
            </div>
          )}
          <div
            onClick={close}
            className="tk-hov-bd-dark"
            style={{ marginLeft: "auto", width: 38, height: 38, borderRadius: "50%", background: "#fff", border: "1px solid #ECECE7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#55565B" }}
          >
            ✕
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 20px" }}>
          {!cartHas ? (
            <div style={{ textAlign: "center", padding: "60px 10px" }}>
              <div style={{ width: 70, height: 70, borderRadius: "50%", background: "#F1F1EE", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                <svg width="28" height="28" viewBox="0 0 20 20">
                  <rect x="3" y="6.5" width="14" height="10.5" rx="3" fill="none" stroke="#8E8F94" strokeWidth="1.6" />
                  <path d="M7 6.5 a3 3 0 0 1 6 0" fill="none" stroke="#8E8F94" strokeWidth="1.6" />
                </svg>
              </div>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, color: "#55565B", marginTop: 16 }}>
                tu carro está vacío…
                <br />
                de momento
              </div>
              <div
                onClick={close}
                className="tk-hov-cta"
                style={{ display: "inline-flex", marginTop: 16, background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "12px 22px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                Explorar el feed →
              </div>
            </div>
          ) : preCheckout ? (
            /* Pantalla previa al pago: cross-sell discreto, UNA vez, saltable. */
            <div style={{ animation: "secIn .3s ease both" }}>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 20, color: "#1C1D20" }}>
                antes de pagar… ¿te falta algo?
              </div>
              <div style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 4 }}>combina con lo que llevas — un toque y sigues al pago</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                {upsellShown.slice(0, 4).map((p) => (
                  <UpsellMini
                    key={p.id}
                    p={p}
                    wide
                    onOpen={() => {
                      setOpen(false);
                      router.push(`/products/${p.id}?src=direct`);
                    }}
                    onAdd={() => add({ id: p.id, title: p.title, price_cents: p.price_cents, category: p.category, image_url: p.image_url, source: p.source, weight_grams: p.weight_grams ?? null })}
                  />
                ))}
              </div>
              <div
                onClick={() => setPreCheckout(false)}
                style={{ display: "inline-block", marginTop: 14, fontSize: 12.5, color: "#8E8F94", cursor: "pointer", textDecoration: "underline" }}
              >
                ← volver al carro
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map((item) => {
                  const { nameVar, meta } = itemVars(item);
                  const navToProduct = () => {
                    setOpen(false);
                    router.push(`/products/${item.product_id}?src=direct`);
                  };
                  return (
                    <div key={item.key} style={{ display: "flex", gap: 12, background: "#fff", borderRadius: 16, border: "1px solid #EFEFEA", padding: 10, alignItems: "center", animation: "secIn .35s ease both" }}>
                      <div onClick={navToProduct} style={{ flex: "none", width: 60, height: 60, borderRadius: 12, background: stripe(catOf(item.category)), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden" }}>
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.image_url} alt={item.title} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "#9a9b98" }}>foto</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{nameVar}</div>
                        <div style={{ fontSize: 11.5, color: "#8E8F94", marginTop: 2 }}>{meta}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", border: "1px solid #ECECE7", borderRadius: 999, overflow: "hidden" }}>
                            <div onClick={() => dec(item.key)} className="tk-hov-dark" style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#55565B" }}>
                              −
                            </div>
                            <div style={{ width: 24, textAlign: "center", fontSize: 13, fontWeight: 700 }}>{item.qty}</div>
                            <div onClick={() => inc(item.key)} className="tk-hov-dark" style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#55565B" }}>
                              +
                            </div>
                          </div>
                          <div onClick={() => remove(item.key)} style={{ fontSize: 11.5, color: "#B0B1AE", cursor: "pointer", textDecoration: "underline" }}>
                            quitar
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(item.price_cents * item.qty)}</div>
                    </div>
                  );
                })}
              </div>

              {upsellShown.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: "#55565B" }}>{upsellLine}</div>
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none", marginTop: 10, paddingBottom: 4 }}>
                    {upsellShown.map((p) => (
                      <UpsellMini
                        key={p.id}
                        p={p}
                        onOpen={() => {
                          setOpen(false);
                          router.push(`/products/${p.id}?src=direct`);
                        }}
                        onAdd={() => add({ id: p.id, title: p.title, price_cents: p.price_cents, category: p.category, image_url: p.image_url, source: p.source, weight_grams: p.weight_grams ?? null })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {cartHas && (
          <div style={{ flex: "none", borderTop: "1px solid #EFEFEA", padding: "16px 22px 20px", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#55565B" }}>
              <span>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#55565B", marginTop: 6 }}>
              <span>Peso estimado</span>
              <span style={{ fontWeight: 600 }}>⚖ {weightLb.toFixed(1).replace(".0", "")} lb</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#55565B", marginTop: 6 }}>
              <span>Envío estimado (aéreo)</span>
              <span style={{ fontWeight: 600 }}>{shipF}</span>
            </div>
            {hasMultipleStores(items.map((i) => i.source)) && (
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12, color: "#8E8F94", marginTop: 6 }}>
                tu pedido junta varias tiendas — puede llegar en más de una entrega
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>{totF}</span>
            </div>
            <div
              onClick={() => {
                // Primera vez con recomendados: pantalla previa (cross-sell)
                // en vez de saltar directo — desde ella el mismo botón continúa.
                if (!preCheckout && upsellShown.length > 0) {
                  setPreCheckout(true);
                  return;
                }
                setOpen(false);
                router.push("/checkout");
              }}
              className="tk-hov-cta"
              data-testid="tuki-cart-checkout"
              style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              {preCheckout ? "Continuar al pago →" : "Ir a pagar →"}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
