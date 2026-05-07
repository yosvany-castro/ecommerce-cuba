import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL;
const password = process.env.E2E_TEST_USER_PASSWORD;

test.describe("Auth0 v4 login flow (real)", () => {
  test.skip(!email || !password, "E2E_TEST_USER_* not configured in .env.local");

  test("anonymous → login → /profile shows user email", async ({ page }) => {

    await page.goto("/profile");
    // middleware redirects to /auth/login then to Auth0 universal login
    await page.waitForURL(/auth0\.com\/u\/login/);

    // Auth0 universal login renders multiple elements matching "password" (input +
    // "show password" toggle button), so use precise role selectors.
    await page.getByRole("textbox", { name: /email/i }).fill(email!);
    await page.getByRole("textbox", { name: /^password$/i }).fill(password!);
    // Auth0 also shows social login buttons (e.g. "Continue with Google") — pick the
    // primary submit button by exact name match.
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Auth0 v4 redirects to APP_BASE_URL (i.e. "/") by default after login because
    // our /profile page redirects to /auth/login WITHOUT a returnTo param.
    // Wait until we're back on the app, then navigate to /profile (session cookie
    // is now set, so the redirect guard passes and the page renders).
    await page.waitForURL((url) => !url.toString().includes("auth0.com"), { timeout: 30_000 });
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: /perfil/i })).toBeVisible();
    await expect(page.getByText(email!)).toBeVisible();
  });
});
