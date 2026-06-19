import type { BehaviorOutput } from "@/thesis/data/behavior-model";
import { EPOCH_DAYS } from "./constants";
import type { SimPlacementStore } from "./store";
import type { World } from "./world";
import type { SessionExposure } from "./policy";

/**
 * Log de observación + ledger del gate (blueprint §5.9).
 *
 * GROUND TRUTH del gate = purchases[] (margen realizado del funnel del
 * generador, TODO el brazo incluyendo orgánicas — anti-trampa #14). La capa de
 * métricas (sim-metrics-source) LEE este mismo log, pero el veredicto JAMÁS
 * pasa por ella (A4 §6.4): realizedMarginCents suma directo del ledger.
 * PROHIBIDO importar src/thesis/objectives/ aquí o en el harness (grep-gate
 * anti-trampa #3).
 */

const DAY_MS = 86_400_000;

export interface SimEventRow {
  epoch: number;
  session_id: string;
  user_id: string;
  event_type: "product_view" | "add_to_cart" | "purchase";
  product_id: string;
  occurred_at: Date;
}

export interface SimImpression {
  epoch: number;
  feed_request_id: string;
  session_id: string;
  user_id: string;
  position: number; // 1-based dentro del slate
  product_id: string;
  section_id: string | null; // null ≡ legacy_feed (solo fixtures)
  placement_id: string | null;
  placement_version: number | null;
  policy: string; // 'default' | 'holdout'
  surface: string | null;
  source: "exploit" | "explore";
  propensity: number;
  served_at: Date;
  seen_at: Date | null;
}

export interface SimPurchase {
  epoch: number;
  session_id: string;
  product_id: string;
  feed_request_id: string | null; // null = orgánica
  position: number | null;
  policy: string | null;
  seen: boolean;
  unit_price_cents: number;
  quantity: number;
  attributed_at: Date;
  attributed_placement_id: string | null;
  margin_pct: number;
}

export interface ArmLog {
  events: SimEventRow[];
  impressions: SimImpression[];
  purchases: SimPurchase[];
}

export interface ArmState {
  name: string;
  store: SimPlacementStore;
  log: ArmLog;
}

export function makeArm(name: string, store: SimPlacementStore): ArmState {
  return { name, store, log: { events: [], impressions: [], purchases: [] } };
}

/**
 * Ingesta de una época simulada al log del brazo: corrimiento temporal
 * (+t×14d sobre el reloj del generador), reconstrucción de `seen` por prefijo
 * de cascada, y atribución de compra espejo de a-tracking/attribution.ts
 * (última impresión del producto en la sesión, si no en 7d del usuario;
 * sin impresión ⇒ orgánica con columnas feed NULL).
 */
