# Spec — F6: Validación holística & stress-testing

**Fecha:** 2026-06-08
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** sexta fase (validación). Construye sobre F0 (datos+eval), F1
(embeddings), F2 (multi-vector+regalo), F3 (pool multi-fuente + rerankers),
F4 (ranking multi-objetivo), F5 (escritura/PDF). **NO** es una fase de producto
nuevo: es la **validación adversarial** del arco F0–F5 que la propia tesis declara
pendiente (§9 limitaciones del handoff y cap. 8–9 de la tesis).

**Specs/planes/reportes previos (leer):**
- Handoff completo: `docs/handoff-thesis-program-F0-F5.md` (§8 playbook al-límite).
- Reportes fuente de verdad: `docs/superpowers/reports/2026-0*-thesis-f{0,1,2,3,4}-*.{md,json}`.
- F4 design (caveat de atribución a cerrar): `...specs/2026-06-07-thesis-f4-multi-objective-ranking-design.md`.
- Contrato de eval: `src/thesis/types.ts`, `src/thesis/eval/{harness,aggregate,baselines,metrics,report}.ts`.

---

## 1. Objetivo y contribución de tesis

**El hueco que cierra F6.** Cada estudio F0–F4 construyó **sus propios casos con
universos de candidatos distintos**, por lo que sus nDCG **no son comparables entre
sí**, y **nunca se midió el sistema completo contra el baseline tonto sobre los
mismos casos**. Las cifras citadas lado a lado engañan:

| Fuente | nDCG@10 | candidatos | casos |
|---|---|---|---|
| popular-cohort (F0) | 0.486 | catálogo completo, vector-factor GT | ~1098 |
| e2_hybrid (F1) | 0.124 | universo común ~1998 | ~1042 |
| F2 multi-vector | 0.152 | E1 | ~1038 |
| F3 baseline-RRF | 0.177 | pool de 200 | 1098 |
| F4 multi-objetivo | 0.202 | pool 200, submuestra 300 | ~1107 |

El `0.486` de popular-cohort aplasta al pipeline, pero está medido sobre casos y
candidatos distintos. **La pregunta científica de fondo nunca se ha respondido de
forma justa.**

**Contribución de F6 (defendible en tesis):**
1. **Comparación head-to-head honesta:** mismos casos, mismos candidatos, mismo
   split → ¿el pipeline completo ensamblado (F1+F2+F3+F4) le gana al rival MVP
   (`popular-cohort` = popularidad-por-cohorte, que es popular-cohort + filtro de
   categoría)? **¿Dónde, cuánto, y dónde NO?**
2. **Validez a escala:** regenerar n=2000/5000/10000 y verificar si las
   conclusiones se sostienen o son artefactos del tamaño (la limitación #1 de la
   tesis). Hipótesis central a *falsar*: que `popular-cohort` deja de dominar al
   crecer el catálogo (la cohorte=subcategoría se diluye).
3. **Robustez por seed:** ¿las conclusiones son verdad o suerte del seed 42?
4. **Cierre de la deuda metodológica de F4:** feature de relevancia multi-señal →
   trade-off relevancia↔revenue *verdadero* (sin el confound single-signal-vs-fusion).
5. **Stress-tests adversariales** del §8 (reranker-sobre-revenue, latencia/p99,
   perfiles extremos, robustez del detector de regalo, ablations del pool).

**Honestidad obligatoria:** F6 puede *refutar* afirmaciones de la tesis. Si el
pipeline NO le gana a `popular-cohort` en el marco justo, ese es el resultado y se
reporta tal cual (con el matiz de escala). El valor de F6 es la verdad, no confirmar
la hipótesis.

---

## 2. Alcance

### En alcance (F6)
- **W1 — Arnés head-to-head unificado** (núcleo): un solo set de casos canónicos,
  mismos candidatos para todos los rankers; ranker **ensamblado F1→F2→F3→F4**;
  dos marcos de comparación (candidato-completo y pool-only).
