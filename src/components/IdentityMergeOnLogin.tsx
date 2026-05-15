"use client";
import { useEffect } from "react";
import { useUser } from "@auth0/nextjs-auth0";

function getAnonymousId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(^|;\s*)anonymous_id=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

export function IdentityMergeOnLogin() {
  const { user, isLoading } = useUser();

  useEffect(() => {
    if (isLoading || !user) return;
    const anonId = getAnonymousId();
    if (!anonId) return;
    const flag = `merge_done:${user.sub}:${anonId}`;
    if (localStorage.getItem(flag) === "1") return;

    void (async () => {
      const r1 = await fetch("/api/identity/merge", { method: "POST" }).catch(() => null);
      if (!r1?.ok) return;
      localStorage.setItem(flag, "1");

      if (!anonId) return;
      const cartRaw = localStorage.getItem(`cart:${anonId}`);
      if (!cartRaw) return;
      try {
        const items = JSON.parse(cartRaw);
        const r2 = await fetch("/api/cart/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(items),
        });
        if (r2.ok) localStorage.removeItem(`cart:${anonId}`);
      } catch { /* malformed cart, ignore */ }
    })();
  }, [user, isLoading]);

  return null;
}
