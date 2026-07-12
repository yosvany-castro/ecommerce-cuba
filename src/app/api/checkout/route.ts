import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { createCheckoutOrder } from "@/sectors/a-tracking/checkout";
import { variantSelectionSchema } from "@/sectors/a-tracking/checkout-schema";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El carrito autenticado vive en cart_items (DB) y esa tabla NO tiene
// columnas color/size (ver cart-repo.ts) — items[] es la selección del
// carrito LOCAL (localStorage), opcional, cruzada por product_id contra
// cart_items dentro de createCheckoutOrder. Body ausente o inválido -> sin
// items, checkout sigue con precio base (fail-open, nunca peor que antes).
const bodySchema = z.object({ items: z.array(variantSelectionSchema).max(50).optional() }).strict();

export async function POST(req: NextRequest) {
  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  const session_id = req.cookies.get("session_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id) || !session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }
  const session = await auth0.getSession(req).catch(() => null);
  if (!session?.user?.sub) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  const sub = session.user.sub as string;
  const email = (session.user.email as string) ?? `${sub}@noemail.local`;

  let items: z.infer<typeof bodySchema>["items"];
  try {
    items = bodySchema.parse(await req.json()).items;
  } catch {
    items = undefined;
  }

  try {
    const result = await withPg(async (pg) => {
      const user = await getOrCreateUserByAuth0Sub(pg, sub, email);
      return await createCheckoutOrder(pg, { user_id: user.id, anonymous_id, session_id, items });
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "empty_cart") {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }
    throw e;
  }
}
