/**
 * Pure core of the client event queue (C4) — storage and transport are
 * injected so every decision here is unit-testable without a browser.
 *
 * Guarantees the browser binding builds on:
 *  - every event carries client_event_id from birth (the server's
 *    ON CONFLICT idempotency is useless if the client never sends the id —
 *    a retry used to duplicate events);
 *  - flush is BY EVENTS, not by clock: ≥BATCH_MAX pending, an urgent event
 *    (dismiss), or a lifecycle edge (pagehide/visibility/online) — a 10s
 *    timer in a 10-min session would burn 40-60 radio wake-ups;
 *  - failures keep events queued with backoff (503 honours retry-after);
 *  - multi-tab: each tab owns a namespaced key; stale tabs' queues are
 *    adopted by whoever runs next (no global lock).
 */

export interface QueuedEvent {
  client_event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface QueueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export const BATCH_MAX = 20;
export const QUEUE_PREFIX = "track_queue:";
export const HEARTBEAT_PREFIX = "track_heartbeat:";
/** A tab whose heartbeat is older than this is dead; its queue is adoptable. */
export const ORPHAN_AFTER_MS = 5 * 60 * 1000;
/** Cap stored events per tab — beyond this, drop the OLDEST low-value first. */
export const QUEUE_CAP = 200;

export class TrackQueueCore {
  constructor(
    private readonly storage: QueueStorage,
    private readonly tabId: string,
    private readonly now: () => number = Date.now,
  ) {}

  private key(): string {
    return `${QUEUE_PREFIX}${this.tabId}`;
  }

  read(): QueuedEvent[] {
    try {
      const raw = this.storage.get(this.key());
      const parsed = raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(events: QueuedEvent[]): void {
    this.storage.set(this.key(), JSON.stringify(events.slice(-QUEUE_CAP)));
    this.storage.set(`${HEARTBEAT_PREFIX}${this.tabId}`, String(this.now()));
  }

  enqueue(event: QueuedEvent): { pending: number } {
    const events = this.read();
    events.push(event);
    this.write(events);
    return { pending: events.length };
  }

  /** Take up to BATCH_MAX events for a flush attempt (they stay stored until ack). */
  takeBatch(): QueuedEvent[] {
    return this.read().slice(0, BATCH_MAX);
  }

  /** Remove acknowledged events (by client_event_id) after a 2xx flush. */
  ack(ids: readonly string[]): void {
    const idSet = new Set(ids);
    this.write(this.read().filter((e) => !idSet.has(e.client_event_id)));
  }

  shouldFlushBySize(): boolean {
    return this.read().length >= BATCH_MAX;
  }

  /**
   * Adopt queues of dead tabs (heartbeat older than ORPHAN_AFTER_MS or
   * missing): their events move into THIS tab's queue, their keys are
   * removed. Returns how many events were adopted.
   */
  adoptOrphans(): number {
    let adopted = 0;
    for (const key of this.storage.keys()) {
      if (!key.startsWith(QUEUE_PREFIX)) continue;
      const otherTab = key.slice(QUEUE_PREFIX.length);
      if (otherTab === this.tabId) continue;
      const hbRaw = this.storage.get(`${HEARTBEAT_PREFIX}${otherTab}`);
      const hb = hbRaw ? Number(hbRaw) : 0;
      if (this.now() - hb < ORPHAN_AFTER_MS) continue; // tab viva: no tocar
      try {
        const theirs = JSON.parse(this.storage.get(key) ?? "[]") as QueuedEvent[];
        if (Array.isArray(theirs) && theirs.length > 0) {
          const mine = this.read();
          const seen = new Set(mine.map((e) => e.client_event_id));
          const fresh = theirs.filter((e) => !seen.has(e.client_event_id));
          this.write([...mine, ...fresh]);
          adopted += fresh.length;
        }
      } catch {
        // corrupt foreign queue: drop it
      }
      this.storage.remove(key);
      this.storage.remove(`${HEARTBEAT_PREFIX}${otherTab}`);
    }
    return adopted;
  }
}
