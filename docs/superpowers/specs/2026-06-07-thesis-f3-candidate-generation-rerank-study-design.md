# Spec — F3: Generación de candidatos multi-fuente + estudio de rerankers

**Fecha:** 2026-06-07
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** cuarto bloque de la elevación a nivel tesis + producto. Construye
sobre F0 (datos + arnés), F1 (embeddings comerciales) y F2 (multi-vector +
regalo). Fase posterior (fuera de alcance): F4 ranking multi-objetivo; F5
escritura / piloto / promoción a producción.

**Specs/planes/reportes previos (leer):**
- F0+F1: `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`
- F2: `docs/superpowers/specs/2026-05-29-thesis-f2-multivector-recipient-gift-design.md`
- F1 resultado: `docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md`
- F2 resultado: `docs/superpowers/reports/2026-05-29-thesis-f2-study.md`
- Audit que motiva F3: `docs/superpowers/reports/2026-05-29-audit-ranker-behavioral.md`
  y `...-verdict-personalizacion-vs-ecommerce-normal.md` ("el reranker LLM no
  cambiaba el set"; el cross-sell vive en el grafo NPMI, no en el coseno).

---

## 1. Objetivo y contribución de tesis

Refutar empíricamente el hallazgo del audit ("el reranker LLM no cambia el set,
solo reordena y escribe frases") demostrando que **estaba hambriento**, no que el
reranking sea inútil. Con (a) un **pool grande multi-fuente** de candidatos
(100–300) y (b) **features que el retrieval no ve** (co-compra NPMI, precio-fit,
señal de regalo de F2, recencia, contexto, fuente), un reranker **sí selecciona y
reordena con lift medible**. Y comparar **cuatro familias de reranker** sobre el
mismo pool.

**Conexión con hallazgos previos:**
- F1 probó que los embeddings (incluso comportamentales) **no recuperan
  complementos** (complement-recall@10 ≈ 0.001). F3 usa la co-ocurrencia NPMI
  como **fuente del pool Y como feature del reranker** — no como vector — que es
  donde sí vive el cross-sell.
- F2 probó que el regalo necesita representación propia. F3 mete la señal de
  regalo/destinatario como **feature** del reranker.
- El audit dijo que el reranker LLM no cambiaba el set; F3 lo mide directamente
  (métrica **set-change@10**) sobre un pool donde sí hay de dónde elegir.

**Aporte SOTA:** pipeline de dos etapas (recuperación multi-fuente → reranking
con features) y un **estudio comparativo de familias de reranker** (LTR, LLM
listwise, cross-encoder de interacción tardía, baselines) bajo restricciones
reales (sin GPU; LLM barato). Defendible y conectado al producto.

---

## 2. Alcance

### En alcance (F3)
- **Backfill de co-ocurrencia** en el esquema `thesis` (poblar `co_occurrence`
  desde los eventos sintéticos) + `recomputeNPMI` → `co_occurrence_top`.
- **Generación de candidatos multi-fuente** → pool 100–300 con `source` por
  candidato: (a) retrieval F2 multi-modo, (b) vecinos NPMI del último ítem,
  (c) popularidad por cohort/destinatario, (d) cuota de exploración/novedad.
- **Extracción de features** por (usuario, candidato).
- **Cuatro familias de reranker** sobre el mismo pool: LTR aprendido, LLM
  listwise (DeepSeek), cross-encoder MaxSim (reusa E4 de F1), baselines
  (MMR + orden RRF del pool).
- **Evaluación** en dos niveles: recall del pool (vs top-30 F2) + lift de cada
  reranker (nDCG/Recall/MRR) **segmentado self/gift** + **set-change@10**.

### Fuera de alcance
- Generar datos nuevos (reusa `thesis` n=2000; solo añade el grafo NPMI).
- Tocar producción `src/sectors/d-personalization/` (promoción es decisión
  posterior con evidencia).
- Ranking multi-objetivo / bandits (F4).
- Cross-encoder con transformer pesado/GPU (usamos la aproximación MaxSim de
  chunks de F1, sin GPU).

### No-objetivos (YAGNI)
- No entrenar un cross-encoder neuronal propio.
- No serving en tiempo real; banco de pruebas offline sobre el arnés.

---

## 3. Decisiones de diseño (del brainstorming)
1. **Núcleo:** pool grande multi-fuente + reranker que cambia el set **+**
   estudio comparativo de familias de reranker.
2. **Fuentes del pool (las 4):** retrieval F2, co-ocurrencia NPMI, popularidad
   cohort/destinatario, exploración/novedad.
3. **Familias de reranker (las 4):** LTR con features, LLM listwise (DeepSeek),
   cross-encoder MaxSim, baselines (MMR + RRF).
4. **Entrenamiento del LTR:** split temporal — etiquetas SOLO del split `train`
   del holdout; el split `test` nunca se ve. Determinista (seed).
5. **Eval:** recall del pool + lift segmentado (self/gift) + set-change@10.

---

## 4. Arquitectura

Código nuevo bajo `src/thesis/rerank/` (librería pura + las que tocan DB en el
runner) y `scripts/thesis/` (backfill + runner). Aislado de producción.

```
thesis.events (co-views) ─► [backfill-cooccurrence] ─► thesis.co_occurrence
                                          │
                                          ▼ recomputeNPMI (prod fn, thesis-scoped)
                                   thesis.co_occurrence_top
                                          │
 E1 vectors + F2 modes ─┐                 │
 last-viewed item ──────┼─► [candidates.ts] multi-source pool (100-300, RRF, source-tagged)
 popular-by-cohort ─────┤                 │
 exploration quota ─────┘                 ▼
                          [features.ts] per (user,candidate) feature vector
                                          │
        ┌──────────────┬──────────────────┼───────────────┬─────────────┐
   [ltr.ts]      [llm-reranker.ts]   [crossencoder.ts]  baselines (MMR, RRF)
   (train split)  (DeepSeek)          (MaxSim chunks)
        └──────────────┴──────────────────┴───────────────┴─────────────┘
                                          ▼
              [scripts/thesis/f3-study.ts]  pool-recall + per-reranker lift
                (segmented self/gift) + set-change@10  → report md/json
```

### 4.1 `scripts/thesis/backfill-cooccurrence.ts` (CLI, toca DB)
- Reconstruye `thesis.co_occurrence` desde `thesis.events`: por cada sesión, los
  pares de productos co-vistos/co-comprados acumulan `count` (peso por tipo de
  evento, igual que `captureCoOccurrence`: view=1, cart=3, purchase=5; par `a<b`).
  Implementado como SQL set-based sobre eventos de la sesión (no fila-a-fila),
  determinista.
- Luego llama `recomputeNPMI(pg)` (función de producción, con cliente
  `scope:"thesis"` → opera sobre tablas `thesis` por search_path) → puebla
  `thesis.co_occurrence_top` (top-50 NPMI>0 por producto, simétrico).
- CLI `pnpm thesis:backfill-cooccurrence`. Idempotente (TRUNCATE + rebuild).
- **Validación esperada:** los vecinos NPMI de un producto deben recuperar sus
  complementos del grafo GT de F0 (`gt_product_relations` type=complement) mucho
  mejor que el coseno de texto — replica el test de discriminación de F0 pero por
  NPMI, confirmando que la fuente trae cross-sell real.

### 4.2 `src/thesis/rerank/candidates.ts` (puro, sobre estructuras en memoria)
- `buildCandidatePool(opts): PooledCandidate[]` con
  `PooledCandidate = { id: string; sources: string[]; rrf_score: number }`.
- Entradas: listas rankeadas de las 4 fuentes (cada una `string[]` de ids en
  orden), construidas por el runner desde DB. Fusiona con `rrfFuse` (reusa el del
  repo) y corta a `poolSize` (default 200). Registra de qué `sources` vino cada
  id (para la feature de fuente y el análisis).
- Determinista; sin DB (el runner arma las listas y se las pasa).

### 4.3 `src/thesis/rerank/features.ts` (puro)
- `extractFeatures(ctx, cand): number[]` + `FEATURE_NAMES: string[]` (para
  interpretabilidad/tesis). Features por (usuario, candidato):
  - `retrievalScore` (mejor coseno del candidato a los modos F2 del usuario),
  - `npmiScore` (NPMI co-compra del candidato con el último ítem visto; 0 si no),
  - `priceFit` (1 − |precio_cand − presupuesto_usuario| normalizado),
  - `demoMatch` (match género/edad con el comprador o, si regalo, el destinatario),
  - `isGiftContext` (0/1 de la detección F2),
  - `recency` (recencia del último ítem que ancló la co-ocurrencia),
  - `popularity` (log-popularidad del candidato),
  - one-hot de `source` (retrieval / npmi / popular / exploration).
- Determinista; no lee GT de etiquetas (solo metadata de catálogo + señales
  derivables en inferencia).

### 4.4 `src/thesis/rerank/ltr.ts` (puro, entrenable, determinista)
- `trainLTR(samples, opts): LtrModel` — regresión logística con SGD por mini-lotes
  (pesos por feature; sin librerías de ML; RNG sembrado). `samples` = pares
  (features, label) construidos SOLO del split train: positivos = ítems realmente
  comprados; negativos = muestreo del pool no comprado.
- `LtrModel.score(features): number`; `scoreToRanker(model): Ranker` (ordena el
  pool por score). Reporta los pesos aprendidos (interpretabilidad).

### 4.5 `src/thesis/rerank/crossencoder.ts` (puro)
- `maxSimReranker(itemChunks, queryChunksFor): Ranker` — reusa la maquinaria
  MaxSim de F1 (E4) como reranker de interacción tardía: puntúa cada candidato por
  MaxSim entre los chunks de la query del usuario y los del candidato. Sin GPU.

### 4.6 `src/thesis/rerank/llm-reranker.ts` (toca LLM, sin mock)
- `llmRerank(topN, ctx): Promise<string[]>` — LLM listwise (DeepSeek vía
  `defaultProvider`) sobre el top-N del pool (N=30 por costo), con las features
  resumidas en el prompt. Zod-valida la salida (ranks únicos, ids del pool).
  Fallback determinista (orden del pool) si el LLM falla — y el runner **cuenta el
  fallback rate** (corrige el "fallback silencioso" que marcó el audit).

### 4.7 baselines
- MMR (reusa `mmrSelect` de producción) + orden RRF del pool. Pisos de referencia.

### 4.8 `scripts/thesis/f3-study.ts` (toca DB, sin mocks)
- Arma las 4 listas-fuente por usuario desde DB, construye el pool, extrae
  features, entrena el LTR en train, corre los 4 rerankers + baselines sobre el
  pool del split test, evalúa con el arnés F0, emite reporte md/JSON.

---

## 5. Evaluación (recall del pool + lift segmentado + set-change)
- **Recall del pool:** fracción de holdout-test cuya compra futura está en el
  pool (100–300), comparada con el recall del top-30 de F2 → demuestra que el
  pool grande **captura más** (es el techo que el reranker puede alcanzar).
- **Lift de rerankers:** nDCG@{5,10,20}, Recall@k, MRR de cada familia (LTR, LLM,
  cross-encoder) **y** baselines (MMR, RRF), sobre el mismo pool, **segmentado
  self/gift** (usando `sim_sessions.intent`, solo para bucketing).
- **set-change@10:** fracción del top-10 de cada reranker que difiere del top-10
  del orden base del pool (RRF) — métrica directa que refuta "no cambiaba el set".
  Reportada junto al lift para mostrar que cambio≠ruido (cambia Y mejora).
- **LLM:** además reporta fallback-rate y (opcional) un costo/latencia informativo.
- **Comparación justa:** todos los rerankers operan sobre el MISMO pool y el mismo
  conjunto de casos; métricas por posición; GT (`intent`, compra futura) solo para
  segmentar/etiquetar, **nunca** como feature en inferencia del test.

---

## 6. Flujo de datos
1. `pnpm thesis:backfill-cooccurrence` → `thesis.co_occurrence` + `co_occurrence_top`.
2. `f3-study` lee E1, modes F2, último-visto, popular-by-cohort, NPMI top, holdout,
   sim_sessions, metadata.
3. Por usuario test: 4 listas-fuente → `buildCandidatePool` → features → rerankers.
4. LTR entrena en train; los 4 rerankers + baselines rankean el pool de test.
5. Arnés F0 → recall del pool + lift segmentado + set-change → reporte md/JSON.

---

## 7. Estrategia de testing (tests reales, sin mocks; `pnpm test:quality` lo enforza)
- **Unit (puros):** `candidates` (fusión RRF determinista, source-tagging, corte a
  poolSize), `features` (known-answer por feature; FEATURE_NAMES alineado),
  `ltr` (corpus-juguete con señal conocida: una feature perfectamente predictiva
  → su peso domina; determinismo por seed), `crossencoder` (MaxSim known-answer),
  set-change metric known-answer.
- **Integración (DB `thesis` real):** backfill puebla co_occurrence_top no vacío;
  los vecinos NPMI recuperan complementos GT mejor que el coseno (discriminación);
  el pool tiene mayor recall que el top-30 F2; el LTR supera a RRF/MMR en nDCG@10
  sobre el pool (mundo pequeño).
- **LLM (DeepSeek real, sin mock):** smoke de `llmRerank` que valida shape zod y
  que el fallback se cuenta cuando la key es inválida.
- **Determinismo:** misma seed/datos ⇒ mismas métricas (excepto la fila LLM, que
  se reporta con su variabilidad).

---

## 8. Criterios de aceptación
1. **Pool recall > F2 top-30 recall** (el pool grande captura más compras futuras).
2. **Al menos un reranker (LTR) supera a los baselines** (MMR/RRF) en nDCG@10
   sobre el pool, con set-change@10 alto → cambia el set Y mejora.
3. **Tabla comparativa** de las 4 familias, segmentada self/gift, con la métrica
   set-change y (LLM) fallback-rate — refuta o matiza el hallazgo del audit con
   números.
4. **NPMI trae cross-sell:** los vecinos NPMI recuperan complementos GT mucho
   mejor que el coseno (test de discriminación verde).
5. **Higiene:** `pnpm typecheck` y `pnpm test:quality` verdes; tests nuevos
   verdes; no toca producción; reporte reproducible desde seed; sin leakage del
   split test al LTR.

---

## 9. Riesgos y mitigaciones
- **co_occurrence vacía / NPMI pobre:** el backfill reconstruye desde eventos; si
  el grafo sale ralo, se reporta densidad y se baja `MIN_COUNT_FOR_NPMI` con
  caveat. (El generador F0 siembra co-vistas que siguen el grafo GT, así que debe
  haber señal.)
- **LLM listwise caro/variable:** N=30, fallback contado, fila LLM marcada como
  no-determinista; el LTR es el resultado defendible primario.
- **LTR overfit al sintético:** features generales (no parámetros del generador);
  split temporal; reportar pesos aprendidos para interpretabilidad.
- **Pool destruye dataset:** F3 NO trunca `products`; el backfill solo toca
  `co_occurrence*`. (Recordatorio del hazard de F2: el test F0 de discriminación
  ya está aislado por transacción.)
- **Leakage:** el LTR jamás ve el split test; las features no incluyen la etiqueta.

---

## 10. Referencias
- LLM4Rerank (WWW 2025); REARANK (arXiv 2505.20046); RankGPT/Zephyr — LLM listwise.
- ColBERT / ColBERTv2; Jina-ColBERT-v2 — interacción tardía (la aprox. MaxSim).
- Learning-to-rank: LambdaMART / logistic LTR (features comerciales).
- Cormack et al., RRF (SIGIR 2009) — fusión multi-fuente.
- Audit/verdict de este repo — la crítica empírica que F3 contesta.

---

## 11. Secuencia de implementación (para el plan)
1. set-change@k en métricas (+ test known-answer).
2. `backfill-cooccurrence` CLI + recomputeNPMI thesis-scoped + test de
   discriminación NPMI vs coseno.
3. `candidates.ts` (pool multi-fuente RRF) + tests puros.
4. `features.ts` (+ FEATURE_NAMES) + tests known-answer.
5. `ltr.ts` (logistic SGD, train-split) + tests puros.
6. `crossencoder.ts` (MaxSim reranker) + tests puros.
7. `llm-reranker.ts` (DeepSeek listwise + fallback contado) + smoke real.
8. `f3-study.ts` runner: pool-recall + 4 familias + baselines, segmentado +
   set-change + fallback-rate.
9. Corrida end-to-end (n=2000, seed 42) + reporte md/JSON.
10. Test de integración (pool recall > F2; LTR > baselines) + verificación final.
