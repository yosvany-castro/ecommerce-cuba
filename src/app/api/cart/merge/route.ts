import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { mergeLocalCartIntoUser } from "@/sectors/a-tracking/cart-repo";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;

  const result = await withPg(async (pg) => {
    const user = await getOrCreateUserByAuth0Sub(pg, sub, email);
    return await mergeLocalCartIntoUser(pg, user.id, body);
  });
  return NextResponse.json(result);
}
