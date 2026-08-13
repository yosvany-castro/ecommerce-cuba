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
  // Solo EVENTOS: el carrito Tuki vive en localStorage (tuki_cart:*) y
  // sobrevive el login por sí solo. El viejo merge a cart_items estaba doble-
  // roto (clave 'cart:' inexistente + shape qty/quantity) y NADIE lee esa
  // tabla — eliminado en vez de arreglar un camino muerto (auditoría DAL-6).
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
