"use client";
// src/components/tuki/HomeFeed.tsx — home Tuki (dc.html 142–300): greeting + chips,
// secciones (aisle/focus/grid) del feed real seccionado, scroll infinito y seen-reporting.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCard } from "@/storefront/contract";
import { observeSeen } from "@/lib/client/seen-reporter";
import { track } from "@/lib/client/track";
import { catOf, demoAttrs, fmt, sectionize, stripe, type TukiSection, CATS } from "./lib";
import { useTukiCart } from "./cart";
import { ProductCard } from "./ProductCard";

interface Batch {
  sections: TukiSection[];
  slateId: string | null;
}

function tintOf(sec: TukiSection): string {
  return sec.kind === "grid" ? "#F4F4F1" : sec.cat.tint;
}
function deepOf(sec: TukiSection): string {
  return sec.kind === "grid" ? "#77787D" : sec.cat.deep;
}

/** Card grande de la sección "focus" (dc.html 195–209). Reporta seen igual que ProductCard. */
function FocusCard({
  card,
  source,
  seenSlate,
  seenPos,
}: {
  card: StorefrontCard;
  source: "home";
  seenSlate?: string | null;
  seenPos?: number;
}) {
  const router = useRouter();
  const { add } = useTukiCart();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !seenSlate || seenPos == null) return;
    return observeSeen(el, seenSlate, seenPos);
  }, [seenSlate, seenPos]);

  const da = demoAttrs(card.id, card.category, card.price_cents);
  const oldC = da.oldPriceCents;
  const offPct = oldC != null ? "−" + Math.round((1 - card.price_cents / oldC) * 100) + "%" : "";
  const cat = catOf(card.category);

  return (
    <div
      ref={ref}
      data-testid="tuki-card"
      onClick={() => router.push(`/products/${card.id}?src=${source}`)}
      style={{
        display: "flex",
        gap: 0,
        background: "#fff",
        borderRadius: 26,
        boxShadow: "0 12px 32px rgba(28,29,32,.08)",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "relative",
          flex: "none",
          width: "46%",
          minHeight: 300,
          background: stripe(cat),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9a9b98" }}>foto producto grande</span>
        {oldC != null && (
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              background: "#1C1D20",
              color: "#fff",
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            {offPct}
          </div>
        )}
      </div>
      <div style={{ flex: 1, padding: "34px 38px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 12.5, color: "#8E8F94" }}>
          ★ {da.rating} · {da.sold} vendidos
        </div>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 29, fontWeight: 700, letterSpacing: "-0.5px", marginTop: 8 }}>
          {card.title}
        </div>
        <div style={{ fontSize: 14.5, color: "#77787D", marginTop: 8, lineHeight: 1.5, maxWidth: 420 }}>
          {card.reason ?? "elegido del día"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px" }}>{fmt(card.price_cents)}</span>
            {oldC != null && (
              <span style={{ fontSize: 14.5, color: "#B0B1AE", textDecoration: "line-through" }}>{fmt(oldC)}</span>
            )}
          </div>
          <div
            data-testid="tuki-card-add"
            onClick={(e) => {
              e.stopPropagation();
              add({
                id: card.id,
                title: card.title,
                price_cents: card.price_cents,
                category: card.category ?? null,
                image_url: card.image_url,
              });
            }}
            className="tk-hov-cta"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#1C1D20",
              color: "#fff",
              borderRadius: 999,
              padding: "14px 26px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Agregar <span style={{ fontSize: 17 }}>+</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeFeed({
  initialCards,
  nextCursor,
  slateId,
  greet = "Hola — armamos esto para ti",
  gsub = "el feed aprende de lo que miras, sin formularios",
}: {
  initialCards: StorefrontCard[];
  nextCursor: string | null;
  slateId: string | null;
  /** Greeting por perfil demo (T11) — default = copy de Explorador (T5). */
  greet?: string;
  gsub?: string;
}) {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>(() => [{ sections: sectionize(initialCards), slateId }]);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(batches[0].sections.length);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Scroll infinito: IntersectionObserver sobre el sentinel (root = viewport).
  // Se re-arma cuando `cursor` cambia; se detiene cuando cursor es null (fin/error).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        setLoadingMore(true);
        try {
          const res = await fetch(`/api/feed/page?cursor=${encodeURIComponent(cursor)}`);
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { items: StorefrontCard[]; next_cursor: string | null; slate_id: string | null };
          const off = offsetRef.current;
          const secs = sectionize(data.items, off);
          offsetRef.current = off + secs.length;
          setBatches((b) => [...b, { sections: secs, slateId: data.slate_id }]);
          setCursor(data.items.length ? data.next_cursor : null);
        } catch {
          setCursor(null); // se acabó o falló: dejamos de intentar
        } finally {
          loadingRef.current = false;
          setLoadingMore(false);
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor]);

  const goCategory = (id: string) => {
    track("category_click", { category: id });
    router.push(`/c/${id}`);
  };

  // Aplana batches → secciones con su slateId e índice global (para marginTop del solapado).
  const flat: { sec: TukiSection; slateId: string | null; gi: number }[] = [];
  let gi = 0;
  for (const b of batches) for (const sec of b.sections) flat.push({ sec, slateId: b.slateId, gi: gi++ });
  const lastTint = flat.length ? tintOf(flat[flat.length - 1].sec) : "#FAFAF8";

  return (
    <div style={{ animation: "screenIn .3s ease both" }}>
      {/* greeting + chips */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "36px 28px 8px" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 36, letterSpacing: "-0.4px" }}>{greet}</div>
        <div style={{ fontSize: 14, color: "#8E8F94", marginTop: 6 }}>✦ {gsub}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          {Object.values(CATS).map((c) => (
            <div
              key={c.id}
              onClick={() => goCategory(c.id)}
              className="tk-hov-chip"
              style={{
                padding: "9px 18px",
                borderRadius: 999,
                background: "#fff",
                border: "1px solid #ECECE7",
                fontSize: 13.5,
                color: "#55565B",
                cursor: "pointer",
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {/* secciones del feed */}
      <div style={{ marginTop: 26 }}>
        {flat.map(({ sec, slateId: sid, gi: idx }) => {
          const tint = tintOf(sec);
          const deep = deepOf(sec);
          return (
            <div
              key={idx}
              style={{
                position: "relative",
                borderRadius: "34px 34px 0 0",
                marginTop: idx === 0 ? "0px" : "-16px",
                background: tint,
                padding: "30px 0 40px",
                animation: "secIn .5s cubic-bezier(.2,.8,.2,1) both",
              }}
            >
              {sec.kind === "aisle" && (
                <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, color: deep }}>{sec.why}</div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <div style={{ fontFamily: "var(--font-brico)", fontSize: 27, fontWeight: 700, letterSpacing: "-0.5px", margin: "3px 0 18px" }}>
                      {sec.title}
                    </div>
                    <div
                      onClick={() => goCategory(sec.cat.id)}
                      className="tk-hov-underline"
                      style={{ fontSize: 13.5, fontWeight: 600, color: deep, cursor: "pointer" }}
                    >
                      ver todo →
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, overflowX: "auto", scrollbarWidth: "none", padding: "4px 2px 8px" }}>
                    {sec.cards.map((card) => (
                      <ProductCard key={card.id} card={card} source="home" variant="aisle" seenSlate={sid} seenPos={card.position} />
                    ))}
                  </div>
                </div>
              )}

              {sec.kind === "focus" && (
                <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, color: deep }}>{sec.why}</div>
                  <div style={{ fontFamily: "var(--font-brico)", fontSize: 27, fontWeight: 700, letterSpacing: "-0.5px", margin: "3px 0 18px" }}>
                    {sec.title}
                  </div>
                  {sec.cards[0] && <FocusCard card={sec.cards[0]} source="home" seenSlate={sid} seenPos={sec.cards[0].position} />}
                </div>
              )}

              {sec.kind === "grid" && (
                <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, color: deep }}>{sec.why}</div>
                  <div style={{ fontFamily: "var(--font-brico)", fontSize: 27, fontWeight: 700, letterSpacing: "-0.5px", margin: "3px 0 18px" }}>
                    {sec.title}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
                    {sec.cards.map((card) => (
                      <ProductCard key={card.id} card={card} source="home" variant="grid" seenSlate={sid} seenPos={card.position} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* skeleton "cargando más" (dc.html 281–295) — solo para páginas siguientes */}
        {loadingMore && (
          <div style={{ borderRadius: "34px 34px 0 0", marginTop: "-14px", background: "#F1F1EE", padding: "30px 0", position: "relative" }}>
            <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px" }}>
              <div style={{ width: 180, height: 16, borderRadius: 7, background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)", backgroundSize: "460px 100%", animation: "shimmer 1.1s linear infinite" }} />
              <div style={{ width: 280, height: 26, borderRadius: 9, marginTop: 10, background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)", backgroundSize: "460px 100%", animation: "shimmer 1.1s linear infinite" }} />
              <div style={{ display: "flex", gap: 16, marginTop: 18 }}>
                {[1, 0.99, 0.99, 0.6].map((op, i) => (
                  <div
                    key={i}
                    style={{
                      width: 198,
                      height: 220,
                      borderRadius: 20,
                      background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)",
                      backgroundSize: "460px 100%",
                      animation: "shimmer 1.1s linear infinite",
                      opacity: op,
                    }}
                  />
                ))}
              </div>
              <div style={{ position: "absolute", top: 30, right: 28, fontSize: 12.5, color: "#8E8F94" }}>✦ preparando algo para ti…</div>
            </div>
          </div>
        )}

        {/* sentinel del scroll infinito + cierre del solapado de secciones */}
        <div ref={sentinelRef} style={{ height: 120, background: lastTint }} />
      </div>
    </div>
  );
}
