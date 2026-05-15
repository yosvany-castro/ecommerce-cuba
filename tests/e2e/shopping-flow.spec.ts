import { test, expect } from "@playwright/test";
import { Client } from "pg";

const HAS_AUTH0_CREDS = !!(process.env.E2E_TEST_USER_EMAIL && process.env.E2E_TEST_USER_PASSWORD);

test.describe("shopping-flow", () => {
  test("anon home → detail → emits product_view in DB", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator('[data-testid="product-card"]').first()).toBeVisible();

    // Set up the response listener BEFORE clicking (so we don't miss the request)
    const trackResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/track") && resp.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="product-card"]').first().click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

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

  test("logged user adds to cart → checkout → success → order persisted", async ({ page }) => {
    test.skip(!HAS_AUTH0_CREDS, "E2E_TEST_USER_* not configured");
    await page.context().clearCookies();
    // Login first
    await page.goto("/auth/login");
    await page.fill('input[name="username"], input[name="email"]', process.env.E2E_TEST_USER_EMAIL!);
    await page.fill('input[name="password"]', process.env.E2E_TEST_USER_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));

    await page.goto("/");
    await page.locator('[data-testid="product-card"]').first().click();
    // Set up the response listener BEFORE clicking add-to-cart
    const cartResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/cart") && resp.request().method() === "PUT" && resp.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: /agregar al carrito/i }).click();
    await cartResponsePromise;

    await page.goto("/checkout");
    await page.getByRole("button", { name: /confirmar/i }).click();
    await page.waitForURL(/\/checkout\/success/);

    const url = new URL(page.url());
    const orderId = url.searchParams.get("order_id");
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);

    const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await c.connect();
    try {
      const o = await c.query(`SELECT status, total_charged_cents FROM orders WHERE id=$1`, [orderId]);
      expect(o.rows[0].status).toBe("pendiente");
      expect(o.rows[0].total_charged_cents).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });
});
