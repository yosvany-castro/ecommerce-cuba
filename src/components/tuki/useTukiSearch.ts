"use client";
// src/components/tuki/useTukiSearch.ts — búsqueda: el loader NO es relleno, es identidad
// de marca (nunca se quita) y su duración es ADAPTATIVA según qué tan cara fue la
// búsqueda real. Al llegar r1 se decide animMs:
//   - r1.hit_cache        → ~1100ms ("ya conocía esta búsqueda", barrido rápido)
//   - r1.called_mock      → ~4200ms (hay ingesta externa real en curso en background —
//                           el teatro completo cubre ese trabajo real, no es relleno)
//   - resto (solo local)  → ~2200ms
// progress anima 0→1 durante animRestante = max(0, animMs - (tiempo que ya tardó la
// red)); si la red ya tardó más que animMs, se pintan los resultados de inmediato (la
// espera real ya cubrió el teatro). Restaurado tras 3e4c34d, que lo había quitado —
// no se vuelve a quitar.
// Si called_mock, en paralelo a la animación arranca el poll de fondo (SIN TOCAR) que
// re-consulta la MISMA q (su caché exacta fue invalidada por la ingesta) y hace append
// silencioso si trae más productos — sin reactivar el loader ni re-trackear.
// La ventana del poll es larga porque la ingesta real (actor Apify + enriquecimiento)
// tarda 60-180s medidos en vivo, no 10-30s. ponytail: poll con setTimeout, no
// SSE/WebSocket — es un job de fondo único, no un stream de eventos.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCard } from "@/storefront/contract";
import { track } from "@/lib/client/track";
import { parseProductUrl } from "@/lib/client/product-url";

interface ApiRow {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  metadata: unknown;
  created_at: string;
  source: string;
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
  resolvingUrl: boolean; // el texto sometido parseó como URL de producto — leyendo el link, no buscando
  run(q: string): void;
}

const STEP_MS = 90;
// Duración mínima total del teatro según qué pasó en r1 (ver cabecera del archivo).
function animMsFor(r1: Pick<ApiResp, "hit_cache" | "called_mock">): number {
  if (r1.hit_cache) return 1100;
  if (r1.called_mock) return 4200;
  return 2200;
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
    source: r.source,
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
  const router = useRouter();
  const [phase, setPhase] = useState<TukiSearch["phase"]>("idle");
  const [progress, setProgress] = useState(0);
  const [cards, setCards] = useState<StorefrontCard[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [polling, setPolling] = useState(false);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const runId = useRef(0);
  const animTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAnim = useCallback(() => {
    if (animTimer.current) {
      clearInterval(animTimer.current);
      animTimer.current = null;
    }
  }, []);
  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);
  useEffect(() => {
    return () => {
      clearAnim();
      clearPoll();
    };
  }, [clearAnim, clearPoll]); // limpia timers al desmontar

  const run = useCallback(
    (rawQ: string) => {
      const q = rawQ.trim();
      if (!q) return;
      const myId = ++runId.current; // invalida cualquier run previo en vuelo (incluye sus timers)
      clearAnim();
      clearPoll();
      setPolling(false);
      setResolvingUrl(false);

      // Modelo de reventa: si pegan el link de un producto (amazon/aliexpress/
      // shein/walmart) en vez de buscar por texto, no hay nada que buscar —
      // resolvemos directo a la ficha de ESE producto (Tarea 2).
      const parsedUrl = parseProductUrl(q);
      if (parsedUrl) {
        setPhase("loading");
        setResolvingUrl(true);
        let p = 0.15;
        setProgress(p);
        animTimer.current = setInterval(() => {
          if (myId !== runId.current) return clearAnim();
          p = Math.min(0.9, p + 0.08);
          setProgress(p);
        }, 200);
        fetch("/api/products/resolve-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: q }),
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ product_id: string }>) : Promise.reject()))
          .then(({ product_id }) => {
            if (myId !== runId.current) return;
            clearAnim();
            router.push(`/products/${product_id}`);
          })
          .catch(() => {
            if (myId !== runId.current) return;
            clearAnim();
            setResolvingUrl(false);
            setCards([]);
            setMeta({ hit_cache: false, called_mock: false, method: "url_resolve_failed" });
            setProgress(1);
            setPhase("results");
          });
        return;
      }

      setPhase("loading");
      setProgress(0);
      saveRecent(q); // guardar al INICIAR la búsqueda
      const t0 = Date.now();

      const fetchOnce = (): Promise<ApiResp> => fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      const finish = (finalCards: StorefrontCard[], finalMeta: SearchMeta, trackIt = true) => {
        if (myId !== runId.current) return;
        clearAnim();
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
          const finalCards = toCards(r1.products);
          const finalMeta = metaOf(r1);

          // Duración mínima adaptativa del teatro, descontando lo que la red ya tardó.
          const animMs = animMsFor(r1);
          const animRestante = Math.max(0, animMs - (Date.now() - t0));
          if (animRestante === 0) {
            finish(finalCards, finalMeta);
          } else {
            const steps = Math.max(1, Math.round(animRestante / STEP_MS));
            let i = 0;
            clearAnim();
            animTimer.current = setInterval(() => {
              if (myId !== runId.current) return clearAnim();
              if (++i < steps) return setProgress(i / steps);
              finish(finalCards, finalMeta);
            }, STEP_MS);
          }

          if (r1.called_mock) {
            setPolling(true);
            pollForMore(0, r1.products.length);
          }
        })
        // una búsqueda que no llegó al server no es evento medible: sin track.
        .catch(() => finish([], { hit_cache: false, called_mock: false, method: "error" }, false));
    },
    [clearAnim, clearPoll, router],
  );

  return { phase, progress, cards, meta, polling, resolvingUrl, run };
}
