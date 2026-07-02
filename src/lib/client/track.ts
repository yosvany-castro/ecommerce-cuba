"use client";

/**
 * Browser binding of the unified event queue (C4). ALL client tracking goes
 * through `track()` — the four ad-hoc fetch("/api/track") copies are gone.
 *
 * Transport: ONE batched POST per flush; navigator.sendBeacon on
 * pagehide/visibilitychange-hidden (survives navigation); fetch otherwise.
 * Failures (incl. 503 from the DB breaker) keep events queued with backoff.
 * bfcache-safe: pageshow re-arms; pagehide flushes.
 */

import { TrackQueueCore, type QueuedEvent } from "./track-queue-core";

const FLUSH_IDLE_MS = 3_000;
let core: TrackQueueCore | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let backoffUntil = 0;
let lifecycleArmed = false;

function getCore(): TrackQueueCore | null {
  if (typeof window === "undefined") return null;
  if (core) return core;
  let tabId = sessionStorage.getItem("track_tab_id");
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem("track_tab_id", tabId);
  }
  core = new TrackQueueCore(
    {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
      remove: (k) => localStorage.removeItem(k),
      keys: () => Object.keys(localStorage),
    },
    tabId,
  );
  core.adoptOrphans();
  armLifecycle();
  return core;
}

function armLifecycle(): void {
  if (lifecycleArmed) return;
  lifecycleArmed = true;
  const onHide = () => flush(true);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("online", () => flush(false));
  window.addEventListener("pageshow", () => {
    // bfcache restore: el estado JS sobrevive; re-adoptar huérfanas y drenar.
    getCore()?.adoptOrphans();
    void flush(false);
  });
}

function scheduleIdleFlush(): void {
  if (idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void flush(false);
  }, FLUSH_IDLE_MS);
}

async function flush(useBeacon: boolean): Promise<void> {
  const q = getCore();
  if (!q) return;
  if (Date.now() < backoffUntil) return;
  const batch = q.takeBatch();
  if (batch.length === 0) return;
  const body = JSON.stringify({ events: batch });

  if (useBeacon && typeof navigator.sendBeacon === "function") {
    // Beacon es fire-and-forget: si el browser lo acepta, damos por entregado
    // (la idempotencia por client_event_id cubre el raro beacon perdido y
    // reenviado: un duplicado es un no-op en el servidor).
    const ok = navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    if (ok) q.ack(batch.map((e) => e.client_event_id));
    return;
  }

  try {
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
    if (res.ok) {
      q.ack(batch.map((e) => e.client_event_id));
      if (q.shouldFlushBySize()) void flush(false); // drenar lo adoptado/acumulado
    } else if (res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "15");
      backoffUntil = Date.now() + retryAfter * 1000;
    } else if (res.status >= 400 && res.status < 500) {
      // Permanently rejected (bad identity / schema): drop, never poison-pill the queue.
      q.ack(batch.map((e) => e.client_event_id));
    }
  } catch {
    backoffUntil = Date.now() + 10_000; // red caída: el próximo trigger reintenta
  }
}

export interface TrackOpts {
  /** Urgent events (dismiss, add_to_cart) flush immediately, not on idle. */
  urgent?: boolean;
}

/** Queue a tracking event. Never throws; never blocks the UI. */
export function track(
  event_type: string,
  payload: Record<string, unknown>,
  opts: TrackOpts = {},
): void {
  const q = getCore();
  if (!q) return;
  const event: QueuedEvent = {
    client_event_id: crypto.randomUUID(),
    event_type,
    occurred_at: new Date().toISOString(),
    payload,
  };
  q.enqueue(event);
  if (opts.urgent || q.shouldFlushBySize()) void flush(false);
  else scheduleIdleFlush();
}
