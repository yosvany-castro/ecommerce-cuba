"use client";
import { useEffect } from "react";
import { track } from "@/lib/client/track";

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

export function ProductTracker({ productId }: { productId: string }) {
  useEffect(() => {
    const start = Date.now();
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellSent = false;

    track("product_view", { product_id: productId, source: inferSource() });

    dwellTimer = setTimeout(() => {
      if (dwellSent) return;
      dwellSent = true;
      track("product_dwell", { product_id: productId, dwell_ms: Date.now() - start });
    }, 30_000);

    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
    };
  }, [productId]);

  return null;
}
