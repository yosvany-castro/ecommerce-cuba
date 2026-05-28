import type { Client } from "pg";
import type { CohortId } from "../cohorts/definitions";

const COHORT_HUMAN: Record<string, string> = {
  femenino_bebe: "mujer recién nacida",
  femenino_nina: "niña",
  femenino_joven: "mujer joven",
  femenino_adulta: "mujer adulta",
  femenino_mayor: "mujer mayor",
  masculino_bebe: "varón recién nacido",
  masculino_nino: "niño",
  masculino_joven: "hombre joven",
  masculino_adulto: "hombre adulto",
  masculino_mayor: "hombre mayor",
  unisex_indeterminado: "usuario sin perfil definido",
};

/**
 * Generates a short Spanish narrative summary of the user's profile, intended
 * as input to the LLM reranker. Combines: inferred cohort, recipient flag,
 * top-3 categories observed in events (last 30 days).
 */
export async function buildProfileSummary(
  user_profile_id: string,
  recipient_id: string | null,
  cohort_id: CohortId,
  pg: Client,
): Promise<string> {
  const cohortHuman = COHORT_HUMAN[cohort_id] ?? "usuario";

  const r = await pg.query(
    `SELECT p.metadata->>'category' AS cat, COUNT(*)::int AS n
     FROM events e
     JOIN products p ON p.id = (e.payload->>'product_id')::uuid
     JOIN user_profiles up ON up.id = $1
     WHERE e.occurred_at > now() - interval '30 days'
       AND e.event_type IN ('product_view', 'add_to_cart', 'purchase')
       AND (
         (e.anonymous_id IS NOT NULL AND e.anonymous_id = up.anonymous_id)
         OR (e.user_id IS NOT NULL AND e.user_id = up.user_id)
       )
       AND p.metadata->>'category' IS NOT NULL
     GROUP BY p.metadata->>'category'
     ORDER BY n DESC LIMIT 3`,
    [user_profile_id],
  );
  const topCats = (r.rows as { cat: string }[])
    .map((x) => x.cat)
    .filter(Boolean);

  const recipientPhrase = recipient_id
    ? "Compra para un destinatario específico."
    : "Navega sin destinatario fijado.";
  const catsPhrase =
    topCats.length > 0
      ? `Categorías frecuentes: ${topCats.join(", ")}.`
      : "Sin categorías frecuentes aún.";

  return `Perfil estimado: ${cohortHuman}. ${recipientPhrase} ${catsPhrase}`;
}