- **W2 — Escala (§8-A):** regenerar n=2000/5000/10000 (seed 42) y re-correr W1+estudios.
- **W3 — Robustez por seed (§8-B):** seeds {7,123} a n=5000.
- **W4 — Caveat de atribución F4 (§8-C):** feature de relevancia multi-señal y
  re-medición del trade-off verdadero.
- **W5 — Reranker sobre revenue (§8-D):** LTR/LLM con objetivo revenue@k.
- **W6 — Latencia/p99 (§8-E):** instrumentación end-to-end del feed.
- **W7 — Perfiles adversariales (§8-F):** regalo puro, multi-modal ortogonal,
  precio-extremo, sesión ambigua.
- **W8 — Robustez del detector de regalo (§8-G):** sesiones ambiguas, FP/FN, mejora
  de heurística sin leakage.
- **W9 — Ablations de fuentes del pool (§8-I):** leave-one-source-out.
- **W10 — Síntesis:** reporte tesis-grade + capítulo F6 integrado a `tesis.pdf`.

### Fuera de alcance
- **§8-H (dataset público real):** BLOCKED-EXTERNAL (no hay dataset; el adaptador
  `pnpm thesis:public` ya existe; queda como trabajo futuro).
- Tocar producción `src/sectors/`. F6 vive en `src/thesis/` + `scripts/thesis/`.
- Merge a `main` (restricción permanente del dueño).
- Cambiar conclusiones ya committeadas de F0–F5: F6 **añade** evidencia; si la
  contradice, lo documenta, no reescribe los reportes históricos.

### No-objetivos (YAGNI)
- No bandit online / λ por-usuario (sigue fuera, como en F4).
- No reentrenar embeddings con arquitecturas nuevas; se usan E0–E5 existentes.
- No matriz completa escala×seed (9 datasets); el barrido acordado es 2k/5k/10k@42
  + {7,123}@5k = **5 datasets**.

---

## 3. Decisiones de diseño (del brainstorming)
1. **Ejes (4 compuertas):** escala 2k→5k→10k; presupuesto API exhaustivo; rival =
   **MVP realista popular-cohort**; alcance = todo §8 factible (A–G, I) + holística.
2. **Entregable:** reportes md/json **+ capítulo F6 integrado al PDF**.
3. **Barrido:** 2k/5k/10k @ seed 42 + seeds {7,123} @ n=5000 (5 datasets).
4. **Enfoque:** **fundación-primero** — construir y validar W1 a n=2000 (dataset
   intacto), luego escala/seeds/stress en fases gateadas.
5. **Comparación justa:** dos marcos — (a) **candidato-completo** (feed de
   producción: todos los rankers reciben catálogo\train; el ensamblado poolea
   internamente) y (b) **pool-only** (todos rankean el mismo pool de 200; aísla el
   valor del reranker dado el retrieval).
6. **Ejecución:** un workflow por workstream (orquestación determinista de
   subagentes); verificación en disco de cada reporte/commit (los background jobs
   mueren callados); gates spec-compliance + code-quality por cada cambio de código.

---

## 4. Arquitectura

Código nuevo bajo `src/thesis/` (librería pura, testeable) + runners en
`scripts/thesis/`. Aislado del producto. Reutiliza el contrato `Ranker`/`EvalCase`
y el cargador de datos de los estudios existentes. **Sin migración** (los campos de
negocio ya viven en `products.metadata` jsonb desde F4).

