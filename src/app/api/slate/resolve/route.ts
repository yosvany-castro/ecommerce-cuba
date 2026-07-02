import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { dbHealth } from "@/lib/db/health";
import { cartPage } from "@/storefront/pages/cart";
import { productSections } from "@/storefront/pages/product";
import type { StorefrontSection } from "@/storefront/contract";
import { RequestTiming } from "@/lib/timing";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generic client-side surface resolver (D3): ONE code path for every surface
 * whose context lives in the browser — today the cart (localStorage is the
 * anonymous truth: ids travel in the body) and the PDP cross-sell (lazy,
 * below the fold, doesn't block the product HTML).
 * The home is NOT served here (it is the SSR path).
 * F2: el wiring vive en el DAL (núcleos cartPage/productSections); la identidad
 * AQUÍ sale de req.cookies sin auth0 — semántica original del endpoint
 * (superficies client-side, user_id siempre null).
 */
const bodySchema = z
  .object({
    surface: z.enum(["pdp", "cart"]),
    surface_args: z
      .object({
        pdp_product_id: z.string().regex(UUID_REGEX).optional(),
        pdp_category: z.string().max(120).nullish(),
        cart_product_ids: z.array(z.string().regex(UUID_REGEX)).max(50).optional(),
      })
      .default({}),
  })
  .strict();

export async function POST(req: NextRequest) {
  if (dbHealth() === "down") {
    return NextResponse.json(
      { error: "db_unavailable" },
      { status: 503, headers: { "retry-after": "15" } },
    );
  }

  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session_id = req.cookies.get("session_id")?.value ?? null;
  if (
    (anonymous_id && !UUID_REGEX.test(anonymous_id)) ||
    (session_id && !UUID_REGEX.test(session_id))
  ) {
    return NextResponse.json({ error: "bad_identity" }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const identity = { user_id: null, anonymous_id, session_id };
  const timing = new RequestTiming();
  const served = (ss: StorefrontSection[]) => ss.filter((s) => s.outcome === "served");
  const out = await timing.time("slate_resolve", () =>
    withPg(async (pg) => {
      if (body.surface === "cart") {
        const page = await cartPage(identity, body.surface_args.cart_product_ids ?? [], pg);
        return {
          composition_id: page.composition_id,
          surface: page.surface,
          sections: served(page.sections),
        };
      }
      const sections = await productSections(
        identity,
        body.surface_args.pdp_product_id ?? "",
        body.surface_args.pdp_category ?? null,
        pg,
      );
      return { surface: "pdp" as const, sections: served(sections) };
    }),
  );

  return NextResponse.json(out, {
    headers: { "server-timing": timing.toServerTimingHeader(), "cache-control": "no-store" },
  });
}
