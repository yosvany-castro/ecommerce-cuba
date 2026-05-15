import { describe, test, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDb, truncateTestTables } from "@/../tests/helpers/db";
import {
  readSessionState,
  persistSessionState,
} from "@/sectors/d-personalization/session/state";
import { applySignalToState } from "@/sectors/d-personalization/session/shift-detection";
import type { EventSignal } from "@/sectors/d-personalization/cohorts/infer";

const femAdulta: EventSignal = {
  cohort_id: "femenino_adulta",
  gender: "femenino",
  age_band: "adulto",
};

beforeEach(async () => {
  await truncateTestTables(["session_vectors"]);
});

describe("session state read/persist", () => {
  test("read returns initial empty state for unseen session_id", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const s = await readSessionState(sid, pg);
      expect(s.current_cohort_id).toBeNull();
      expect(s.current_recipient_id).toBeNull();
      expect(s.signal_window).toEqual([]);
      expect(s.signal_window_size).toBe(0);
    });
  });

  test("persist then read round-trips a single signal", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      const init = await readSessionState(sid, pg);
      const after = applySignalToState(init, femAdulta);
      await persistSessionState(
        sid,
        { ...after, current_recipient_id: null },
        pg,
      );
      const reloaded = await readSessionState(sid, pg);
      expect(reloaded.signal_window_size).toBe(1);
      expect(reloaded.signal_window[0].cohort_id).toBe("femenino_adulta");
      expect(reloaded.current_cohort_id).toBeNull(); // not enough for warmup
    });
  });

  test("warmup completes after 3 signals end-to-end", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      let s = await readSessionState(sid, pg);
      for (let i = 0; i < 3; i++) {
        s = {
          ...applySignalToState(s, femAdulta),
          current_recipient_id: null,
        };
        await persistSessionState(sid, s, pg);
        s = await readSessionState(sid, pg);
      }
      expect(s.current_cohort_id).toBe("femenino_adulta");
      expect(s.signal_window_size).toBe(3);
    });
  });

  test("persist updates updated_at on conflict", async () => {
    await withTestDb(async (pg) => {
      const sid = randomUUID();
      await persistSessionState(
        sid,
        {
          current_cohort_id: null,
          current_recipient_id: null,
          signal_window: [],
          signal_window_size: 0,
        },
        pg,
      );
      const r1 = await pg.query(
        `SELECT updated_at FROM session_vectors WHERE session_id = $1`,
        [sid],
      );
      // small sleep then update
      await new Promise((r) => setTimeout(r, 50));
      await persistSessionState(
        sid,
        {
          current_cohort_id: "femenino_adulta",
          current_recipient_id: null,
          signal_window: [femAdulta],
          signal_window_size: 1,
        },
        pg,
      );
      const r2 = await pg.query(
        `SELECT updated_at, current_cohort_id FROM session_vectors WHERE session_id = $1`,
        [sid],
      );
      expect(new Date(r2.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(r1.rows[0].updated_at).getTime(),
      );
      expect(r2.rows[0].current_cohort_id).toBe("femenino_adulta");
    });
  });
});
