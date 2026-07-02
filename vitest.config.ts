import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/setup.ts"],
    testTimeout: 30_000, // integration tests hit real APIs
    hookTimeout: 30_000,
    pool: "forks",
    maxWorkers: 1, // serial: shared test_schema state (vitest 4: top-level, replaces poolOptions.forks.singleFork)
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/sectors/**/*.ts"],
      exclude: ["**/*.test.ts", "**/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" real lanza fuera de React Server; en tests es un no-op.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
});
