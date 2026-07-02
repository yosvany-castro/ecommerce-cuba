// src/storefront/identity.ts
import "server-only";
import { cookies } from "next/headers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import type { ComposeIdentity } from "@/sectors/f-slate/compose";

export async function resolveIdentity(): Promise<ComposeIdentity> {
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;
  let user_id: string | null = null;
  const session = await auth0.getSession().catch(() => null);
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }
  return { user_id, anonymous_id, session_id };
}
