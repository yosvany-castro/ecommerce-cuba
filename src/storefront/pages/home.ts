// src/storefront/pages/home.ts
import "server-only";
import type { Client } from "pg";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision, type ComposeIdentity } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { isHoldout } from "@/sectors/d-personalization/holdout";
import { resolveIdentity } from "../identity";
import { toPage } from "../map";
import type { StorefrontPage } from "../contract";

/** Núcleo testeable sin tocar withPg (el checker prohíbe mockear db/helpers). */
export async function homePage(identity: ComposeIdentity, pg: Client): Promise<StorefrontPage> {
  const page = await composePage({ surface: "home", identity }, pg);
  const resolved = await resolveSections(page, identity, undefined, pg);
  const hero = resolved.find((s) => s.section_type === "hero_grid");
  await logSlateDecision(
    page,
    { user_profile_id: null, session_id: identity.session_id, slate_id: hero?.slate_id ?? null, holdout: isHoldout(identity) },
    pg,
  );
  return toPage(page, resolved, "home");
}

export async function getHomePage(): Promise<StorefrontPage> {
  const identity = await resolveIdentity();
  return withPg((pg) => homePage(identity, pg));
}
