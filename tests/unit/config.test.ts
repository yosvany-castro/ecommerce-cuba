import { describe, test, expect } from "vitest";
import { loadConfig } from "@/lib/config";

describe("config", () => {
  test("rejects missing required keys with descriptive error", () => {
    const env = { NODE_ENV: "test" } as Record<string, string | undefined>;
    expect(() => loadConfig(env)).toThrow(/SUPABASE_DB_URL/);
  });

  test("accepts complete env and returns typed shape", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      ANTHROPIC_API_KEY: "sk-ant-test",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    const cfg = loadConfig(env);
    expect(cfg.SUPABASE_DB_URL).toBe("postgres://x");
    expect(cfg.APP_BASE_URL).toBe("http://localhost:3000");
  });

  test("optional SUPABASE_SERVICE_ROLE_KEY is allowed missing", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      ANTHROPIC_API_KEY: "sk-ant-test",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    expect(loadConfig(env).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
