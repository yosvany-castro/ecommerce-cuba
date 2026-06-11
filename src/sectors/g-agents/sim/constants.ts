/**
 * Constantes del simulador del gate (blueprint §5.2). UN solo objeto config
 * compartido por ambos brazos — imposible divergir por brazo (anti-trampa
 * A3 §8 #12). Las magnitudes de shift viven en shifts.ts (pre-registradas
 * A3 §1.3); aquí solo exposición, calendario y seeds.
 */

export const SIM_CONFIG = Object.freeze({
  SLATE_K: 20,
  CASCADE_LAMBDA: 0.85,
  EPSILON: 0.1,
  ZIPF_S: 1.0,
  ZIPF_ETA: 0.7,
  PRICE_GAMMA: 0.8,
  P_GIFT_MAX: 0.16,
  EPOCH_DAYS: 14,
  /** e0 warmup + e1 baseline + e2..e13 medidas. */
  EPOCHS_TOTAL: 14,
  MEASURED_EPOCH_START: 2,
  POPULARITY_WINDOW_EPOCHS: 1,
  NPMI_WINDOW_EPOCHS: 6,
} as const);

export const SLATE_K = SIM_CONFIG.SLATE_K;
export const CASCADE_LAMBDA = SIM_CONFIG.CASCADE_LAMBDA;
export const EPSILON = SIM_CONFIG.EPSILON;
export const ZIPF_S = SIM_CONFIG.ZIPF_S;
export const ZIPF_ETA = SIM_CONFIG.ZIPF_ETA;
export const EPOCH_DAYS = SIM_CONFIG.EPOCH_DAYS;
export const EPOCHS_TOTAL = SIM_CONFIG.EPOCHS_TOTAL;
export const MEASURED_EPOCH_START = SIM_CONFIG.MEASURED_EPOCH_START;
export const POPULARITY_WINDOW_EPOCHS = SIM_CONFIG.POPULARITY_WINDOW_EPOCHS;
export const NPMI_WINDOW_EPOCHS = SIM_CONFIG.NPMI_WINDOW_EPOCHS;

/** Seeds del gate: VÍRGENES hasta harness congelado. Desarrollo SOLO 123. */
export const GATE_SEEDS = [42, 7, 2026, 31337, 777] as const;
export const ESCALATION_SEEDS = [1001, 1002, 1003, 1004, 1005] as const;
export const DEV_SEED = 123;

/**
 * TTL escalado a cadencia (decisión 2.B.10): el cap de 168h asume cron diario;
 * el sim decide cada 14 días — la conversión preserva el invariante real
 * "TTL ≤ ~2× la cadencia de revisión". Desviación sim↔prod nº4 declarada.
 */
export const SIM_TTL_EPOCHS = (ttlHours: number): number =>
  Math.min(2, Math.max(1, Math.round(ttlHours / 72)));

const DAY_MS = 86_400_000;
/** ≡ BASE_DATE_MS del behavior-model (no exportada allí): 2026-01-01T00Z. */
export const SIM_BASE_MS = Date.parse("2026-01-01T00:00:00Z");

/** Frontera de la época t: el "now" del agente cuando decide PARA t. */
export function epochStart(t: number): Date {
  return new Date(SIM_BASE_MS + t * EPOCH_DAYS * DAY_MS);
}

/** Bump manual cuando cambie el modelo de mundo: invalida el caché de transcripts. */
export const SIM_WORLD_VERSION = "sim-world-v1";

export interface WorldSpec {
  universeSize: number;
  activeAtE0: number;
  users: number;
  /** Épocas medidas (e2..). EPOCHS_TOTAL efectivo = 2 + measuredEpochs. */
  measuredEpochs: number;
}

export const GATE_WORLD: WorldSpec = Object.freeze({
  universeSize: 3000,
  activeAtE0: 2400,
  users: 1000,
  measuredEpochs: 12,
});

export const SMOKE_WORLD: WorldSpec = Object.freeze({
  universeSize: 1500,
  activeAtE0: 1200,
  users: 300,
  measuredEpochs: 3,
});

/**
 * Metadatos de sección del seed 0026 (réplica de ui_sections): el sim no lee
 * DB, pero el claiming por prioridad y el min_items de resolve.ts dependen de
 * estos valores — paridad 1:1 con la fila sembrada.
 */
export const SIM_SECTION_META: Record<
  string,
  { priority: number; min_items: number; default_params: Record<string, unknown> }
> = {
  hero_grid: { priority: 0, min_items: 10, default_params: { limit: 20 } },
  cross_sell: { priority: 1, min_items: 3, default_params: { limit: 8 } },
  popular: { priority: 2, min_items: 3, default_params: { limit: 10, mode: "global" } },
  cart_addons: { priority: 1, min_items: 2, default_params: { limit: 6 } },
};
