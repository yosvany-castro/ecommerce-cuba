import { Client, Pool, type PoolClient } from "pg";
import type { Scope } from "./supabase";

/**
 * DB access layer (PageSlate foundation F1).
 *
 * TWO paths, by workload:
 *
 * - REQUEST PATH (web pages, API routes): `getPooledPg(scope)` / `withPg` —
 *   lazy per-scope pg.Pool. Before this, EVERY request opened a fresh Client
 *   (TCP+TLS handshake ~100-300ms against the Supabase pooler) plus one extra
 *   round-trip for SET search_path. The pool amortizes both: search_path (and
 *   the public-scope statement_timeout) are configured ONCE per pooled
 *   connection, not per request.
 *
 * - OFFLINE PATH (crons, thesis scripts, migrations): `getPgClient(scope)` —
 *   a dedicated Client with no statement_timeout (backfills legitimately run
 *   long) whose lifecycle the caller owns.
 *
 * Pool sizing: max=3 per scope per process. The Supabase free-tier pooler has
 * ~15 backend slots; serverless gives one pool per warm lambda, so small
 * per-process caps are what keeps N lambdas from stampeding it.
 * `allowExitOnIdle` lets vitest/lambdas exit without an explicit pool.end().
 *
 * statement_timeout (public scope only, 2.5s): the real per-query budget —
 * Postgres cancels server-side (error 57014); a client-side race would leave
 * the query running and the connection poisoned. Offline scopes are exempt.
 */

const SEARCH_PATH: Record<Scope, string> = {
  test: "test_schema, public, extensions",
  thesis: "thesis, public, extensions",
  public: "public, extensions",
};

/**
 * Force the SESSION-MODE pooler port. SUPABASE_DB_URL points at Supavisor
 * :6543 (transaction mode), where backends are multiplexed across client
 * sockets PER TRANSACTION — session GUCs (`SET search_path`,
 * `SET statement_timeout`) leak between unrelated connections. Verified
 * empirically here: a public-scope SET statement_timeout appeared on a
 * test-scope connection (tests/integration/db-pool.test.ts). The historical
 * Client-per-request code only worked by low-concurrency backend affinity —
 * a latent production bug (thesis↔public cross-contamination).
 * Session mode (same pooler host, port 5432) pins one backend per socket, so
 * per-connection SETs are actually per-connection. When the SQL layer becomes
 * SET-free (schema-qualified or SET LOCAL per transaction), runtime can move
 * back to 6543 for the bigger client headroom.
 */
function sessionModeUrl(url: string): string {
  return url.replace(":6543/", ":5432/");
}

const PUBLIC_STATEMENT_TIMEOUT_MS = 2_500;

const pools = new Map<Scope, Pool>();
/** Pooled connections already configured (search_path/timeout) — survives re-acquisition. */
const configured = new WeakSet<object>();

function getPool(scope: Scope): Pool {
  let pool = pools.get(scope);
  if (!pool) {
    const url = process.env.SUPABASE_DB_URL;
    if (!url) throw new Error("SUPABASE_DB_URL is required");
    pool = new Pool({
      connectionString: sessionModeUrl(url),
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
      allowExitOnIdle: true,
    });
    // A dead idle connection must never crash the process.
    pool.on("error", (err) => {
      console.warn(`[pg] idle pooled connection error (scope=${scope}):`, err.message);
    });
    pools.set(scope, pool);
  }
  return pool;
}

/**
 * Acquire a pooled connection for the request path. Caller MUST release():
 * prefer `withPg` which handles the lifecycle (and destroys the connection on
 * error so a half-open transaction never leaks to the next acquirer).
 */
export async function getPooledPg(scope: Scope): Promise<PoolClient> {
  const client = await getPool(scope).connect();
  if (!configured.has(client)) {
    const statements = [`SET search_path TO ${SEARCH_PATH[scope]}`];
    if (scope === "public") {
      statements.push(`SET statement_timeout = ${PUBLIC_STATEMENT_TIMEOUT_MS}`);
    }
    await client.query(statements.join("; "));
    configured.add(client);
  }
  return client;
}

/**
 * Dedicated (non-pooled) Client for offline workloads. No statement_timeout.
 * The caller owns the lifecycle (`await client.end()` when done).
 */
export async function getPgClient(opts: { scope?: Scope } = {}): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");
  const client = new Client({ connectionString: sessionModeUrl(url) });
  await client.connect();
  const scope: Scope = opts.scope ?? "public";
  await client.query(`SET search_path TO ${SEARCH_PATH[scope]}`);
  return client;
}
