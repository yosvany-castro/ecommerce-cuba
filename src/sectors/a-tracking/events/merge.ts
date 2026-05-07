import type { Client } from "pg";

export interface MergeResult {
  events_merged: number;
}

export async function mergeIdentities(
  anonymousId: string,
  userId: string,
  pg: Client,
): Promise<MergeResult> {
  await pg.query("BEGIN");
  try {
    await pg.query(
      `UPDATE anonymous_sessions SET user_id = $2
       WHERE anonymous_id = $1 AND user_id IS NULL`,
      [anonymousId, userId],
    );
    const r = await pg.query(
      `UPDATE events SET user_id = $2
       WHERE anonymous_id = $1 AND user_id IS NULL
       RETURNING id`,
      [anonymousId, userId],
    );
    await pg.query("COMMIT");
    return { events_merged: r.rowCount ?? 0 };
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}