export function ingestEpoch(args: {
  arm: ArmState;
  out: BehaviorOutput;
  /** null = época orgánica (e0): sin impresiones, todas las compras orgánicas. */
  exposures: SessionExposure[] | null;
  world: World;
  epoch: number;
}): void {
  const { arm, out, exposures, world, epoch } = args;
  const journey = out.journeyExposures ?? null;
  const shiftMs = epoch * EPOCH_DAYS * DAY_MS;
  const at = (iso: string): Date => new Date(Date.parse(iso) + shiftMs);

  if (exposures !== null && journey !== null) {
    throw new Error("ingestEpoch: pass either exposures (exposurePolicy) or journeyExposures, not both");
  }
  if (exposures !== null && exposures.length !== out.sessions.length) {
    throw new Error(
      `exposure/session mismatch: ${exposures.length} exposures vs ${out.sessions.length} sessions`,
    );
  }
  if (journey !== null && journey.length !== out.sessions.length) {
    throw new Error(
      `journey/session mismatch: ${journey.length} journeyExposures vs ${out.sessions.length} sessions`,
    );
  }

  // Vistas por sesión en orden de generación (los events ya vienen ordenados).
  const viewsBySession = new Map<string, { pid: string; at: Date }[]>();
  for (const e of out.events) {
    if (e.event_type !== "product_view") continue;
    const a = viewsBySession.get(e.session_id) ?? [];
    a.push({ pid: e.product_id, at: at(e.occurred_at) });
    viewsBySession.set(e.session_id, a);
  }

  // ── Impresiones (épocas con exposición). ──
  const newImpressions: SimImpression[] = [];
  if (journey !== null) {
    // ── Régimen multi-superficie (journeyPolicy, spec §10). ──
    // El generador YA produjo las impresiones de TODAS las superficies con su
    // flag `examined`; aquí solo se les pone served_at/seen_at y un
    // feed_request_id ÚNICO POR RENDER (cada superficie renderizada = un feed
    // request real). Render boundary = position vuelve a 1.
    for (let i = 0; i < out.sessions.length; i++) {
      const session = out.sessions[i];
      const exp = journey[i];
      const servedAt = at(session.started_at);
      // Las vistas se emiten en EL MISMO orden que las impresiones examinadas
      // (home→pdp→cart, posición ASC): se consumen 1:1 para el seen_at real.
      const views = viewsBySession.get(session.session_id) ?? [];
      let vCursor = 0;
      let renderSeq = -1;
      for (const imp of exp.impressions) {
        if (imp.position === 1) renderSeq += 1; // nueva superficie renderizada
        let seenAt: Date | null = null;
        if (imp.examined) {
          // Empareja con la siguiente vista del producto en orden de render.
          while (vCursor < views.length && views[vCursor].pid !== imp.product_id) vCursor++;
          seenAt = vCursor < views.length ? views[vCursor].at : servedAt;
          if (vCursor < views.length) vCursor++;
        }
        newImpressions.push({
          epoch,
          feed_request_id: `sl-${arm.name}-${epoch}-${i}-${imp.surface}-${renderSeq}`,
          session_id: session.session_id,
          user_id: session.user_id,
          position: imp.position,
          product_id: imp.product_id,
          section_id: imp.section_type,
          placement_id: imp.placement_id,
          placement_version: imp.placement_version,
          policy: exp.policyArm,
          surface: imp.surface,
          source: imp.source,
          propensity: imp.propensity,
          served_at: servedAt,
          seen_at: seenAt,
        });
      }
    }
  } else if (exposures !== null) {
    for (let i = 0; i < out.sessions.length; i++) {
      const session = out.sessions[i];
      const exp = exposures[i];
      const servedAt = at(session.started_at);
      const slateId = `sl-${arm.name}-${epoch}-${i}`;
      const views = viewsBySession.get(session.session_id) ?? [];
      // Prefijo examinado del cascade: las primeras vistas de la sesión SON el
      // prefijo del slate en orden (basket = resolved.slice(0, examinados)).
      let k = 0;
      const seenAt: (Date | null)[] = exp.items.map(() => null);
      while (k < exp.items.length && k < views.length && views[k].pid === exp.items[k].product_id) {
        seenAt[k] = views[k].at;
        k++;
      }
      exp.items.forEach((item, idx) => {
        newImpressions.push({
          epoch,
          feed_request_id: slateId,
          session_id: session.session_id,
          user_id: session.user_id,
          position: idx + 1,
          product_id: item.product_id,
          section_id: item.section_type,
          placement_id: item.placement_id,
          placement_version: item.placement_version,
          policy: exp.policyArm,
          surface: "home",
          source: item.source,
          propensity: item.propensity,
          served_at: servedAt,
          seen_at: seenAt[idx],
        });
      });
    }
  }

  // Índice de impresiones para atribución: última por (session|product) y
  // por (user|product) — espejo del ORDER BY served_at DESC LIMIT 1.
  const bySessionProduct = new Map<string, SimImpression>();
  const byUserProduct = new Map<string, SimImpression>();
  const index = (imp: SimImpression) => {
    const ks = `${imp.session_id}|${imp.product_id}`;
    const cur = bySessionProduct.get(ks);
    if (!cur || imp.served_at.getTime() >= cur.served_at.getTime()) bySessionProduct.set(ks, imp);
    const ku = `${imp.user_id}|${imp.product_id}`;
    const curU = byUserProduct.get(ku);
    if (!curU || imp.served_at.getTime() >= curU.served_at.getTime()) byUserProduct.set(ku, imp);
  };
  for (const imp of arm.log.impressions) index(imp);
  for (const imp of newImpressions) index(imp);

  // ── Eventos + compras. ──
  for (const e of out.events) {
    const when = at(e.occurred_at);
    arm.log.events.push({
      epoch,
      session_id: e.session_id,
      user_id: e.user_id,
      event_type: e.event_type,
      product_id: e.product_id,
      occurred_at: when,
    });
    if (e.event_type !== "purchase") continue;

    let imp = bySessionProduct.get(`${e.session_id}|${e.product_id}`) ?? null;
    if (!imp) {
      const cand = byUserProduct.get(`${e.user_id}|${e.product_id}`) ?? null;
      // lookback 7d, espejo de attribution.ts:36
      if (cand && when.getTime() - cand.served_at.getTime() <= 7 * DAY_MS) imp = cand;
    }
    arm.log.purchases.push({
      epoch,
      session_id: e.session_id,
      product_id: e.product_id,
      feed_request_id: imp?.feed_request_id ?? null,
      position: imp?.position ?? null,
      policy: imp?.policy ?? null,
      seen: imp?.seen_at != null,
      unit_price_cents: world.priceAt(epoch, e.product_id),
      quantity: 1,
      attributed_at: when,
      attributed_placement_id: imp?.placement_id ?? null,
      margin_pct: world.marginOf(e.product_id),
    });
  }

  // Loop en vez de spread: el journey multi-superficie genera miles de
  // impresiones por época (home + PDP por ítem visto + carrito); push(...array)
  // desborda el call-stack de V8 cuando el array cruza el límite de argumentos.
  for (const imp of newImpressions) arm.log.impressions.push(imp);

  // Poda de impresiones fuera de ventana: a escala-gate el journey acumula
  // ~585k impresiones/época; sin cota, 14 épocas × 2 brazos desbordan los 4GB.
  // La atribución mira ≤7d (≈época previa) y la capa de métricas clampa a 28d
  // (≈2 épocas) — conservar las últimas 3 épocas cubre ambas con margen. Las
  // compras (ground-truth del veredicto) y los eventos (user-state + NPMI de 6
  // épocas) NO se podan; solo las impresiones, que son el grueso de la memoria.
  // Acota además el re-índice de atribución (líneas arriba) a O(ventana).
  const keepImpressionsFrom = epoch - 2;
  if (keepImpressionsFrom > 0) {
    arm.log.impressions = arm.log.impressions.filter((imp) => imp.epoch >= keepImpressionsFrom);
  }
}

