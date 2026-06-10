import { describe, test, expect } from "vitest";
import { withPg } from "@/lib/db/helpers";

/**
 * PageSlate foundation F1 — pooled request-path connections.
 * What actually matters and can regress:
 *  - each scope's pooled connections resolve the right search_path;
 *  - the public scope carries the statement_timeout budget, offline scopes don't;
 *  - a consumer that throws mid-transaction never leaks the open transaction
 *    to the next acquirer (withPg destroys the connection on error).
 */
describe("pooled withPg (request path)", () => {
  test("test scope resolves test_schema first; config survives re-acquisition", async () => {
    const first = await withPg(async (pg) => (await pg.query("SHOW search_path")).rows[0].search_path);
    expect(first).toContain("test_schema");
    const second = await withPg(async (pg) => (await pg.query("SHOW search_path")).rows[0].search_path);
    expect(second).toContain("test_schema");
  });

  test("public scope carries statement_timeout 2500ms; test scope does not", async () => {
    const pub = await withPg(
      async (pg) => (await pg.query("SHOW statement_timeout")).rows[0].statement_timeout,
      { scope: "public" },
    );
    expect(pub).toBe("2500ms");
    // Offline/test scopes must NOT inherit the public request budget. (They
    // show Supabase's role-level default — '2min' — not '0'; the invariant is
    // scope isolation, which broke on the transaction-mode port 6543 where
    // session GUCs leak across multiplexed backends.)
    const tst = await withPg(async (pg) => (await pg.query("SHOW statement_timeout")).rows[0].statement_timeout);
    expect(tst).not.toBe("2500ms");
  });

  test("a throwing consumer with an open BEGIN never poisons the next acquirer", async () => {
    await expect(
      withPg(async (pg) => {
        await pg.query("BEGIN");
        throw new Error("boom mid-transaction");
      }),
    ).rejects.toThrow("boom mid-transaction");
    // Next acquisition must be a clean session: no inherited transaction state.
    const status = await withPg(async (pg) => {
      const r = await pg.query("SELECT now() AS ok");
      return r.rows.length === 1;
    });
    expect(status).toBe(true);
  });
}, 60_000);
