// src/storefront/pages/product.ts — sections only; the product itself comes from getById in the PDP page
import "server-only";
import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision, type ComposeIdentity } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toSection } from "../map";
import type { StorefrontSection } from "../contract";

export async function productSections(
  identity: ComposeIdentity,
  id: string,
  category: string | null,
  pg: Client,
): Promise<StorefrontSection[]> {
  const surfaceArgs = { pdp_product_id: id, pdp_category: category };
  const page = await composePage({ surface: "pdp", identity, surfaceArgs }, pg);
  const resolved = await resolveSections(page, identity, surfaceArgs, pg);
  await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
  return resolved.map(toSection);
}

export async function getProductSections(id: string, category: string | null): Promise<StorefrontSection[]> {
  const identity = await resolveIdentity();
  return withPg((pg) => productSections(identity, id, category, pg));
}
