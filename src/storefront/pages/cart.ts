// src/storefront/pages/cart.ts
import "server-only";
import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision, type ComposeIdentity } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toPage } from "../map";
import type { StorefrontPage } from "../contract";

export async function cartPage(identity: ComposeIdentity, ids: string[], pg: Client): Promise<StorefrontPage> {
  const surfaceArgs = { cart_product_ids: ids };
  const page = await composePage({ surface: "cart", identity, surfaceArgs }, pg);
  const resolved = await resolveSections(page, identity, surfaceArgs, pg);
  await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
  return toPage(page, resolved, "cart");
}

export async function getCartPage(ids: string[]): Promise<StorefrontPage> {
  const identity = await resolveIdentity();
  return withPg((pg) => cartPage(identity, ids, pg));
}
