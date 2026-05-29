/**
 * Turns raw interaction events into ordered per-session item sequences — the
 * training corpus for Prod2Vec (E1) and the two-tower (E3). Sessions are the
 * "sentences"; co-occurring items are the "context". Pure; deterministic. Within
 * a session, events are ordered by (occurred_at, product_id) and CONSECUTIVE
 * duplicate product ids are collapsed (re-viewing the same item is not a
 * co-occurrence with itself). Sessions are emitted in first-seen order.
 */
export interface EventRow {
  session_id: string;
  product_id: string;
  occurred_at: string;
}

/** @param minLen drop sessions shorter than this (default 1 = keep all). */
export function toSessionSequences(rows: EventRow[], minLen = 1): string[][] {
  const bySession = new Map<string, EventRow[]>();
  for (const r of rows) {
    const arr = bySession.get(r.session_id) ?? [];
    arr.push(r);
    bySession.set(r.session_id, arr);
  }
  const out: string[][] = [];
  for (const [, arr] of bySession) {
    const sorted = arr
      .slice()
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.product_id.localeCompare(b.product_id));
    const seq: string[] = [];
    for (const e of sorted) {
      if (seq.length === 0 || seq[seq.length - 1] !== e.product_id) seq.push(e.product_id);
    }
    if (seq.length >= minLen) out.push(seq);
  }
  return out;
}
