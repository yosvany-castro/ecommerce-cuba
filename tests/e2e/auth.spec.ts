import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL;
const password = process.env.E2E_TEST_USER_PASSWORD;

test.describe("Auth0 v4 login flow (real)", () => {
  test.skip(!email || !password, "E2E_TEST_USER_* not configured in .env.local");

  test("anonymous → login → /profile shows user email", async ({ page }) => {

    await page.goto("/profile");
    // middleware redirects to /auth/login then to Auth0 universal login
    await page.waitForURL(/auth0\.com\/u\/login/);

    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole("button", { name: /continue|log in|iniciar sesión/i }).click();

    // After consent (if any), back to our app at /profile
    await page.waitForURL("**/profile", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /perfil/i })).toBeVisible();
    await expect(page.getByText(email!)).toBeVisible();
  });
});
