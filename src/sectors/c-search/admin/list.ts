import type { Client } from "pg";
import type { SearchMethod } from "../persist/searches";

export interface ListSearchesOpts {
  from?: Date | null;
  to?: Date | null;
  hit_cache?: boolean | null;
  method?: SearchMethod | null;
  page?: number;
  limit?: number;
}

export interface SearchRow {
  id: string;
  anonymous_id: string | null;
  user_id: string | null;
  raw_query: string;
  normalized_json: unknown;
  prompt_version: string | null;
  search_method: SearchMethod;
  results_count: number;
  hit_cache: boolean;
  called_mock: boolean;
  occurred_at: string;
}

export async function listSearches(
  opts: ListSearchesOpts,
  pg: Client,
): Promise<{ rows: SearchRow[]; total: number; page: number; limit: number }> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.from instanceof Date) {
    params.push(opts.from);
    conds.push(`occurred_at >= $${params.length}`);
  }
  if (opts.to instanceof Date) {
    params.push(opts.to);
    conds.push(`occurred_at <= $${params.length}`);
  }
  if (typeof opts.hit_cache === "boolean") {
    params.push(opts.hit_cache);
    conds.push(`hit_cache = $${params.length}`);
  }
  if (opts.method) {
    params.push(opts.method);
    conds.push(`search_method = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const limit = Math.min(opts.limit ?? 50, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const rowParams = [...params, limit, offset];
  const rowsResult = await pg.query(
    `SELECT id, anonymous_id, user_id, raw_query, normalized_json, prompt_version,
            search_method, results_count, hit_cache, called_mock, occurred_at
     FROM searches ${where}
     ORDER BY occurred_at DESC
     LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
    rowParams,
  );
  const totalResult = await pg.query(
    `SELECT count(*)::int AS c FROM searches ${where}`,
    params,
  );

  return { rows: rowsResult.rows, total: totalResult.rows[0].c, page, limit };
}
