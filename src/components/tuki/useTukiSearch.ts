"use client";
// src/components/tuki/useTukiSearch.ts — búsqueda: r1 pinta de inmediato (item 1.1 roadmap
// pre-lanzamiento — antes esperaba ~4200/800ms fijos para mostrar datos que ya estaban).
// Si called_mock (F4 T3, ingesta externa en vuelo) hay un poll de fondo con backoff (~3min
// de ventana total) que re-llama la MISMA q (su caché exacta fue invalidada por la ingesta)
// y hace append silencioso si trae más productos — sin reactivar el loader ni re-trackear.
// La ventana es larga porque la ingesta real (actor Apify + enriquecimiento) tarda 60-180s
// medidos en vivo, no 10-30s. ponytail: poll con setTimeout, no SSE/WebSocket — es un job
// de fondo único, no un stream de eventos.
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
  polling: boolean; // poll de fondo activo buscando más productos (called_mock)
  run(q: string): void;
}

// Backoff: denso al inicio (ingestas rápidas) y espaciado después, ~3min en total.
// Cada poll re-corre la búsqueda en el server (normalize LLM + embedding: fracciones
// de centavo) — 10 polls acotados es el techo de ese gasto por búsqueda con ingesta.
const POLL_SCHEDULE_MS = [3_000, 5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000];

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
  const [polling, setPolling] = useState(false);
  const runId = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  useEffect(() => clearPoll, [clearPoll]); // cancela el poll de fondo al desmontar

  const run = useCallback(
    (rawQ: string) => {
      const q = rawQ.trim();
      if (!q) return;
      const myId = ++runId.current; // invalida cualquier run previo en vuelo (incluye su poll)
      clearPoll();
      setPolling(false);
      setPhase("loading");
      setProgress(0);
      saveRecent(q); // guardar al INICIAR la búsqueda

      const fetchOnce = (): Promise<ApiResp> => fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      const finish = (finalCards: StorefrontCard[], finalMeta: SearchMeta, trackIt = true) => {
        if (myId !== runId.current) return;
        setCards(finalCards);
        setMeta(finalMeta);
        setProgress(1);
        setPhase("results");
        if (trackIt) track("search", { raw_query: q, results_count: finalCards.length, method: finalMeta.method });
      };

      // Poll de fondo: solo cuando called_mock (ingesta externa en vuelo). No
      // reactiva el loader ni re-trackea, solo hace append si llega más que lo
      // que ya se ve. Sigue hasta agotar intentos aunque un poll no traiga nada
      // nuevo (la ingesta puede seguir en curso); se corta al desmontar o al
      // arrancar un run nuevo (guard runId).
      const pollForMore = (attempt: number, knownCount: number) => {
        if (myId !== runId.current || attempt >= POLL_SCHEDULE_MS.length) {
          if (myId === runId.current) setPolling(false);
          return;
        }
        pollTimer.current = setTimeout(() => {
          if (myId !== runId.current) return;
          fetchOnce()
            .then((rN) => {
              if (myId !== runId.current) return;
              if (rN.products.length > knownCount) {
                setCards(toCards(rN.products));
                setMeta(metaOf(rN));
                knownCount = rN.products.length;
              }
              pollForMore(attempt + 1, knownCount);
            })
            .catch(() => pollForMore(attempt + 1, knownCount));
        }, POLL_SCHEDULE_MS[attempt]);
      };

      fetchOnce()
        .then((r1) => {
          if (myId !== runId.current) return;
          finish(toCards(r1.products), metaOf(r1));
          if (r1.called_mock) {
            setPolling(true);
            pollForMore(0, r1.products.length);
          }
        })
        // una búsqueda que no llegó al server no es evento medible: sin track.
        .catch(() => finish([], { hit_cache: false, called_mock: false, method: "error" }, false));
    },
    [clearPoll],
  );

  return { phase, progress, cards, meta, polling, run };
}
