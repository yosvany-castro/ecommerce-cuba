import { test, expect } from "@playwright/test";

const email = process.env.E2E_TEST_USER_EMAIL;
const password = process.env.E2E_TEST_USER_PASSWORD;

// Login propio con Supabase Auth (migrado de Auth0): la página /login es
// nuestra (mismo origen, sin redirects cross-domain). El usuario de prueba se
// siembra con `pnpm exec tsx scripts/seed-auth-user.ts` (service role).
test.describe("Supabase Auth login flow (real)", () => {
  test.skip(!email || !password, "E2E_TEST_USER_* not configured in .env.local");

  test("anonymous → /profile redirige a /login → entra → /profile muestra el email", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForURL(/\/login/);

    await page.getByTestId("auth-email").fill(email!);
    await page.getByTestId("auth-password").fill(password!);
    await page.getByTestId("auth-submit").click();

    // returnTo=/profile: el login vuelve directo al perfil ya autenticado.
    await page.waitForURL(/\/profile/, { timeout: 30_000 });
    await expect(page.getByText(email!)).toBeVisible();
    await expect(page.getByRole("button", { name: /cerrar sesión/i })).toBeVisible();
  });
});