```
src/thesis/eval/
  unified-cases.ts     # W1: cargador canónico ÚNICO de casos (holdout→EvalCase[])
                       #     + contexto por-caso (modes, giftSignal, lastViewed,
                       #     pool 4-fuentes, objective features, revenueById, sellerById)
  assembled.ts         # W1: assembledPipelineRanker() = F1→F2→F3→F4 como un Ranker
  adversarial.ts       # W7: constructores de perfiles extremos (UserContext+session)
src/thesis/objectives/
  relevance-multi.ts   # W4: feature de relevancia multi-señal (retrieval+NPMI+pop)
src/thesis/rerank/
  revenue-ltr.ts       # W5: entrenamiento LTR con etiqueta/peso de revenue
scripts/thesis/
  f6-headtohead.ts     # W1/W2/W3: head-to-head unificado (flags --n --seed --frame)
  f6-attribution.ts    # W4: F4 con relevancia multi-señal vs single-signal
  f6-revenue-rerank.ts # W5: reranker-sobre-revenue vs RRF
  f6-latency.ts        # W6: timings por etapa + p50/p95/p99 + costo/fallback LLM
  f6-adversarial.ts    # W7: perfiles adversariales
  f6-gift-robustness.ts# W8: barrido de umbrales del detector + sesiones ambiguas
  f6-pool-ablation.ts  # W9: leave-one-source-out del pool
docs/superpowers/reports/2026-06-08-thesis-f6-*.{md,json}   # W2–W9 outputs
docs/thesis/11-f6-validacion.md  # W10 capítulo (integrado a build.sh)
```

**Reutilización (no reinventar):** `evaluateRanker`/`aggregateCases`, todas las
métricas de `eval/metrics.ts` (incl. `revenueAtK`, `sellerExposureGini`,
`setChangeAtK`, `recipientFitAtK`), `buildCandidatePool`, `buildUserModes`,
`detectGiftIntent`, `multiModeRank`, `extractFeatures`/`trainLTR`,
`extractObjectiveFeatures`/`multiObjectiveRanker`, `hybridScoreFusionRanker`.
El cargador de datos se **extrae** de la lógica repetida en `f3-study.ts`/`f4-study.ts`
a `unified-cases.ts` para que todos los rankers vean casos idénticos.

---

## 5. Detalle por workstream

### W1 — Arnés head-to-head unificado *(fundación)*

**`unified-cases.ts`** carga UNA vez por dataset:
- holdout (train/test por usuario), catálogo (`RankItem` con popularity+cohort+vector
  del espacio de producción e2_hybrid/E1), `co_occurrence_top` (NPMI), `sim_sessions`
  (intent/recipient GT solo para segmentar, nunca como feature), business fields.
- Por cada caso de test `(user, testProduct)` produce un **`UnifiedCase`**:
  ```ts
  interface UnifiedCase extends EvalCase {       // ctx, candidates, relevant, complements?
    userId: string;
    trainIds: string[];
    lastViewedId: string | null;
    giftSignal: GiftSignal;                        // F2 detector (no GT)
    intentGT: "self" | "gift";                     // solo para segmentar
    modes: UserMode[];                             // F2
    pool: PooledCandidate[];                        // F3 4-fuentes RRF (200)
    objById: Map<string, Record<ObjectiveName, number>>; // F4 features
    revenueById: Map<string, number>;              // expectedRevenue
    sellerById: Map<string, string>;
  }
  ```
- **Candidatos = catálogo \ train del usuario** (idéntico para todos los rankers en
  el marco candidato-completo). El `pool` es un subconjunto derivado de esos mismos
  candidatos (marco pool-only restringe `candidates` al pool).

**`assembled.ts` — `assembledPipelineRanker(case)`** (per-case vía `aggregateCases`):
1. **F2:** `modes` ya construidos; si `giftSignal.isGift` usa vector de destinatario
   efímero, si no los modos.
2. **F3:** rankea el `pool` por LTR (entrenado train-split-only) ó RRF (config); los
   ítems fuera del pool van al final por cohort-popularidad (fallback determinista).
3. **F4:** aplica `multiObjectiveRanker` con la config de pesos elegida (default: el
   *knee* min-max de F4) sobre los ítems del pool; concatena la cola no-pool.
4. Devuelve permutación completa sobre `candidates`.

**Rankers comparados** (todos sobre `UnifiedCase` idénticos):
`random`, `popular-global`, **`popular-cohort` (rival MVP)**, `cosine-e2hybrid`
(F1), `f2-multimode` (F2), `f3-rrf`, `f3-ltr` (F3), `f4-knee`, `f4-revenue` (F4),
**`assembled`** (ensamblado). Opcional `f3-llm` (DeepSeek, subconjunto, costado).

