// tests/e2e/tuki-smoke.spec.ts — smoke e2e de la UI Tuki: home, búsqueda y carrito (T13).
import { expect, test } from "@playwright/test";

test("home Tuki renderiza feed real", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("tuki").first()).toBeVisible();
  await expect(page.locator("[data-testid=tuki-card]").first()).toBeVisible({ timeout: 15000 });
});

test("búsqueda two-phase muestra resultados", async ({ page }) => {
  await page.goto("/");
  // "camiseta" es palabra real de título en el catálogo sembrado (evita depender del
  // proveedor mock/negative-cache para que la card aparezca).
  await page.getByPlaceholder("Busca lo que sea…").fill("camiseta");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/resultados|buscando/i).first()).toBeVisible({ timeout: 10000 });
  // Two-phase: si called_mock, el loader teatral dura ~4.2s + re-fetch — timeout generoso.
  await expect(page.locator("[data-testid=tuki-card]").first()).toBeVisible({ timeout: 30000 });
});

test("agregar al carro y abrir drawer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-testid=tuki-card-add]").first()).toBeVisible({ timeout: 15000 });
  await page.locator("[data-testid=tuki-card-add]").first().click();
  await page.locator("[data-testid=tuki-cart-btn]").click();
  await expect(page.locator("[data-testid=tuki-cart-drawer]")).toBeVisible();
  await expect(page.getByText(/envío gratis|Ir a pagar/i).first()).toBeVisible();
});
