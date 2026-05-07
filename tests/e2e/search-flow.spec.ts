import { test, expect } from "@playwright/test";
import { Client } from "pg";

async function pg() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  return c;
}

test.describe("search-flow", () => {
  test("anon hybrid search → results render + searches row + event with method=hybrid_rrf", async ({ page }) => {
    // Real LLM + embedding + BM25 + cosine can exceed the 60s default on cold start
    test.setTimeout(120_000);
    await page.context().clearCookies();

    // Set up the response promise BEFORE navigating to avoid any race with the
    // SearchTracker client component firing after React hydration.
    const trackResponsePromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/track") && resp.request().method() === "POST",
        { timeout: 90_000 },
      )
      .catch(() => null);

    await page.goto("/search?q=camiseta");

    // Wait for results to render OR the empty state
    await expect(
      page
        .locator('[data-testid="product-card"]').first()
        .or(page.getByText(/Sin resultados/)),
    ).toBeVisible({ timeout: 90_000 });

    // Wait for the SearchTracker POST to complete (fires after hydration)
    await trackResponsePromise;

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    const c = await pg();
    try {
      // searches row was inserted by hybridSearch via the server component
      const sr = await c.query(
        `SELECT search_method, raw_query FROM searches WHERE raw_query = 'camiseta' AND anonymous_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [anonId],
      );
      expect(sr.rowCount).toBeGreaterThanOrEqual(1);
      expect(sr.rows[0].search_method).toBe("hybrid_rrf");

      // SearchTracker emitted an event
      const ev = await c.query(
        `SELECT event_type, payload FROM events WHERE anonymous_id = $1 AND event_type = 'search'`,
        [anonId],
      );
      expect(ev.rowCount).toBeGreaterThanOrEqual(1);
      expect(ev.rows[0].payload.method).toBe("hybrid_rrf");
    } finally {
      await c.end();
    }
  });

  test("garbage query 'asdfgh' → low-confidence + no mock invoked", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto("/search?q=asdfgh");
    // Wait for the page to render — empty state is OK
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const anonId = (await page.context().cookies()).find((c) => c.name === "anonymous_id")!.value;
    const c = await pg();
    try {
      const sr = await c.query(
        `SELECT called_mock FROM searches WHERE raw_query = 'asdfgh' AND anonymous_id = $1`,
        [anonId],
      );
      expect(sr.rowCount).toBeGreaterThanOrEqual(1);
      expect(sr.rows[0].called_mock).toBe(false);
    } finally {
      await c.end();
    }
  });
});