**Nota de espacio de embeddings (evita mismatch de dims):** F1 elige `e2_hybrid`
como pick de producción, pero F2/F3/F4 operan en **E1 (prod2vec, 64d)** — modos,
pool-retrieval, objective-features. Para fidelidad y para no mezclar dims, el
**`RankItem.vector` canónico = E1**, y todas las etapas F2/F3/F4 del ensamblado
operan en E1. `e2_hybrid` entra como **ranker baseline de F1 separado**
(`hybridScoreFusionRanker`, que recibe los mapas E0-texto + E1-comportamiento por
fuera del `RankItem.vector`, fusión a nivel de score) — no como el vector del
ensamblado. Así el head-to-head incluye ambos (E1 puro y e2_hybrid) sin romper
`cosineSim`.

**Marcos** (flag `--frame full|pool`):
- **full:** `candidates` = catálogo\train. Titular: ¿el ensamblado bate a popular-cohort?
- **pool:** `candidates` = pool 200. Aísla el valor del reranking dado el retrieval.

**Métricas reportadas** (por ranker, k∈{5,10,20}, segmentado self/gift):
nDCG, recall, MRR, MAP, hit, + **revenue@10**, **recipient-fit@10** (gift),
**seller-gini@10**, **diversity@10**, **set-change@10** (vs popular-cohort y vs pool).

**Salida:** `2026-06-08-thesis-f6-headtohead-n{N}-seed{S}-{frame}.{md,json}`.

### W2 — Escala (§8-A)
Regenerar dataset completo a n∈{2000,5000,10000}, seed 42 (orden exacto §6 handoff,
incluye build-chunks/context3 para E4/E5 — hoy `item_chunk_vectors`=0). Re-correr
W1 (ambos marcos) + estudios F0–F4. **Preguntas:** ¿popular-cohort se desploma al
crecer (cohorte se diluye)? ¿e2_hybrid mantiene ~3.3×? ¿el pool sigue duplicando
recall? ¿la frontera de Pareto cambia de forma? **Salida:** tabla escala × métrica
por ranker + reporte de tendencia.

### W3 — Robustez por seed (§8-B)
Regenerar a n=5000 con seeds {7,123}. Re-correr W1 + F1/F2/F3/F4. **Criterio:** si
el *orden* de rankers (no los valores absolutos) y el signo de los lifts se
mantienen, la conclusión es robusta. Reportar varianza entre seeds.

### W4 — Caveat de atribución F4 (§8-C)
`relevance-multi.ts`: feature de relevancia que **fusiona** retrieval-cosine + NPMI
+ cohort-popularidad (RRF o suma ponderada, replicando la señal del baseline). Se
inyecta como variante de `extractObjectiveFeatures` (sin romper la firma actual:
opción `relevanceFn`). `f6-attribution.ts` corre F4 con relevancia
**single-signal** (actual) vs **multi-signal** y separa: (a) gap single→fusion
(confound) de (b) trade-off verdadero relevancia↔revenue. **Cierra la deuda más
citada de la tesis.**

### W5 — Reranker sobre revenue (§8-D)
`revenue-ltr.ts`: variante de `trainLTR` con etiqueta = revenue normalizado del
ítem comprado (o positivos ponderados por revenue), train-split-only, sin leakage.
`f6-revenue-rerank.ts` compara revenue@10 y nDCG@10 de {RRF, LTR-relevancia,
LTR-revenue, (LLM-revenue opcional)}. **Pregunta:** ¿un reranker entrenado sobre el
outcome de negocio bate a RRF en revenue manteniendo relevancia ≥ umbral? Sería un
resultado nuevo fuerte.

