"use client";

/**
 * Viewport seen-reporter (E3): ONE shared IntersectionObserver stamps cards
 * as SEEN when ≥50% visible for ≥1s, once per card per pageload, and ships
 * positions to /api/feed/seen in coalesced batches (≥10 buffered, 10s after
 * the first, or pagehide via sendBeacon) — ~0.3KB per screenful, one radio
 * wake-up per burst. Passive observers: zero scroll-handler jank on modest
 * Android. Re-entries do NOT re-report (the semantics downstream — fatigue,
 * CTR denominators — is "had a real chance to see it at least once").
 */

const DWELL_MS = 1_000;
const FLUSH_AFTER_MS = 10_000;
const FLUSH_AT_COUNT = 10;

interface PendingBuffer {
  positions: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
}

const buffers = new Map<string, PendingBuffer>(); // slate_id -> buffer
const reported = new Set<string>(); // `${slate_id}:${position}` (once per pageload)
const dwellTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
let observer: IntersectionObserver | null = null;
let lifecycleArmed = false;

function flush(slateId: string, useBeacon: boolean): void {
  const buf = buffers.get(slateId);
  if (!buf || buf.positions.size === 0) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  const positions = [...buf.positions].slice(0, 100);
  buf.positions.clear();
  const body = JSON.stringify({ slate_id: slateId, positions });
  if (useBeacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/feed/seen", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/feed/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* best-effort: la fatiga puede esperar al próximo avistamiento */
  });
}

function flushAll(useBeacon: boolean): void {
  for (const slateId of buffers.keys()) flush(slateId, useBeacon);
}

function markSeen(slateId: string, position: number): void {
  const key = `${slateId}:${position}`;
  if (reported.has(key)) return;
  reported.add(key);
  let buf = buffers.get(slateId);
  if (!buf) {
    buf = { positions: new Set(), timer: null };
    buffers.set(slateId, buf);
  }
  buf.positions.add(position);
  if (buf.positions.size >= FLUSH_AT_COUNT) flush(slateId, false);
  else if (!buf.timer) {
    buf.timer = setTimeout(() => {
      buf!.timer = null;
      flush(slateId, false);
    }, FLUSH_AFTER_MS);
  }
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const slateId = (el as HTMLElement).dataset.seenSlate;
        const pos = Number((el as HTMLElement).dataset.seenPos);
        if (!slateId || !Number.isFinite(pos)) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          const t = setTimeout(() => {
            markSeen(slateId, pos);
            observer?.unobserve(el); // una vez por card por pageload
          }, DWELL_MS);
          dwellTimers.set(el, t);
        } else {
          const t = dwellTimers.get(el);
          if (t) clearTimeout(t); // salió antes del dwell: no cuenta
        }
      }
    },
    { threshold: 0.5 },
  );
  if (!lifecycleArmed) {
    lifecycleArmed = true;
    window.addEventListener("pagehide", () => flushAll(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll(true);
    });
  }
  return observer;
}

/** Observe a card element. Returns an unobserve cleanup. */
export function observeSeen(el: Element, slateId: string, position: number): () => void {
  (el as HTMLElement).dataset.seenSlate = slateId;
  (el as HTMLElement).dataset.seenPos = String(position);
  if (reported.has(`${slateId}:${position}`)) return () => {};
  const obs = getObserver();
  obs.observe(el);
  return () => obs.unobserve(el);
}
