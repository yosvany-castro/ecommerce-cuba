#!/usr/bin/env bash
# Corre seeds del gate EN PARALELO (uno por proceso) y recombina el veredicto.
# Válido porque los pipelines por seed son independientes y deterministas por
# CRN (mismos ratios que la corrida secuencial; ver eval-harness.ts). Requiere
# ~3GB de RAM por seed — con 3 seeds, dale >=12GB a WSL (.wslconfig).
#
#   bash scripts/agents/run-gate-parallel.sh 2026 31337 777
#
# Al terminar: escribe results/gate-seed-<seed>.json por cada uno, imprime el
# veredicto oficial (gate-seeds.ts --verdict) y corre verify-ledger.
set -uo pipefail
cd "$(dirname "$0")/../.."
export NODE_OPTIONS="--max-old-space-size=3584"
mkdir -p logs scripts/agents/results

SEEDS=("$@")
[ ${#SEEDS[@]} -gt 0 ] || { echo "uso: $0 <seed> [seed...]"; exit 1; }

pids=()
for s in "${SEEDS[@]}"; do
  (
    LOG="logs/gate-seed-$s.log"
    echo "[par] seed $s arrancando ($(date +%H:%M))" | tee -a "$LOG"
    pnpm exec tsx scripts/agents/eval-harness.ts --gateworld --agent=llm --seeds "$s" >> "$LOG" 2>&1
    # extraer el reporte recién creado y convertirlo al formato gate-seed
    REPORT=$(grep -oE 'scripts/agents/results/[a-z0-9-]+\.json' "$LOG" | tail -1)
    if [ -n "$REPORT" ] && [ -f "$REPORT" ]; then
      jq --arg now "$(date -u +%FT%TZ)" '{
        seed: .results[0].seed, ratio: .results[0].ratio,
        agentMarginCents: .results[0].agentMarginCents,
        frozenMarginCents: .results[0].frozenMarginCents,
        frozenCollapse: .results[0].sanity.frozenCollapse,
        giniSales: .results[0].sanity.giniSales,
        top20Share: .results[0].sanity.top20Share,
        worldVersion: .worldVersion, savedAt: $now
      }' "$REPORT" > "scripts/agents/results/gate-seed-$s.json"
      echo "[par] seed $s GUARDADO: $(jq -r .ratio "scripts/agents/results/gate-seed-$s.json")" | tee -a "$LOG"
    else
      echo "[par] seed $s SIN reporte — revisar $LOG" | tee -a "$LOG"
    fi
  ) &
  pids+=($!)
done
wait "${pids[@]}"

echo "── VEREDICTO OFICIAL (5 seeds pre-registrados) ──"
pnpm exec tsx scripts/agents/gate-seeds.ts --verdict
echo "── REFERENCIA SCRIPTED (mismo mundo) ──"
pnpm exec tsx scripts/agents/eval-harness.ts --gateworld --agent=scripted --seeds 42,7,2026,31337,777
echo "── VERIFY-LEDGER ──"
pnpm exec tsx scripts/agents/verify-ledger.ts
