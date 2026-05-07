import { Client } from "pg";
import { getPgClient } from "./pg";
import type { Scope } from "./supabase";

/**
 * Run `fn` with a fresh pg connection (scope = 'public' by default).
 * The connection is closed when `fn` resolves or throws.
 *
 * For long-running operations sharing a connection (e.g. cron pipeline),
 * pass an existing Client directly to the consumer instead of nesting `withPg`.
 */
export async function withPg<T>(
  fn: (pg: Client) => Promise<T>,
  opts: { scope?: Scope } = {},
): Promise<T> {
  const pg = await getPgClient({ scope: opts.scope ?? "public" });
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}
