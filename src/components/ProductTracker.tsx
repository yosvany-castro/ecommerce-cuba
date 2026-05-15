"use client";
import { useEffect } from "react";

function inferSource(): "home" | "category" | "search" | "direct" {
  if (typeof document === "undefined") return "direct";
  const ref = document.referrer;
  if (!ref) return "direct";
  try {
    const url = new URL(ref);
    if (url.origin !== window.location.origin) return "direct";
    if (url.pathname === "/") return "home";
    if (url.pathname.startsWith("/search")) return "search";
    if (url.pathname.startsWith("/category")) return "category";
    return "direct";
  } catch {
    return "direct";
  }
}

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

export function ProductTracker({ productId }: { productId: string }) {
  useEffect(() => {
    const start = Date.now();
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellSent = false;

    void trackEvent({
      event_type: "product_view",
      occurred_at: new Date().toISOString(),
      payload: { product_id: productId, source: inferSource() },
    });

    dwellTimer = setTimeout(() => {
      if (dwellSent) return;
      dwellSent = true;
      void trackEvent({
        event_type: "product_dwell",
        occurred_at: new Date().toISOString(),
        payload: { product_id: productId, dwell_ms: Date.now() - start },
      });
    }, 30_000);

    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
    };
  }, [productId]);

  return null;
}
