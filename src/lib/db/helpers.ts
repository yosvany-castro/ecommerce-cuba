import { Client } from "pg";
import { getPgClient, getPooledPg } from "./pg";
import { reportDbFailure, reportDbSuccess } from "./health";
import type { Scope } from "./supabase";

/**
 * Run `fn` with a POOLED connection (request path: pages, API routes).
 * The connection is released back to the pool when `fn` resolves; if `fn`
 * throws, the connection is DESTROYED instead of released — a consumer that
 * died mid-transaction (BEGIN without COMMIT/ROLLBACK, e.g. checkout.ts) must
 * never leak its open transaction to the next acquirer.
 *
 * Consumers receive the client typed as `Client` for compatibility with the
 * existing signatures across sectors; the contract is unchanged: use
 * `pg.query(...)` only — NEVER call `pg.end()` inside `fn` (the pool owns the
 * socket lifecycle).
 */
export async function withPg<T>(
  fn: (pg: Client) => Promise<T>,
  opts: { scope?: Scope } = {},
): Promise<T> {
  // In test environments (Vitest), route handlers called directly should also
  // resolve against test_schema so seeds from withTestDb are visible.
  const defaultScope: Scope = process.env.VITEST ? "test" : "public";
  let client;
  try {
    client = await getPooledPg(opts.scope ?? defaultScope);
  } catch (e) {
    reportDbFailure(e); // acquisition failures are the breaker's main signal
    throw e;
  }
  let ok = false;
  try {
    const result = await fn(client as unknown as Client);
    ok = true;
    reportDbSuccess();
    return result;
  } catch (e) {
    reportDbFailure(e); // only connection-class errors count (see health.ts)
    throw e;
  } finally {
    // release(true) destroys the socket (error path); release() returns it.
    client.release(ok ? undefined : true);
  }
}

/**
 * Run `fn` with a DEDICATED (non-pooled) connection — offline workloads:
 * crons, backfills, eval scripts. No statement_timeout; closed on completion.
 */
export async function withPgDirect<T>(
  fn: (pg: Client) => Promise<T>,
  opts: { scope?: Scope } = {},
): Promise<T> {
  const defaultScope: Scope = process.env.VITEST ? "test" : "public";
  const pg = await getPgClient({ scope: opts.scope ?? defaultScope });
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}
