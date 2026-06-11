import type { Client } from "pg";

/**
 * Impression logging de carruseles (Fase 2 C1b). Cierra el gap solo-hero: las
 * secciones no-hero materializaban ids sin dejar rastro en feed_impressions,
 * así que su funnel era inmedible. Claves del contrato:
 * - feed_request_id = composition_id (el hero usa slate_id; la fila gemela de
 *   logSlateDecision hace que ambos joineen slate_decisions igual).
 * - position = slot*100 + (idx+1): único dentro del composition_id sin chocar
 *   entre secciones (slots distintos).
 * - placement_version SÍ se escribe (en el hero jamás se escribe — gap A4).
 * - seen_at queda NULL hasta el beacon cliente (deuda declarada: el report
 *   marca estos placements con no_seen_tracking).
 */

export interface SectionImpressionRow {
  position: number; // slot*100 + (idx+1) — único dentro del composition_id
  product_id: string;
  section_type: string;
  placement_version: number;
}

export async function logSectionImpressions(
  args: {
    composition_id: string;
    session_id: string | null;
    user_profile_id: string | null;
    page_request_id: string | null;
    rows: SectionImpressionRow[];
  },
  pg: Client,
): Promise<void> {
  if (args.rows.length === 0) return;
  try {
    await pg.query(
      `INSERT INTO feed_impressions
         (feed_request_id, user_profile_id, session_id, position, product_id,
          source, propensity, page_request_id, section_id, placement_version, policy)
       SELECT $1, $2, $3, u.position, u.product_id::uuid, 'exploit', 1.0, $4,
              u.section_type, u.placement_version, 'default'
       FROM unnest($5::smallint[], $6::text[], $7::text[], $8::int[])
         AS u(position, product_id, section_type, placement_version)
       ON CONFLICT (feed_request_id, position) DO NOTHING`,
      [
        args.composition_id,
        args.user_profile_id,
        args.session_id,
        args.page_request_id,
        args.rows.map((x) => x.position),
        args.rows.map((x) => x.product_id),
        args.rows.map((x) => x.section_type),
        args.rows.map((x) => x.placement_version),
      ],
    );
  } catch (e) {
    // Fire-and-forget contract: logging never fails a page.
    console.warn("[slate] section impression logging failed (page unaffected):", e);
  }
}
