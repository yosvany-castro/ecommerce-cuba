"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/ProductCard";
import type { StorefrontSection } from "@/storefront/contract";

/**
 * Client-side surface sections (D5): lazy fetch of /api/slate/resolve AFTER
 * the main content painted — the PDP keeps its <100ms HTML and the cross-sell
 * arrives below the fold; the cart reads localStorage (the anonymous truth)
 * and ships the ids in the body. Any failure renders NOTHING (zero risk to
 * the host page); no automatic retries on metered data.
 */
export function SurfaceSections({
  surface,
  surfaceArgs,
  refreshKey = "",
}: {
  surface: "pdp" | "cart";
  surfaceArgs: Record<string, unknown>;
  /** Cambia (p.ej. items del carrito) ⇒ re-resolver. */
  refreshKey?: string;
}) {
  const [sections, setSections] = useState<StorefrontSection[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/slate/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ surface, surface_args: surfaceArgs }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { sections: StorefrontSection[] };
        if (!cancelled) setSections(body.sections);
      } catch {
        /* sección invisible; la página anfitriona no se entera */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, refreshKey]);

  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((s) => (
        <section key={s.placement_id} className="mt-10" data-testid={`slate-section-${s.section_type}`}>
          <h2 className="text-lg font-semibold mb-3">{s.title}</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
            {s.items.map((it) => (
              <div key={it.id} className="w-40 shrink-0 snap-start">
                <ProductCard product={it} reason={it.reason} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