/** Métrica primaria del gate: margen realizado (¢) en [fromEpoch, toEpoch]. */
export function realizedMarginCents(arm: ArmState, fromEpoch: number, toEpoch: number): number {
  let sum = 0;
  for (const p of arm.log.purchases) {
    if (p.epoch < fromEpoch || p.epoch > toEpoch) continue;
    sum += p.unit_price_cents * p.quantity * p.margin_pct;
  }
  return sum;
}

/** Secundaria: GMV (¢). */
export function gmvCents(arm: ArmState, fromEpoch: number, toEpoch: number): number {
  let sum = 0;
  for (const p of arm.log.purchases) {
    if (p.epoch < fromEpoch || p.epoch > toEpoch) continue;
    sum += p.unit_price_cents * p.quantity;
  }
  return sum;
}

export function marginByEpoch(arm: ArmState, epochsTotal: number): number[] {
  const out = new Array<number>(epochsTotal).fill(0);
  for (const p of arm.log.purchases) {
    if (p.epoch < epochsTotal) out[p.epoch] += p.unit_price_cents * p.quantity * p.margin_pct;
  }
  return out;
}

/** NDJSON crudo para la verificación independiente de Fase D (verify-ledger). */
export function ledgerToNdjson(arm: ArmState): string {
  return arm.log.purchases
    .map((p) =>
      JSON.stringify({
        epoch: p.epoch,
        product_id: p.product_id,
        unit_price_cents: p.unit_price_cents,
        quantity: p.quantity,
        margin_pct: p.margin_pct,
        feed_request_id: p.feed_request_id,
        attributed_placement_id: p.attributed_placement_id,
        policy: p.policy,
      }),
    )
    .join("\n");
}
