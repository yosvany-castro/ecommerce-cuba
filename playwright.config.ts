import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Load .env.local so E2E tests see the same env vars as integration tests.
// Playwright doesn't auto-load it (Vitest does via tests/helpers/setup.ts).
config({ path: ".env.local" });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // shared test_schema state
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm next dev --turbo",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
