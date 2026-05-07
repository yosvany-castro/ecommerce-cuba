import { describe, test, expect } from "vitest";
import { loadConfig } from "@/lib/config";

describe("config", () => {
  test("rejects missing required keys with descriptive error", () => {
    const env = { NODE_ENV: "test" } as Record<string, string | undefined>;
    let caught: Error | null = null;
    try { loadConfig(env); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(Error);
    // Every required key should appear in the error message
    for (const k of [
      "SUPABASE_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "DEEPSEEK_API_KEY", "VOYAGE_API_KEY", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL",
    ]) {
      expect(caught!.message).toContain(k);
    }
    // ANTHROPIC_API_KEY is now optional — must NOT appear in the error message
    expect(caught!.message).not.toContain("ANTHROPIC_API_KEY");
  });

  test("accepts complete env and returns typed shape", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      DEEPSEEK_API_KEY: "ds-test-key",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    const cfg = loadConfig(env);
    // Verify all required fields are present and equal what we passed (ANTHROPIC_API_KEY is optional)
    expect(cfg).toMatchObject({
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      DEEPSEEK_API_KEY: "ds-test-key",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    });
  });

  test("optional keys are allowed missing (SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY)", () => {
    const env = {
      SUPABASE_DB_URL: "postgres://x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      DEEPSEEK_API_KEY: "ds-test-key",
      VOYAGE_API_KEY: "pa-test",
      AUTH0_DOMAIN: "x.auth0.com",
      AUTH0_CLIENT_ID: "cid",
      AUTH0_CLIENT_SECRET: "csec",
      AUTH0_SECRET: "thirty-two-bytes-of-random-chars",
      APP_BASE_URL: "http://localhost:3000",
    };
    const cfg = loadConfig(env);
    expect(cfg.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(cfg.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
