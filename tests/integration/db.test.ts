import { describe, it, expect } from "vitest";
import { getSupabaseClient } from "@/lib/db/supabase";
import { getPgClient } from "@/lib/db/pg";

describe("db clients", () => {
  it("supabase client points to public schema by default and round-trips a query", async () => {
    const sb = getSupabaseClient({ scope: "public" });
    const { error, count } = await sb.from("users").select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(typeof count).toBe("number");
  });

  it("supabase client can be scoped to test_schema", async () => {
    const sb = getSupabaseClient({ scope: "test" });
    const { error } = await sb.from("users").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("pg client respects search_path for the chosen scope", async () => {
    const pg = await getPgClient({ scope: "test" });
    try {
      const res = await pg.query(`SHOW search_path`);
      expect(res.rows[0].search_path).toContain("test_schema");
    } finally {
      await pg.end();
    }
  });
});
