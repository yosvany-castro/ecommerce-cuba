import { ProductCard } from "@/components/ProductCard";
import { InfiniteFeed } from "@/components/InfiniteFeed";
import { SeenTracker } from "./SeenTracker";
import type { StorefrontSection } from "@/storefront/contract";

/**
 * SlateRenderer (D4): maps a resolved composition to the FIXED catalog of
 * section components — the server decides WHAT, this file owns HOW it looks.
 * hero_grid reproduces the pre-slate home markup verbatim (equivalence test
 * guards the item-level identity); carousels are horizontal scrollers reusing
 * the same ProductCard. Unknown outcomes simply don't render — a degraded
 * section is invisible, never broken.
 */
export function SlateRenderer({ sections }: { sections: StorefrontSection[] }) {
  return (
    <>
      {sections
        .filter((s) => s.outcome === "served" && s.items.length > 0)
        .map((s) =>
          s.section_type === "hero_grid" ? (
            <HeroGridSection key={s.placement_id} section={s} />
          ) : (
            <CarouselSection key={s.placement_id} section={s} />
          ),
        )}
    </>
  );
}

function HeroGridSection({ section }: { section: StorefrontSection }) {
  return (
    <section data-testid="slate-section-hero">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {section.items.map((it) => (
          <SeenTracker key={it.id} slateId={section.slate_id} position={it.position}>
            <ProductCard product={it} reason={it.reason} />
          </SeenTracker>
        ))}
      </div>
      <InfiniteFeed
        initialCursor={section.next_cursor ?? null}
        slateId={section.slate_id ?? null}
      />
    </section>
  );
}

function CarouselSection({ section }: { section: StorefrontSection }) {
  return (
    <section className="mt-8" data-testid={`slate-section-${section.section_type}`}>
      <h2 className="text-lg font-semibold mb-3">{section.title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
        {section.items.map((it) => (
          <div key={it.id} className="w-40 shrink-0 snap-start">
            <ProductCard product={it} reason={it.reason} />
          </div>
        ))}
      </div>
    </section>
  );
}
