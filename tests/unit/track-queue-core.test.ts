import { describe, it, expect } from "vitest";
import {
  TrackQueueCore,
  BATCH_MAX,
  QUEUE_CAP,
  ORPHAN_AFTER_MS,
  QUEUE_PREFIX,
  HEARTBEAT_PREFIX,
  type QueueStorage,
  type QueuedEvent,
} from "@/lib/client/track-queue-core";

function memStorage(): QueueStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
    dump: () => Object.fromEntries(m),
  };
}

const ev = (id: string): QueuedEvent => ({
  client_event_id: id,
  event_type: "product_view",
  occurred_at: new Date(0).toISOString(),
  payload: { product_id: id },
});

describe("TrackQueueCore (C4)", () => {
  it("enqueue→takeBatch→ack: los eventos persisten hasta el ack, nunca se pierden en vuelo", () => {
    const s = memStorage();
    const q = new TrackQueueCore(s, "tab1", () => 1000);
    q.enqueue(ev("a"));
    q.enqueue(ev("b"));
    const batch = q.takeBatch();
    expect(batch.map((e) => e.client_event_id)).toEqual(["a", "b"]);
    // sin ack (flush falló): siguen ahí
    expect(q.read()).toHaveLength(2);
    q.ack(["a"]);
    expect(q.read().map((e) => e.client_event_id)).toEqual(["b"]);
  });

  it("takeBatch corta en BATCH_MAX y shouldFlushBySize dispara exactamente ahí", () => {
    const q = new TrackQueueCore(memStorage(), "t", () => 0);
    for (let i = 0; i < BATCH_MAX - 1; i++) q.enqueue(ev(`e${i}`));
    expect(q.shouldFlushBySize()).toBe(false);
    q.enqueue(ev("last"));
    expect(q.shouldFlushBySize()).toBe(true);
    expect(q.takeBatch()).toHaveLength(BATCH_MAX);
  });

  it("cap de almacenamiento: nunca crece sin límite (drop de los más viejos)", () => {
    const q = new TrackQueueCore(memStorage(), "t", () => 0);
    for (let i = 0; i < QUEUE_CAP + 30; i++) q.enqueue(ev(`e${i}`));
    const stored = q.read();
    expect(stored).toHaveLength(QUEUE_CAP);
    expect(stored[0].client_event_id).toBe("e30"); // los 30 más viejos cayeron
  });

  it("adopción de huérfanas: pestaña muerta SÍ, pestaña viva NO, dedupe por client_event_id", () => {
    const s = memStorage();
    const now = ORPHAN_AFTER_MS + 10_000;
    // pestaña muerta (heartbeat viejo) con 2 eventos, uno repetido con la mía
    s.set(`${QUEUE_PREFIX}dead`, JSON.stringify([ev("x"), ev("shared")]));
    s.set(`${HEARTBEAT_PREFIX}dead`, "1");
    // pestaña viva (heartbeat fresco)
    s.set(`${QUEUE_PREFIX}alive`, JSON.stringify([ev("y")]));
    s.set(`${HEARTBEAT_PREFIX}alive`, String(now - 1000));

    const q = new TrackQueueCore(s, "me", () => now);
    q.enqueue(ev("shared"));
    const adopted = q.adoptOrphans();

    expect(adopted).toBe(1); // solo "x" (shared dedupeado)
    const mine = q.read().map((e) => e.client_event_id);
    expect(mine.sort()).toEqual(["shared", "x"]);
    expect(s.get(`${QUEUE_PREFIX}dead`)).toBeNull(); // huérfana consumida
    expect(s.get(`${QUEUE_PREFIX}alive`)).not.toBeNull(); // viva intacta
  });

  it("storage corrupto degrada a cola vacía, jamás explota", () => {
    const s = memStorage();
    s.set(`${QUEUE_PREFIX}t`, "{not json");
    const q = new TrackQueueCore(s, "t", () => 0);
    expect(q.read()).toEqual([]);
    q.enqueue(ev("a"));
    expect(q.read()).toHaveLength(1);
  });
});
