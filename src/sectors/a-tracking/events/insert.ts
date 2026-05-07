import type { Client } from "pg";
import { validatePayload, type EventInput, type EventType } from "./schema";

export interface InsertEventCtx {
  pg: Client;
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
  source?: string | null;
}

export interface InsertEventResult {
  event_id: string | null;
  deduped: boolean;
}

export async function insertEvent(
  input: EventInput,
  ctx: InsertEventCtx,
): Promise<InsertEventResult> {
  // Validate payload against the schema for this event_type.
  const payload = validatePayload(input.event_type as EventType, input.payload);

  // Idempotent insert: ON CONFLICT (client_event_id) DO NOTHING — only effective when client_event_id is non-null.
  // Without client_event_id, inserts always succeed (duplicates allowed; that's a "best effort" event).
  const sql = `
    INSERT INTO events
      (client_event_id, anonymous_id, user_id, session_id, event_type, occurred_at, payload, source)
    VALUES
      ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8)
    ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;
  const r = await ctx.pg.query(sql, [
    input.client_event_id ?? null,
    ctx.anonymous_id,
    ctx.user_id,
    ctx.session_id,
    input.event_type,
    input.occurred_at,
    JSON.stringify(payload),
    ctx.source ?? null,
  ]);
  if (r.rows.length === 0) {
    return { event_id: null, deduped: true };
  }
  return { event_id: r.rows[0].id, deduped: false };
}
