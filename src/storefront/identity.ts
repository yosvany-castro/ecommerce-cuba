// src/storefront/identity.ts
import "server-only";
import { cookies } from "next/headers";
import { getAuthUser, getOrCreateUserBySub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import type { ComposeIdentity } from "@/sectors/f-slate/compose";

export async function resolveIdentity(): Promise<ComposeIdentity> {
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;
  let user_id: string | null = null;
  const session = await getAuthUser();
  if (session?.sub) {
    const sub = session.sub;
    const email = session.email ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserBySub(pg, sub, email)).id);
  }
  return { user_id, anonymous_id, session_id };
}
