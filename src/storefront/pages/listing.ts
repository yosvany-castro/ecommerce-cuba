// src/storefront/pages/listing.ts — secciones DESTACADAS de los listados
// (categorías y búsqueda): superficie 'search' del slate, colocable por el
// agente (feedback Yosvany 2026-08-13: "en listados debe haber secciones
// destacadas igual que en la home, y que el agente pueda resaltar ahí").
import "server-only";
import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision, type ComposeIdentity } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toSection } from "../map";
import type { StorefrontSection } from "../contract";

export async function listingSections(
  identity: ComposeIdentity,
  category: string | null,
  pg: Client,
): Promise<StorefrontSection[]> {
  // Reusa pdp_category como "categoría del listado": los resolvers que ya
  // saben de categoría (popular pdp_category, etc.) funcionan sin cambios.
  const surfaceArgs = { pdp_category: category };
  const page = await composePage({ surface: "search", identity, surfaceArgs }, pg);
  const resolved = await resolveSections(page, identity, surfaceArgs, pg);
  await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
  return resolved.map(toSection);
}

export async function getListingSections(category: string | null): Promise<StorefrontSection[]> {
  const identity = await resolveIdentity();
  return withPg((pg) => listingSections(identity, category, pg));
}
