/**
 * Infinite-scroll cursor: `{slate_id, pos, v}` — slate identity, last served
 * ABSOLUTE position (positions never restart per page: the examination curve
 * θ̂(p) and OPE depend on absolute depth), and the slate version (dismiss/shift
 * bumps invalidate outstanding cursors).
 *
 * base64url JSON. NOT a capability: the server always re-checks that the
 * slate belongs to the caller's session cookie — a forged/foreign cursor just
 * degrades to transparent regeneration, never to another user's slate.
 * Decode is fail-null (a corrupt cursor is a regeneration, never a 500).
 */

export interface FeedCursor {
  slate_id: string;
  pos: number;
  v: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || raw.length > 300) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as FeedCursor;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.slate_id !== "string" ||
      !UUID_REGEX.test(parsed.slate_id) ||
      !Number.isInteger(parsed.pos) ||
      parsed.pos < 0 ||
      parsed.pos > 10_000 ||
      !Number.isInteger(parsed.v) ||
      parsed.v < 1
    ) {
      return null;
    }
    return { slate_id: parsed.slate_id, pos: parsed.pos, v: parsed.v };
  } catch {
    return null;
  }
}