### W6 — Latencia/p99 (§8-E)
`f6-latency.ts` instrumenta por etapa (retrieval → pool RRF → LTR/LLM rerank →
scorer multi-objetivo) sobre N casos a escala 10000; reporta p50/p95/**p99** end-to-end,
desglose por etapa, costo $ por request del LLM listwise y **fallback-rate**.
Compuerta de referencia: **p99 < 1.5s** (spec fase-3c). Mide con y sin el LLM.

### W7 — Perfiles adversariales (§8-F)
`adversarial.ts` construye `UnifiedCase` sintéticos extremos (no del holdout):
- **regalo puro:** comprador y destinatario demográficamente opuestos.
- **multi-modal:** 5+ intereses ortogonales (subcategorías disjuntas).
- **precio-extremo:** solo cola alta / solo barato.
- **sesión ambigua:** señales mixtas que retan al detector (~0.43 precisión).
`f6-adversarial.ts` corre el ensamblado y baselines; mide recipient-fit, set-change,
revenue y reporta **cualitativamente** cómo adapta el pipeline (¿degrada con gracia
a self-mode cuando el detector falla?).

### W8 — Robustez del detector de regalo (§8-G)
`f6-gift-robustness.ts` genera sesiones de regalo ambiguas (parametrizadas) y barre
`minItems`/`minDemographicCoherence`; reporta matriz de confusión, FP/FN, curva
precisión-recall. Intenta una mejora de heurística (p.ej. ponderar por coherencia
de edad+género) **sin** usar `sim_sessions.intent` (GT) como feature. Reporta si la
mejora sube F1 sin leakage.

### W9 — Ablations de fuentes del pool (§8-I)
`f6-pool-ablation.ts` reconstruye el pool quitando una fuente a la vez
(−retrieval, −NPMI, −popularity, −exploration) vía el parámetro `sources` de
`buildCandidatePool`; mide pool-recall y nDCG@10 del RRF resultante. **Confirma o
refuta** que NPMI aporta señal ortogonal (recupera complementos que el coseno no).

### W10 — Síntesis
Reporte `2026-06-08-thesis-f6-synthesis.md` que integra W1–W9 con veredicto honesto
por afirmación de la tesis (sostiene / matiza / refuta). Capítulo
`docs/thesis/11-f6-validacion.md` integrado a `build.sh`/`Makefile`; cifras citadas
verbatim de los reportes committeados de F6; recompilar `tesis.pdf`.

---

## 6. Datos, escala y costos

**Matriz de regeneración (5 datasets):**

| dataset | n | users | days | seed | E4/E5 |
|---|---|---|---|---|---|
| D0 (actual) | 2000 | 800 | 90 | 42 | rebuild chunks+context3 |
| D1 | 5000 | 2000 | 90 | 42 | sí |
| D2 | 10000 | 4000 | 90 | 42 | sí |
| D3 | 5000 | 2000 | 90 | 7 | e1/e2 (sin chunks para abaratar seed-sweep) |
| D4 | 5000 | 2000 | 90 | 123 | e1/e2 |

Usuarios escalan ~proporcional a n para mantener densidad de eventos (la tesis usó
800@2000). Orden EXACTO por dataset (handoff §6):
`catalog → relations → behavior → backfill-cooccurrence → train-prod2vec →
train-two-tower → build-chunks → build-context3`.

**Determinismo:** todo es seed-determinista (sin Math.random/Date.now). Por eso la
"robustez por seed" (W3) **es** la prueba de varianza (no hay ruido intra-seed).

**Costos (estimado, se mide el real):** Voyage por catálogo ≈ centavos–$1; chunks
+context3 ≈ las mayores (3×N textos) pero aún ≈ $1–2 por escala; DeepSeek listwise
≈ centavos por estudio (cap de casos). Total $ **modesto**; el costo real es tiempo
de cómputo (~1–2 h por dataset completo) y tokens de orquestación. **Cada dataset
debe inspeccionarse** con `pnpm tsx scripts/thesis/_inspect-state.ts` antes de medir.

---

## 7. Hazards y disciplina de ejecución

1. **NUNCA correr `vitest run tests/thesis` completo** — incluye
   `harness-discrimination.test.ts` que hace `TRUNCATE thesis.products CASCADE`
   (rollback en transacción, pero un crash mid-run deja el dataset roto). Solo
   tests dirigidos seguros (lista en el mapa tests+hazards).
2. **Regenerar es destructivo por diseño** (`catalog-gen`/`behavior-gen` hacen
   TRUNCATE CASCADE). Cada cambio de escala/seed **sobrescribe** el dataset; por eso
   el orden fundación-primero (D0 head-to-head antes de saltar a D1/D2).
3. **Subagents en background mueren callados** → verificar reporte/commit en disco;
   re-correr/commitear si hace falta (lección F3/F4).
4. **`item_chunk_vectors`=0 hoy** → E4/E5 no existen; rebuild antes de usar
   cross-encoder/E5. El head-to-head titular usa e2_hybrid (no requiere E4).
5. **`cosineSim` LANZA en mismatch de dimensión** — respetar dims al ensamblar.
6. **No leakage:** features de regalo/recipient del **detector F2**, nunca de
   `sim_sessions` GT; LTR train-split-only; `intentGT` solo para segmentar reportes.
7. **DB free-tier:** reintentar fallo de conexión inicial (lag de pooler, no pausa).

---

## 8. Criterios de éxito / preguntas a responder

F6 es exitoso si **responde** (no necesariamente confirma):
- **W1:** ¿ensamblado vs popular-cohort en marco justo? lift o déficit con CI.
- **W2:** ¿las conclusiones de F0–F4 se sostienen a n=10000? ¿popular-cohort cae?
- **W3:** ¿orden de rankers y signo de lifts estables entre seeds?
- **W4:** trade-off relevancia↔revenue *verdadero* (separado del confound).
- **W5:** ¿reranker-revenue bate a RRF en revenue@10 con relevancia ≥ umbral?
- **W6:** ¿p99 < 1.5s end-to-end? costo y fallback-rate del LLM.
- **W7:** ¿el pipeline adapta a perfiles extremos o colapsa?
- **W8:** ¿se puede subir precisión del detector sin leakage?
- **W9:** ¿qué fuente del pool aporta qué? (¿NPMI ortogonal confirmado?)
- **W10:** veredicto honesto por afirmación + capítulo en el PDF.

Cada cifra **trazable** a un reporte committeado. Hallazgos negativos se reportan
con el mismo peso que los positivos.

---

## 9. Entregables
- Código: `src/thesis/eval/{unified-cases,assembled,adversarial}.ts`,
  `src/thesis/objectives/relevance-multi.ts`, `src/thesis/rerank/revenue-ltr.ts`,
  7 runners `scripts/thesis/f6-*.ts` (+ scripts pnpm).
- Tests dirigidos (no-mock, aserciones fuertes) por cada módulo nuevo.
- Reportes `docs/superpowers/reports/2026-06-08-thesis-f6-*.{md,json}` (W2–W9 +
  synthesis).
- Capítulo `docs/thesis/11-f6-validacion.md` + `tesis.pdf` recompilado.
- Actualización de memoria del programa con el veredicto F6.

---

## 10. Riesgos / limitaciones honestas
- **El resultado titular puede ser incómodo:** si popular-cohort gana en el marco
  justo a n=2000, se reporta; la escala (W2) dirá si cambia. No se maquilla.
- **Sigue siendo data sintética** → validez externa real solo la daría §8-H (público)
  o el piloto A/B (F5, no ejecutado). F6 fortalece pero no sustituye esa validación.
- **Costo de cómputo:** 5 regeneraciones completas + estudios es la parte lenta;
  mitigado con fundación-primero y seed-sweep sin chunks.
- **Reranker-revenue (W5):** el outcome model es sintético (P·precio·margen); un
  reranker que "gana en revenue" gana en revenue *del modelo*, no de usuarios reales
  (mismo caveat que F4) — se declara explícitamente.
