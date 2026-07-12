import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, getOrCreateUserBySub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { mergeLocalCartIntoUser } from "@/sectors/a-tracking/cart-repo";

export async function POST(req: NextRequest) {
  const session = await getAuthUser();
  if (!session?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const sub = session.sub;
  const email = session.email ?? `${sub}@noemail.local`;

  const result = await withPg(async (pg) => {
    const user = await getOrCreateUserBySub(pg, sub, email);
    return await mergeLocalCartIntoUser(pg, user.id, body);
  });
  return NextResponse.json(result);
}
