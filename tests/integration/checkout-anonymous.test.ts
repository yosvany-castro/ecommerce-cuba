import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import { seedProduct } from "@/../tests/helpers/seed";
import { POST } from "@/app/api/checkout/anonymous/route";

beforeEach(async () => {
  await truncateTestTables([
    "events",
    "order_items",
    "orders",
    "products",
    "users",
    "anonymous_sessions",
    "purchase_attributions",
    "excluded_products",
  ]);
});

function makeReq(body: unknown, cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);
  return new NextRequest("http://localhost:3000/api/checkout/anonymous", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const shipping = {
  nombre: "Dani Torres",
  ci: "12345678",
  tel: "55 1234 5678",
  dir: "Av. Siempre Viva 742",
  ciudad: "Ciudad de México",
  cp: "06100",
  metodo: "estandar" as const,
  pago: "tarjeta" as const,
};

describe("POST /api/checkout/anonymous", () => {
  test("crea orden real, evento purchase y user demo| — precio re-leído de products", async () => {
    await withTestDb(async (pg) => {
      const anonId = randomUUID();
      const sessionId = randomUUID();
      const product = await seedProduct(pg, { title: "Camiseta", price_cents: 2500 });

      const res = await POST(
        makeReq(
          // precio del cliente ignorado: el body NO tiene campo price; el server re-lee 2500.
          { items: [{ product_id: product.id, quantity: 2 }], shipping },
          { anonymous_id: anonId, session_id: sessionId },
        ),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.order_id).toMatch(/^[0-9a-f-]{36}$/);

      const order = (await pg.query(`SELECT * FROM orders WHERE id=$1`, [body.order_id])).rows[0];
      expect(order.status).toBe("pendiente");
      expect(order.total_charged_cents).toBe(5000); // 2500 * 2, re-leído del catálogo
      expect(order.shipping).not.toBeNull();
      expect(order.shipping.ci).toBe("12345678");
      expect(order.shipping.metodo).toBe("estandar");

      const user = (await pg.query(`SELECT auth0_sub, email FROM users WHERE id=$1`, [order.user_id])).rows[0];
      expect(user.auth0_sub).toBe(`demo|${anonId}`);
      expect(user.email).toBe(`demo+${anonId}@tuki.local`);

      const items = (await pg.query(`SELECT product_id, quantity, unit_price_cents FROM order_items WHERE order_id=$1`, [body.order_id])).rows;
      expect(items).toHaveLength(1);
      expect(items[0].product_id).toBe(product.id);
      expect(items[0].quantity).toBe(2);
      expect(items[0].unit_price_cents).toBe(2500);

      const ev = (await pg.query(`SELECT payload FROM events WHERE event_type='purchase' AND anonymous_id=$1`, [anonId])).rows;
      expect(ev).toHaveLength(1);
      expect(ev[0].payload.order_id).toBe(body.order_id);
      expect(ev[0].payload.total_cents).toBe(5000);
    });
  });

  test("sin items → 400 bad_request", async () => {
    const res = await POST(makeReq({ items: [], shipping }, { anonymous_id: randomUUID(), session_id: randomUUID() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  test("sin cookies de identidad → 400 no_identity", async () => {
    const product_id = randomUUID();
    const res = await POST(makeReq({ items: [{ product_id, quantity: 1 }], shipping }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_identity");
  });
});
