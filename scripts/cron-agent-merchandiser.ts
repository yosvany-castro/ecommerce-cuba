#!/usr/bin/env tsx
/**
 * Cron: merchandiser agent (Fase 2) — lee métricas (C1), propone placements
 * (C2). OFFLINE por construcción: withPgDirect, jamás el pool del request
 * path. Si este proceso muere, la tienda sirve idéntica (caché→defaults).
 *
 * Flags: --dry-run  ejercita TODO el pipeline real (validación→caps→tier) y
 *                   se detiene antes del INSERT
 *        --kill-all mata toda fila agente (pánico) y sale
 * Env:   AGENTS_ENABLED=true            (default: OFF — el cron no corre)
 *        AGENT_MEDIUM_AUTOAPPLY=true    (default: medium ⇒ pending)
 *        AGENT_MAX_PROPOSALS_PER_RUN=5
 * Cadencia: diaria (las ventanas de métricas son 7-28d; más frecuencia =
 * churn sin señal nueva).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { withPgDirect } from "@/lib/db/helpers";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (process.argv.includes("--kill-all")) {
    const n = await withPgDirect((pg) =>
      pg.query(`UPDATE ui_placements SET status='killed', updated_at=now()
                WHERE created_by LIKE 'agent:%' AND status <> 'killed'`),
    );
    console.log(`[cron-agent] KILLED ${n.rowCount} agent rows`);
    return;
  }

  if (process.env.AGENTS_ENABLED !== "true") {
    console.log("[cron-agent] AGENTS_ENABLED!=true — disabled, exiting 0");
    return; // fail-closed: sin opt-in explícito no hay agente
  }

  // imports diferidos: no pagar el grafo LangChain (ni exigir DEEPSEEK_API_KEY)
  // cuando está disabled
  const { runMerchandiserOnce } = await import("@/sectors/g-agents/runtime/merchandiser");
  const { pgMerchandiserBackend } = await import("@/sectors/g-agents/runtime/backend-pg");

  const out = await withPgDirect(async (pg) =>
    runMerchandiserOnce({ backend: pgMerchandiserBackend(pg, { dryRun }) }),
  );
  for (const p of out.proposals) {
    console.log(
      `[cron-agent] ${dryRun ? "DRY " : ""}${p.accepted ? "ok " : "REJ"} ` +
        `${p.action} ${p.surface ?? ""}:${p.slot ?? ""} tier=${p.effective_tier ?? "-"} ` +
        `status=${p.status ?? "-"} ${p.reason ?? ""}`,
    );
  }
  console.log(
    `[cron-agent] run=${out.runId} proposals=${out.proposals.length} ` +
      `applied=${out.applied} pending=${out.pending} rejected=${out.rejected} ` +
      `truncated=${out.truncated} dry=${dryRun}`,
  );
}

main().catch((e) => {
  console.error("[cron-agent] failed:", e);
  process.exit(1); // la tienda no se entera: nada del request path depende de este proceso
});
