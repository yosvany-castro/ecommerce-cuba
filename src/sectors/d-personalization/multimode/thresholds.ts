/**
 * Master doc Sec 10.b — modos del usuario según historial agregado por bucket
 * (user_profile, recipient, cohort):
 *   0-4 events  → 0 modes (sólo prior)
 *   5-19        → 1 mode
 *   20-99       → 2 modes
 *   ≥100        → 3 modes
 */
export function modesForEvents(nEvents: number): 0 | 1 | 2 | 3 {
  if (nEvents < 5) return 0;
  if (nEvents < 20) return 1;
  if (nEvents < 100) return 2;
  return 3;
}
