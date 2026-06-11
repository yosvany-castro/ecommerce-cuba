"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductCard, type ProductCardData } from "./ProductCard";

interface FeedCardDTO extends ProductCardData {
  reason?: string;
}

interface FeedPageResponse {
  items: FeedCardDTO[];
  next_cursor: string | null;
  slate_id: string | null;
}

/**
 * Infinite scroll over the materialized slate (Etapa C3).
 *
 * - Sentinel via IntersectionObserver at ~800px BEFORE the end: on Cuban RTTs
 *   (300-600ms) the next page typically arrives before the user reaches the
 *   bottom — perceived-continuous scroll with bounded speculation (12 items
 *   ≈ 3KB JSON; images stay lazy per card).
 * - Data-saver mode (navigator.connection.saveData) disables prefetching:
 *   the user pays only for what they explicitly request ("Ver más").
 * - Failures show a MANUAL retry — automatic retries burn metered data.
 * - End of feed is explicit (next_cursor null ⇒ "Fin del catálogo").
 */
export function InfiniteFeed({ initialCursor }: { initialCursor: string | null }) {
  const [items, setItems] = useState<FeedCardDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">(
    initialCursor ? "idle" : "done",
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);

  const saveData =
    typeof navigator !== "undefined" &&
    Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setState("loading");
    try {
      const res = await fetch(`/api/feed/page?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(`feed page ${res.status}`);
      const page = (await res.json()) as FeedPageResponse;
      setItems((prev) => {
        // Idempotent append: a regenerated page can never duplicate a card.
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...page.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(page.next_cursor);
      setState(page.next_cursor ? "idle" : "done");
    } catch {
      setState("error"); // reintento manual: nada de retries automáticos en datos medidos
    } finally {
      inFlight.current = false;
    }
  }, [cursor]);

  useEffect(() => {
    if (saveData || state !== "idle" || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [saveData, state, loadMore]);

  return (
    <>
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {items.map((it) => (
            <ProductCard key={it.id} product={it} reason={it.reason} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden className="h-1" />

      <div className="flex justify-center py-6">
        {state === "loading" && (
          <p className="text-sm text-gray-400" role="status">
            Cargando más productos…
          </p>
        )}
        {state === "error" && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="rounded border px-4 py-2 text-sm"
          >
            No se pudo cargar — reintentar
          </button>
        )}
        {state === "idle" && saveData && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="rounded border px-4 py-2 text-sm"
          >
            Ver más
          </button>
        )}
        {state === "done" && items.length > 0 && (
          <p className="text-xs text-gray-400">Fin del catálogo</p>
        )}
      </div>
    </>
  );
}
