// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { StorefrontSection, StorefrontPage } from "./contract";

export function toSection(s: ResolvedSection): StorefrontSection {
  return {
    placement_id: s.placement_id,
    section_type: s.section_type,
    title: s.title,
    display: s.display,
    outcome: s.outcome,
    items: s.items, // SectionCardDTO ≡ StorefrontCard (structural)
    next_cursor: s.next_cursor,
    slate_id: s.slate_id,
  };
}

export function toPage(page: ComposedPage, sections: ResolvedSection[], surface: string): StorefrontPage {
  return { composition_id: page.composition_id, surface, sections: sections.map(toSection) };
}
