import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { sampleBehavior } from "@/thesis/data/behavior-model";
import type { ComplementsBySource } from "@/thesis/data/behavior-model";
import { buildRelations } from "@/thesis/data/relations-model";

/** Build the GT complement adjacency the generator consumes (F0 spec §4.4). */
function complementMap(cat: ReturnType<typeof sampleCatalog>): ComplementsBySource {
  const map = new Map<string, string[]>();
  for (const rel of buildRelations(cat)) {
    if (rel.relation_type !== "complement") continue;
    const arr = map.get(rel.product_a_id) ?? [];
    arr.push(rel.product_b_id);
    map.set(rel.product_a_id, arr);
  }
  return map;
}

describe("sampleBehavior", () => {
  test("full output is deterministic by seed (users, sessions, holdout)", () => {
    const cat = sampleCatalog(300, 1);
    const a = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    const b = sampleBehavior(cat, { users: 25, days: 45, seed: 77 });
    expect(a.users).toEqual(b.users);
    expect(a.sessions).toEqual(b.sessions);
    expect(a.holdout).toEqual(b.holdout);
  });

  test("produces users, sessions, events and a holdout test split", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 30, days: 30, seed: 8 });
    expect(out.users.length).toBe(30);
    expect(out.sessions.length).toBeGreaterThan(0);
    expect(out.events.length).toBeGreaterThan(0);
    expect(out.holdout.some((h) => h.split === "test")).toBe(true);
  });

  test("gift sessions reference a recipient; ids are valid uuids", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 40, days: 30, seed: 9, pGiftOverride: 1.0 });
    const gift = out.sessions.filter((s) => s.intent === "gift");
    expect(gift.length).toBeGreaterThan(0);
    for (const s of gift.slice(0, 10)) expect(s.recipient_id === null).toBe(false);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuidRe.test(out.users[0].user_id)).toBe(true);
    expect(uuidRe.test(out.sessions[0].session_id)).toBe(true);
  });

  test("a self-shopper's events concentrate in their taste subcategories", () => {
    const cat = sampleCatalog(500, 4);
    const out = sampleBehavior(cat, { users: 1, days: 60, seed: 21, pGiftOverride: 0.0 });
    const u = out.users[0];
    const tasteSubs = new Set(u.latent_state.tasteSubcategories);
    const evSubs = out.events
      .filter((e) => e.event_type === "product_view")
      .map((e) => cat.find((p) => p.source_product_id === e.product_id)?.attrs.subcategory);
    const inTaste = evSubs.filter((s) => s && tasteSubs.has(s)).length;
    expect(inTaste / Math.max(1, evSubs.length)).toBeGreaterThan(0.5);
  });

  test("test-holdout products are a subset of the user's purchases", () => {
    const cat = sampleCatalog(400, 2);
    const out = sampleBehavior(cat, { users: 30, days: 60, seed: 15 });
    const purchasesByUser = new Map<string, Set<string>>();
    for (const e of out.events) {
      if (e.event_type !== "purchase") continue;
      const s = purchasesByUser.get(e.user_id) ?? new Set<string>();
      s.add(e.product_id);
      purchasesByUser.set(e.user_id, s);
    }
    for (const h of out.holdout) {
      expect((purchasesByUser.get(h.user_id) ?? new Set()).has(h.product_id)).toBe(true);
    }
  });

  test("test holdout is strictly after train and shares no product with train (per user)", () => {
    const cat = sampleCatalog(400, 2);
    const out = sampleBehavior(cat, { users: 40, days: 60, seed: 15 });
    const byUser = new Map<string, { train: typeof out.holdout; test: typeof out.holdout }>();
    for (const h of out.holdout) {
      const e = byUser.get(h.user_id) ?? { train: [], test: [] };
      (h.split === "test" ? e.test : e.train).push(h);
      byUser.set(h.user_id, e);
    }
    for (const [, e] of byUser) {
      if (e.test.length === 0) continue;
      expect(e.train.length).toBeGreaterThan(0);
      const maxTrain = Math.max(...e.train.map((h) => Date.parse(h.occurred_at)));
      const minTest = Math.min(...e.test.map((h) => Date.parse(h.occurred_at)));
      expect(minTest > maxTrain).toBe(true);
      const trainProducts = new Set(e.train.map((h) => h.product_id));
      for (const t of e.test) expect(trainProducts.has(t.product_id)).toBe(false);
    }
  });

  test("seeded GT complements co-occur with their anchor in the same session (§4.4)", () => {
    const cat = sampleCatalog(800, 5);
    const comps = complementMap(cat);
    expect(comps.size).toBeGreaterThan(0);
    // Self-only sessions so complement seeding (which targets self sessions) fires.
    const out = sampleBehavior(cat, { users: 60, days: 60, seed: 99, pGiftOverride: 0.0 }, comps);

    // Group viewed products per session.
    const viewsBySession = new Map<string, Set<string>>();
    for (const ev of out.events) {
      if (ev.event_type !== "product_view") continue;
      const s = viewsBySession.get(ev.session_id) ?? new Set<string>();
      s.add(ev.product_id);
      viewsBySession.set(ev.session_id, s);
    }

    // Count sessions where some anchor and one of its GT complements co-occur.
    let coOccurringSessions = 0;
    for (const [, viewed] of viewsBySession) {
      let hit = false;
      for (const anchor of viewed) {
        const targets = comps.get(anchor);
        if (!targets) continue;
        if (targets.some((t) => viewed.has(t))) {
          hit = true;
          break;
        }
      }
      if (hit) coOccurringSessions++;
    }
    expect(coOccurringSessions).toBeGreaterThan(0);
  });

  test("complement seeding is deterministic by seed", () => {
    const cat = sampleCatalog(400, 5);
    const comps = complementMap(cat);
    const a = sampleBehavior(cat, { users: 30, days: 45, seed: 123 }, comps);
    const b = sampleBehavior(cat, { users: 30, days: 45, seed: 123 }, comps);
    expect(a.events).toEqual(b.events);
    expect(a.holdout).toEqual(b.holdout);
  });

  test("gift-session views match the recipient's gender (or unisex)", () => {
    const cat = sampleCatalog(500, 3);
    const out = sampleBehavior(cat, { users: 40, days: 30, seed: 31, pGiftOverride: 1.0 });
    const prodById = new Map(cat.map((p) => [p.source_product_id, p]));
    const recipById = new Map<string, { gender: string }>();
    for (const u of out.users) for (const r of u.recipients) recipById.set(r.id, { gender: r.gender });
    const sessById = new Map(out.sessions.map((s) => [s.session_id, s]));
    let total = 0;
    let match = 0;
    for (const ev of out.events) {
      if (ev.event_type !== "product_view") continue;
      const sess = sessById.get(ev.session_id);
      if (!sess || sess.intent !== "gift" || !sess.recipient_id) continue;
      const recip = recipById.get(sess.recipient_id);
      const prod = prodById.get(ev.product_id);
      if (!recip || !prod) continue;
      total++;
      if (prod.attrs.gender === recip.gender || prod.attrs.gender === "unisex") match++;
    }
    expect(total).toBeGreaterThan(0);
    expect(match / total).toBeGreaterThan(0.6);
  });
});
