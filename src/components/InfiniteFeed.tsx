"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ProductCard, type ProductCardData } from "./ProductCard";
import {
  parseSnapshot,
  shouldRestoreSnapshot,
  type FeedSnapshot,
} from "@/lib/client/feed-snapshot";

interface FeedCardDTO extends ProductCardData {
  reason?: string;
}

interface FeedPageResponse {
  items: FeedCardDTO[];
  next_cursor: string | null;
  slate_id: string | null;
}

const SNAPSHOT_KEY = "feed_snapshot:home";

/**
 * Infinite scroll over the materialized slate (Etapa C3) + instant back (C6).
 *
 * - Sentinel via IntersectionObserver at ~800px BEFORE the end: on Cuban RTTs
 *   (300-600ms) the next page typically arrives before the user reaches the
 *   bottom — perceived-continuous scroll with bounded speculation (12 items
 *   ≈ 3KB JSON; images stay lazy per card).
 * - Data-saver mode (navigator.connection.saveData) disables prefetching:
 *   the user pays only for what they explicitly request ("Ver más").
 * - Failures show a MANUAL retry — automatic retries burn metered data.
 * - End of feed is explicit (next_cursor null ⇒ "Fin del catálogo").
 * - PDP→back (C6): pages 2+ and scroll survive in sessionStorage keyed by
 *   slate_id with the SHARED 300s staleness window — back costs 0 network and
 *   renders locally (<100ms even on modest devices). App Router remounts the
 *   client component on SPA back, so React state alone cannot do this.
 */
export function InfiniteFeed({
  initialCursor,
  slateId,
}: {
  initialCursor: string | null;
  slateId: string | null;
}) {
  const [items, setItems] = useState<FeedCardDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">(
    initialCursor ? "idle" : "done",
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  const restoredScrollY = useRef<number | null>(null);

  const saveData =
    typeof navigator !== "undefined" &&
    Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);

  // ── C6 restore: BEFORE first paint, rehydrate pages 2+ from the snapshot. ──
  // setState sync dentro de useLayoutEffect es el patrón sancionado por React
  // para correcciones pre-paint (de lo contrario: flash de lista vacía y
  // scroll clampado). No puede ser un useState lazy: correría en SSR/hydration
  // y desajustaría el HTML del servidor.
  useLayoutEffect(() => {
    const snap = parseSnapshot<FeedCardDTO>(sessionStorage.getItem(SNAPSHOT_KEY));
    if (shouldRestoreSnapshot(snap, slateId, Date.now())) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(snap!.items);
      setCursor(snap!.cursor);
      setState(snap!.cursor ? "idle" : "done");
      restoredScrollY.current = snap!.scroll_y;
    } else if (snap) {
      sessionStorage.removeItem(SNAPSHOT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the saved scroll AFTER the restored items are in the DOM.
  useEffect(() => {
    if (restoredScrollY.current === null || items.length === 0) return;
    const y = restoredScrollY.current;
    restoredScrollY.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [items]);

  // Persist the snapshot: items/cursor on every change; scroll throttled.
  useEffect(() => {
    if (!slateId) return;
    const save = () => {
      const snap: FeedSnapshot<FeedCardDTO> = {
        slate_id: slateId,
        items,
        cursor,
        scroll_y: window.scrollY,
        saved_at: Date.now(),
      };
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      } catch {
        /* cuota llena: el back degradará a refetch */
      }
    };
    save();
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      setTimeout(() => {
        ticking = false;
        save();
      }, 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items, cursor, slateId]);

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
