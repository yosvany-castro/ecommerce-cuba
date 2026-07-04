import { test, expect } from "@playwright/test";
import { Client } from "pg";

// La 2ª prueba original ("logged user adds to cart → checkout → success → order
// persisted") se borró: probaba /api/cart PUT + botón "agregar al carrito" + /checkout
// con click directo a "confirmar" + ?order_id= en la URL de éxito. Con Tuki el carrito
// es 100% localStorage (sin PUT /api/cart al agregar, ver src/components/tuki/cart.tsx),
// el PDP no tiene un <button> con ese nombre, y /checkout es un wizard multi-paso
// (envío/pago/factura vía /api/checkout/anonymous) que redirige a
// /checkout/success?order=&m= — ningún selector ni endpoint del test viejo sigue vivo.
// Rehacerla es un e2e de checkout completo aparte, fuera del alcance de este smoke (T13).

test.describe("shopping-flow", () => {
  test("anon home → detail → emits product_view in DB", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator('[data-testid="tuki-card"]').first()).toBeVisible();

    // Set up the response listener BEFORE clicking (so we don't miss the request)
    const trackResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/track") && resp.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="tuki-card"]').first().click();
    // PDP Tuki no usa <h1> (ver ProductView.tsx) — la navegación real es la señal.
    await page.waitForURL(/\/products\//);

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    // Wait for the product_view track call to complete
    await trackResponsePromise;

    const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await c.connect();
    try {
      const r = await c.query(
        `SELECT count(*)::int FROM events WHERE anonymous_id=$1 AND event_type='product_view'`,
        [anonId],
      );
      expect(r.rows[0].count).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
  });
});
