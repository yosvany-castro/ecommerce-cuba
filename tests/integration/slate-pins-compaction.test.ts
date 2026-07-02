import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  insertSlate,
  loadLiveSlate,
  loadSlateById,
  logSlatePageImpressions,
  pinProductInSlate,
  compactSlateForDismiss,
  type SlateItem,
} from "@/sectors/d-personalization/slate/store";

beforeEach(async () => {
  await truncateTestTables(["feed_slates", "feed_impressions"]);
});

function makeItems(ids: string[]): SlateItem[] {
  return ids.map((id, i) => ({ product_id: id, position: i + 1, source: "exploit", propensity: 0.9 }));
}

describe("slate pins + dismiss compaction (C5, sobre filas artesanales — cero API)", () => {
  test("pin: solo productos del slate, idempotente, cap 4", async () => {
    await withTestDb(async (pg) => {
      const session_id = randomUUID();
      const ids = Array.from({ length: 6 }, () => randomUUID());
      const slate_id = randomUUID();
      await insertSlate(
        { slate_id, user_profile_id: null, anonymous_id: null, session_id, surface: "home", items: makeItems(ids), spares: [] },
        pg,
      );

      await pinProductInSlate(session_id, ids[2], pg);
      await pinProductInSlate(session_id, ids[2], pg); // idempotente
      await pinProductInSlate(session_id, randomUUID(), pg); // no está en el slate → no-op
      for (const id of [ids[0], ids[1], ids[3], ids[4]]) {
        await pinProductInSlate(session_id, id, pg);
      }

      const slate = await loadLiveSlate(session_id, "home", pg);
      expect(slate!.pins).toHaveLength(4); // cap
      expect(slate!.pins[0]).toBe(ids[2]);
      expect(slate!.pins).not.toContain(ids[4]); // el 5º no cupo
    });
  });

  test("compactación: solo lo NO servido sale, sin renumerar, spare entra por la cola", async () => {
    await withTestDb(async (pg) => {
      const session_id = randomUUID();
      const ids = Array.from({ length: 5 }, () => randomUUID());
      const spare = randomUUID();
      const slate_id = randomUUID();
      await insertSlate(
        { slate_id, user_profile_id: null, anonymous_id: null, session_id, surface: "home", items: makeItems(ids), spares: [spare] },
        pg,
      );
      const slate = (await loadSlateById(slate_id, pg))!;
      // servidas posiciones 1-2
      await logSlatePageImpressions(slate, slate.items.slice(0, 2), { user_profile_id: null, page_request_id: randomUUID() }, pg);

      // 1) dismiss de un item YA SERVIDO (pos 1): la compactación NO lo toca
      //    (el cliente lo oculta; el historial de exposición es sagrado).
      await compactSlateForDismiss(session_id, ids[0], pg);
      let after = (await loadSlateById(slate_id, pg))!;
      expect(after.items.map((i) => i.product_id)).toContain(ids[0]);

      // 2) dismiss de un item NO servido (pos 4): sale, posiciones intactas
      //    (gap, no renumera — cursors siguen válidos), spare entra al final.
      await compactSlateForDismiss(session_id, ids[3], pg);
      after = (await loadSlateById(slate_id, pg))!;
      const products = after.items.map((i) => i.product_id);
      expect(products).not.toContain(ids[3]);
      expect(products).toContain(spare);
      const positions = after.items.map((i) => i.position).sort((a, b) => a - b);
      expect(positions).toEqual([1, 2, 3, 5, 6]); // gap en 4, spare en 6
      expect(after.spares).toEqual([]);
      expect(after.version).toBe(1); // dismiss NO bumpea versión (eso es shift, Etapa E)
    });
  });
});
