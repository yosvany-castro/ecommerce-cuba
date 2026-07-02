import type { Surface } from "@/sectors/g-agents/metrics/types";
import type { PlacementProposal } from "@/sectors/g-agents/write/schema";

/**
 * El seam prod/sim del agente (blueprint §4.7): el merchandiser (runtime y
 * harness del gate) se construye contra ESTA interfaz — backend-pg en
 * producción, backend-sim en el simulador del gate. Mismo agente, mundo
 * intercambiado (anti-H7).
 */

export interface ProposalResult {
  accepted: boolean;
  action: string;
  surface?: string;
  slot?: number;
  placement_id?: string;
  effective_tier?: "low" | "medium" | "high";
  status?: "approved" | "pending" | "paused";
  reason?: string;
}

export interface MerchandiserBackend {
  runId: string;
  dryRun: boolean;
  /** JSON string (shape de buildMetricsReport §3.5). */
  readMetrics(input: { surface?: Surface; window_days: 7 | 14 | 28 }): Promise<string>;
  /** JSON string: productos activos + summary por categoría (§4.8). */
  readCatalog(input: { category?: string; limit: number }): Promise<string>;
  /** valida→tier→caps→escribe; NUNCA lanza — todo rechazo es legible. */
  proposeWrite(input: PlacementProposal): Promise<ProposalResult>;
}
