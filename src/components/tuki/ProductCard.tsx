"use client";
// src/components/tuki/ProductCard.tsx — tarjeta de producto Tuki (dc.html 170–183 aisle / 261–274 grid).
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCard } from "@/storefront/contract";
import { observeSeen } from "@/lib/client/seen-reporter";
import { attrsOf, catOf, fmt, stripe } from "./lib";
import { useTukiCart } from "./cart";

export type CardSource = "home" | "category" | "search" | "direct";

export function ProductCard({
  card,
  source,
  variant = "aisle",
  seenSlate,
  seenPos,
}: {
  card: StorefrontCard;
  source: CardSource;
  variant?: "aisle" | "grid";
  // Slate + posición del card en el hero_grid: reporta "visto" (E3). Ausentes → no reporta.
  seenSlate?: string | null;
  seenPos?: number;
}) {
  const router = useRouter();
  const { add } = useTukiCart();
  const ref = useRef<HTMLDivElement>(null);
  const prefetchedHydrate = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !seenSlate || seenPos == null) return;
    return observeSeen(el, seenSlate, seenPos);
  }, [seenSlate, seenPos]);

  // Prefetch por intención (T5): al primer hover, si el producto real aún no
  // se hidrató, dispara la hidratación YA — así, cuando el usuario de verdad
  // entra a la PDP, ya viene corriendo o terminó (mitiga los ~20s de la
  // primera hidratación). aliexpress queda afuera: su cuota de 100/mes es
  // sagrada y un hover no confirma intención de compra como sí lo hace la
  // visita a la PDP (que sí la dispara, ver ProductView). El claim atómico
  // del server (UPDATE...WHERE...IS NULL) ya evita duplicados si de todos
  // modos la PDP la vuelve a pedir.
  const onHoverPrefetch = () => {
    if (prefetchedHydrate.current || card.attrs?.hydrated_at || card.source === "aliexpress") return;
    prefetchedHydrate.current = true;
    fetch(`/api/products/${card.id}/hydrate`, { method: "POST" }).catch(() => {});
  };

  const da = attrsOf(card);
  const oldC = da.oldPriceCents;
  const offPct = oldC != null ? "−" + Math.round((1 - card.price_cents / oldC) * 100) + "%" : "";
  const dots = da.colors.slice(0, 4);
  const moreN = Math.max(0, da.colors.length - 4);
  const cat = catOf(card.category);
  const isGrid = variant === "grid";

  const open = () => router.push(`/products/${card.id}?src=${source}`);
  const addToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    add({
      id: card.id,
      title: card.title,
      price_cents: card.price_cents,
      category: card.category ?? null,
      image_url: card.image_url,
      source: card.source,
    });
  };

  return (
    <div
      ref={ref}
      data-testid="tuki-card"
      onClick={open}
      onMouseEnter={onHoverPrefetch}
      className="tk-hov-lift"
      style={{
        ...(isGrid ? {} : { flex: "none", width: 198 }),
        background: "#fff",
        borderRadius: 20,
        boxShadow: "0 6px 18px rgba(28,29,32,.06)",
        padding: "9px 9px 14px",
        cursor: "pointer",
        transition: "transform .18s, box-shadow .18s",
      }}
    >
      <div
        style={{
          position: "relative",
          // look Shein: tile vertical 3:4 a sangre — las fotos de producto son
          // verticales; una franja apaisada las decapita o las deja flotando.
          aspectRatio: "3 / 4",
          borderRadius: 14,
          background: stripe(cat),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image_url} alt={card.title} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#9a9b98" }}>foto producto</span>
        )}
        {oldC != null && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              background: "#1C1D20",
              color: "#fff",
              borderRadius: 999,
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {offPct}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: "10px 5px 0",
          lineHeight: 1.3,
          ...(isGrid ? {} : { height: 36, overflow: "hidden" }),
        }}
      >
        {card.title}
      </div>
      {dots.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "6px 5px 0" }}>
          {dots.map((d, i) => (
            <div
              key={i}
              style={{ width: 11, height: 11, borderRadius: "50%", background: d.hex ?? "#D8D8D3", border: "1px solid rgba(0,0,0,.14)" }}
            />
          ))}
          {!isGrid && moreN > 0 && <span style={{ fontSize: 10, color: "#8E8F94" }}>+{moreN}</span>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 5px 0" }}>
        <div>
          {isGrid ? (
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{fmt(card.price_cents)}</span>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 15.5, fontWeight: 700 }}>{fmt(card.price_cents)}</span>
              {oldC != null && (
                <span style={{ fontSize: 11.5, color: "#B0B1AE", textDecoration: "line-through" }}>{fmt(oldC)}</span>
              )}
            </div>
          )}
          {card.source && (
            <div style={{ fontSize: 10, color: "#B0B1AE", marginTop: 2, textTransform: "lowercase" }}>{card.source}</div>
          )}
        </div>
        <div
          data-testid="tuki-card-add"
          onClick={addToCart}
          className="tk-hov-plus"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "#1C1D20",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            cursor: "pointer",
          }}
        >
          +
        </div>
      </div>
    </div>
  );
}
