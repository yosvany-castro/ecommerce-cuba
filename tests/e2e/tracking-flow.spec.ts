import { test, expect } from "@playwright/test";
import { Client } from "pg";

const HAS_AUTH0_CREDS = !!(process.env.E2E_TEST_USER_EMAIL && process.env.E2E_TEST_USER_PASSWORD);

async function pg() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  return c;
}

test.describe("tracking-flow", () => {
  test("anonymous visit sets cookies and persists session_start in events", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");

    const cookies = await page.context().cookies();
    const anon = cookies.find((c) => c.name === "anonymous_id");
    const sess = cookies.find((c) => c.name === "session_id");
    expect(anon?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(sess?.value).toMatch(/^[0-9a-f-]{36}$/);

    const c = await pg();
    try {
      const r = await c.query(
        `SELECT event_type FROM events WHERE anonymous_id=$1 AND event_type='session_start'`,
        [anon!.value],
      );
      expect(r.rowCount).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
  });

  test("after login, /api/identity/merge associates events to user_id", async ({ page }) => {
    test.skip(!HAS_AUTH0_CREDS, "E2E_TEST_USER_* not configured");
    await page.context().clearCookies();
    await page.goto("/");
    // Clear any previous merge_done flags so the component always fires
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("merge_done:")) localStorage.removeItem(key);
      }
    });
    const cookies1 = await page.context().cookies();
    const anonId = cookies1.find((c) => c.name === "anonymous_id")!.value;

    // Visit a product detail to generate a product_view event
    const c = await pg();
    const productRow = await c.query(`SELECT id FROM products LIMIT 1`);
    await c.end();
    if (productRow.rows.length === 0) test.skip(true, "no products seeded");
    const productId = productRow.rows[0].id;
    await page.goto(`/products/${productId}`);

    // Login
    await page.goto("/auth/login");
    await page.fill('input[name="username"], input[name="email"]', process.env.E2E_TEST_USER_EMAIL!);
    await page.fill('input[name="password"]', process.env.E2E_TEST_USER_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 30_000 });

    // Wait for client-side merge fetch to complete
    await page.waitForTimeout(4000);

    const c2 = await pg();
    try {
      const r = await c2.query(`SELECT count(*)::int FROM events WHERE anonymous_id=$1 AND user_id IS NOT NULL`, [anonId]);
      expect(r.rows[0].count).toBeGreaterThan(0);
    } finally {
      await c2.end();
    }
  });
});
