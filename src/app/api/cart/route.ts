import { NextRequest, NextResponse } from "next/server";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import {
  getCartByUserId,
  putCartItem,
  removeCartItem,
  clearCart,
} from "@/sectors/a-tracking/cart-repo";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return null;
  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;
  return await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const items = await withPg((pg) => getCartByUserId(pg, userId));
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.product_id !== "string" || typeof body.quantity !== "number" || body.quantity < 1) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const r = await withPg((pg) =>
    putCartItem(pg, { user_id: userId, product_id: body.product_id, quantity: body.quantity }),
  );
  return NextResponse.json(r);
}

export async function DELETE(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body && typeof body.product_id === "string" && typeof body.quantity === "number" && body.quantity >= 1) {
    await withPg((pg) =>
      removeCartItem(pg, { user_id: userId, product_id: body.product_id, quantity: body.quantity }),
    );
    return NextResponse.json({ ok: true });
  }
  await withPg((pg) => clearCart(pg, userId));
  return NextResponse.json({ ok: true, cleared: true });
}
