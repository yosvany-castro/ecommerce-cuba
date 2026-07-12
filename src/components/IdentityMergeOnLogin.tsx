"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

function getAnonymousId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(^|;\s*)anonymous_id=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

async function mergeOnce(sub: string) {
  const anonId = getAnonymousId();
  if (!anonId) return;
  const flag = `merge_done:${sub}:${anonId}`;
  if (localStorage.getItem(flag) === "1") return;

  const r1 = await fetch("/api/identity/merge", { method: "POST" }).catch(() => null);
  if (!r1?.ok) return;
  localStorage.setItem(flag, "1");

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
  } catch {
    /* malformed cart, ignore */
  }
}

/** Al detectar sesión de Supabase (login nuevo o sesión existente al montar),
 * fusiona la identidad anónima (eventos, carrito) con el usuario — misma
 * lógica idempotente de la era Auth0, solo cambia la fuente de la sesión. */
export function IdentityMergeOnLogin() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) void mergeOnce(data.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) void mergeOnce(session.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
