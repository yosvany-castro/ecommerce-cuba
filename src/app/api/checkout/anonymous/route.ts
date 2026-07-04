import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbHealth } from "@/lib/db/health";
import { withPg } from "@/lib/db/helpers";
import { createAnonymousOrder } from "@/sectors/a-tracking/checkout-anonymous";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    items: z
      .array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(999) }))
      .min(1)
      .max(50),
    shipping: z
      .object({
        nombre: z.string().min(1),
        ci: z.string().regex(/^\d{6,}$/),
        tel: z.string().min(1),
        dir: z.string().min(1),
        ciudad: z.string().min(1),
        cp: z.string().optional(),
        metodo: z.enum(["rapido", "estandar", "lento"]),
        pago: z.enum(["tarjeta", "efectivo", "transfer"]),
        factura: z
          .object({
            razon: z.string(),
            rfc: z.string(),
            correo: z.string(),
            dirf: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export async function POST(req: NextRequest) {
  // Breaker F4: con la DB caída, 503 inmediato (no quemar el connect timeout).
  if (dbHealth() === "down") {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "15" } });
  }

  const anonymous_id = req.cookies.get("anonymous_id")?.value;
  const session_id = req.cookies.get("session_id")?.value;
  if (!anonymous_id || !UUID_REGEX.test(anonymous_id) || !session_id || !UUID_REGEX.test(session_id)) {
    return NextResponse.json({ error: "no_identity" }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const result = await withPg((pg) =>
      createAnonymousOrder(pg, {
        anonymous_id,
        session_id,
        items: body.items,
        shipping: body.shipping,
      }),
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "empty_cart") {
      return NextResponse.json({ error: "empty_cart" }, { status: 400 });
    }
    throw e;
  }
}
