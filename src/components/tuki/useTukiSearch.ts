"use client";
// src/components/tuki/useTukiSearch.ts — búsqueda two-phase (el corazón de la conexión búsqueda).
// r1 → si called_mock hay ingesta externa en vuelo (F4 T3): anima 0→1 en ~4200ms y re-fetch
// la MISMA q (la caché exacta fue invalidada por la ingesta ⇒ r2 trae local + externo).
// Si no: resultados ya completos, anima 0→1 en ~800ms con r1.
// ponytail: 1 re-fetch fijo; si el ingest tarda >4.2s se ve en la PRÓXIMA búsqueda (igual que promete el backend).
import { useCallback, useEffect, useRef, useState } from "react";
import type { StorefrontCard } from "@/storefront/contract";
import { track } from "@/lib/client/track";

interface ApiRow {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  metadata: unknown;
  created_at: string;
}
interface ApiResp {
  products: ApiRow[];
  count: number;
  hit_cache: boolean;
  called_mock: boolean;
  method: string;
  normalized: string | null;
}
export interface SearchMeta {
  hit_cache: boolean;
  called_mock: boolean;
  method: string;
}
export interface TukiSearch {
  phase: "idle" | "loading" | "results";
  progress: number; // 0..1 para la barra/etapas del loader
  cards: StorefrontCard[];
  meta: SearchMeta | null;
  run(q: string): void;
}

const STEP_MS = 90;

function toCards(rows: ApiRow[]): StorefrontCard[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    price_cents: r.price_cents,
    currency: r.currency,
    image_url: r.image_url,
    category: (r.metadata as { category?: string | null } | null)?.category ?? null,
  }));
}
function metaOf(r: ApiResp): SearchMeta {
  return { hit_cache: r.hit_cache, called_mock: r.called_mock, method: r.method };
}
function saveRecent(q: string): void {
  try {
    const raw = localStorage.getItem("tuki_recents");
    const arr: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr.map(String) : [];
    localStorage.setItem("tuki_recents", JSON.stringify([q, ...list.filter((x) => x !== q)].slice(0, 5)));
  } catch {
    /* localStorage lleno/corrupto: sin recientes */
  }
}

export function useTukiSearch(): TukiSearch {
  const [phase, setPhase] = useState<TukiSearch["phase"]>("idle");
  const [progress, setProgress] = useState(0);
  const [cards, setCards] = useState<StorefrontCard[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const runId = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clearTimer, [clearTimer]); // limpia el interval al desmontar

  const run = useCallback(
    (rawQ: string) => {
      const q = rawQ.trim();
      if (!q) return;
      const myId = ++runId.current; // invalida cualquier run previo en vuelo
      clearTimer();
      setPhase("loading");
      setProgress(0);
      saveRecent(q); // guardar al INICIAR la búsqueda

      const fetchOnce = (): Promise<ApiResp> => fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      const finish = (finalCards: StorefrontCard[], finalMeta: SearchMeta) => {
        if (myId !== runId.current) return;
        clearTimer();
        setCards(finalCards);
        setMeta(finalMeta);
        setProgress(1);
        setPhase("results");
        track("search", { raw_query: q, results_count: finalCards.length, method: finalMeta.method });
      };

      fetchOnce()
        .then((r1) => {
          if (myId !== runId.current) return;
          const steps = Math.round((r1.called_mock ? 4200 : 800) / STEP_MS);
          let i = 0;
          clearTimer();
          timer.current = setInterval(() => {
            if (myId !== runId.current) return clearTimer();
            if (++i < steps) return setProgress(i / steps);
            clearTimer();
            if (!r1.called_mock) return finish(toCards(r1.products), metaOf(r1));
            // ingesta en vuelo: mantener ~0.98 hasta que r2 traiga las cards
            setProgress(0.98);
            fetchOnce()
              .then((r2) => finish(toCards(r2.products), metaOf(r2)))
              .catch(() => finish(toCards(r1.products), metaOf(r1))); // r2 falla → r1
          }, STEP_MS);
        })
        .catch(() => finish([], { hit_cache: false, called_mock: false, method: "error" }));
    },
    [clearTimer],
  );

  return { phase, progress, cards, meta, run };
}
