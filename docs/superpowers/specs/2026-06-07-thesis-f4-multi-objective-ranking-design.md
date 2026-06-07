# Spec — F4: Ranking multi-objetivo aprendido

**Fecha:** 2026-06-07
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** quinta fase. Construye sobre F0 (datos+eval), F1 (embeddings),
F2 (multi-vector+regalo), F3 (pool multi-fuente + rerankers). Fase posterior
(fuera de alcance): F5 escritura / piloto / promoción a producción.

**Specs/planes/reportes previos (leer):**
- F3 design: `docs/superpowers/specs/2026-06-07-thesis-f3-candidate-generation-rerank-study-design.md`
- F3 resultado: `docs/superpowers/reports/2026-06-07-thesis-f3-study.md`
- F2 design+resultado, F1 resultado (refrescados @ `0b4ddc5`).
- Motivación: `feedback_comphrensive.md` **Idea 3** ("El ranking final no es un
  score, es una negociación entre objetivos"), línea 109: `s(p|u)=Σ λ_k·f_k(p,u)`.

---

## 1. Objetivo y contribución de tesis

Cerrar el arco del programa. F3 estableció (resultado honesto) que un reranker
**cambia el set pero NO le gana al RRF optimizando solo relevancia** — porque
relevancia es el único objetivo. F4 demuestra que el reranking **sí gana cuando
negocia múltiples objetivos competidores**: `s(p|u) = Σ_k λ_k · f_k(p,u)`.

**Aporte (defendible en tesis):** la **frontera de Pareto** entre relevancia,
revenue, diversidad, novedad y fairness de vendedores, y la prueba cuantitativa
de que "subir revenue cuesta X de relevancia" — convirtiendo el ranking de un
score implícito (`λ_relevance=1`, todo lo demás 0, que es lo que hace todo el
sistema hasta F3) en una **decisión de negocio explícita y medible**.

**Conexión con hallazgos previos:**
- F3: RRF-fusion gana en relevancia pura → es el baseline a batir EN REVENUE.
- F1: los embeddings dan relevancia, no complementariedad → relevancia es solo
  uno de los `f_k`.
- F2: la señal de regalo es contexto que puede modular el mix de objetivos.

---

## 2. Alcance

### En alcance (F4)
- **Extensión del generador (negocio):** cada producto recibe `margin_pct`,
  `stock_health`, `seller_id`, `seller_age_days` (en `metadata` jsonb — sin
  migración). Determinista por seed.
- **Outcome model:** `expectedRevenue(user,product) = P(compra|user,p) · price ·
  margin_pct`, con `P(compra)` derivada del MISMO modelo de afinidad latente del
  generador (verdad conocida). Es el ground-truth de negocio por ranking.
- **Objective features `f_k`** (normalizadas [0,1]): relevance, margin, convProb,
  diversity (marginal), novelty, sellerFairness.
- **Multi-objective scorer:** `s(p|u)=Σ λ_k·f_k`; selección greedy estilo MMR para
  el término de diversidad marginal.
- **Pareto sweep:** grilla determinista de λ → vector de métricas por config →
  frente de Pareto → selección por **KPI compuesto** (revenue@10 con guardrails de
  relevancia y fairness mínimos).
- **Métricas nuevas:** `revenueAtK`, `sellerExposureGini` (diversidad/novedad ya
  existen en `eval/metrics.ts`).
- **Eval:** multi-métrica por config vs baseline **F3-RRF** (solo-relevancia) +
  frontera de Pareto + punto KPI.

### Fuera de alcance
- Contextual bandit / λ por-usuario (considerado; queda como F4.5 si la evidencia
  lo pide — el resultado primario es la frontera de Pareto global).
- Tocar producción `src/sectors/d-personalization/`.
- Promoción / piloto online (F5).

### No-objetivos (YAGNI)
- No optimización online; el sweep es offline sobre el holdout.
- No aprender `f_k` (son señales calibradas conocidas); F4 aprende los **pesos**
  `λ`, no las features.

---

## 3. Decisiones de diseño (del brainstorming)
1. **Núcleo:** extender generador (negocio + outcome) + ranker multi-objetivo
   aprendido, medido en relevancia Y negocio.
2. **Objetivos `f_k`:** relevancia + margen + conversión + diversidad + novedad +
   fairness de vendedores.
3. **Aprender λ:** barrido + frontera de Pareto, selección por KPI compuesto
   (determinista, interpretable, sin online).
4. **Outcome model:** `P(compra)·precio·margen`, con `P(compra)` del modelo
   latente conocido del generador.
5. **Eval:** multi-métrica vs F3-RRF + frontera de Pareto + punto KPI.

---

## 4. Arquitectura

Código nuevo bajo `src/thesis/objectives/` (librería pura) + extensión del
generador en `src/thesis/data/` + runner en `scripts/thesis/`. Aislado de
producción.

```
catalog-model (+ business fields) ─► thesis.products.metadata {margin_pct, stock_health, seller_id, seller_age_days}
                                          │
 outcome.ts: expectedRevenue = P(buy|u,p)·price·margin   (P from latent affinity model)
                                          │
 objective-features.ts: f_k(u,p) ∈ [0,1]^6  (relevance,margin,convProb,diversity,novelty,sellerFairness)
                                          │
 scorer.ts: multiObjectiveRanker(λ) → greedy MMR-style over pool  (Ranker)
                                          │
 pareto.ts: sweep λ-grid → metric vectors → Pareto frontier → KPI pick
                                          │
 scripts/thesis/f4-study.ts: pool (F3) → features → sweep → multi-metric vs F3-RRF → report md/json
```

### 4.1 Generador — campos de negocio (`src/thesis/data/catalog-model.ts` + `scripts/thesis/data/catalog-gen.ts`)
- `SynthProduct` gana: `margin_pct` (0..1), `stock_health` (0..1), `seller_id`
  (string), `seller_age_days` (int). Todos vía el rng sembrado del catálogo.
- **Anti-correlación intencional (clave para que exista trade-off):** `margin_pct`
  se sortea parcialmente **anti-correlacionado con la banda de precio/popularidad
  esperada** — lo más caro/mainstream tiende a menor margen, la cola larga a mayor
  margen (como en retail real). Sin esto, el ítem más relevante sería también el
  más rentable y NO habría negociación que demostrar. Documentado y verificable.
- `catalog-gen.ts` persiste estos campos en `thesis.products.metadata` (jsonb —
  **sin migración nueva**). `seller_id` de un pool pequeño (~30 vendedores) con
  `seller_age_days` variado (algunos "nuevos" <30d).

### 4.2 Outcome model (`src/thesis/objectives/outcome.ts`, puro)
- `purchaseProbability(affinity: number, opts): number` — reconstituye P(compra)
  desde el score de afinidad del generador (la misma forma: softmax/logística
  sobre afinidad·β − penalización de precio), normalizada a [0,1]. El generador
  exporta su función de afinidad para que outcome reuse EXACTAMENTE la misma
  (sin re-derivar) — fuente única de verdad.
- `expectedRevenue({affinity, price_cents, margin_pct}): number` =
  `purchaseProbability(...) · price_cents · margin_pct`.
- Es ground-truth de NEGOCIO: se usa para MEDIR (revenue@k) y para el `convProb`
  feature, pero el ranker no recibe la etiqueta de compra futura.

### 4.3 Objective features (`src/thesis/objectives/objective-features.ts`, puro)
- `OBJECTIVE_NAMES = ["relevance","margin","convProb","novelty","sellerFairness"]`
  (diversity es marginal → se computa en el scorer, no aquí). Cada `f_k ∈ [0,1]`:
  - `relevance` = max coseno a los modos F2 del usuario (normalizado).
  - `margin` = `margin_pct`.
  - `convProb` = `purchaseProbability` del candidato (de outcome).
  - `novelty` = popularidad invertida normalizada (reusa la idea de `novelty`).
  - `sellerFairness` = boost a vendedores nuevos (p.ej. `1/(1+seller_age_days/30)`).
- `extractObjectiveFeatures(ctx, cand): Record<name, number>`. Determinista.

### 4.4 Scorer (`src/thesis/objectives/scorer.ts`, puro)
- `multiObjectiveRanker(weights: Record<name,number>, opts): Ranker`. Implementa el
  contrato `Ranker` de F0. Selección **greedy**: en cada paso elige el candidato
  que maximiza `Σ λ_k·f_k + λ_diversity·diversityMarginal(cand, yaElegidos)`, donde
  `diversityMarginal = 1 − max sim a los ya seleccionados` (estilo MMR, reusa
  cosine). Diversidad como término marginal exige greedy (no un sort estático).
- Determinista (desempate por id). λ_diversity es uno más de los pesos.

### 4.5 Métricas nuevas (append a `src/thesis/eval/metrics.ts`)
- `revenueAtK(ranked, expectedRevenueById, k)` = suma del revenue esperado de los
  top-k (GMV esperado del feed). Con test known-answer.
- `sellerExposureGini(ranked, sellerById, k)` = Gini de la distribución de
  exposición por vendedor en el top-k (0 = equitativo, →1 = concentrado); fairness
  = `1 − gini` o se reporta el Gini directamente. Test known-answer.
- (Reusa `intraListDiversity`, `novelty` existentes.)

### 4.6 Pareto sweep (`src/thesis/objectives/pareto.ts`, puro)
- `sweepPareto(configs: λ[], evalFn): { all: {weights, metrics}[]; frontier: ...; kpiPick: ... }`.
  `evalFn(weights) → metricVector` lo provee el runner (corre el scorer sobre los
  casos y agrega). 
- `paretoFrontier(points, objectives)` — set no-dominado (maximizar revenue,
  relevance, diversity, fairness; el runner define el sentido). Test known-answer
  sobre puntos plantados.
- `pickByKpi(frontier, kpi)` — elige el punto que maximiza un KPI compuesto
  (revenue@10) sujeto a guardrails (relevancia ≥ α·relevancia_RRF, fairness ≥
  umbral). Documentado.

### 4.7 Runner (`scripts/thesis/f4-study.ts`, toca DB, sin mocks)
- Reusa el pool de F3 por usuario test (mismo candidate set → comparación justa).
- Computa features de objetivos + expectedRevenue por candidato.
- Barre la grilla de λ (determinista); para cada config corre `multiObjectiveRanker`
  sobre el pool y agrega el vector de métricas (nDCG@10, revenue@10, diversity,
  novelty, sellerGini) — más el baseline **F3-RRF** (λ_relevance=1).
- Extrae la frontera de Pareto, selecciona el punto KPI, escribe
  `docs/superpowers/reports/2026-06-07-thesis-f4-study.md` (+ JSON con todos los
  puntos para graficar la frontera).

---

## 5. Evaluación
- **Por config de λ:** el VECTOR { nDCG@10, revenue@10, intraListDiversity@10,
  novelty@10, sellerExposureGini@10 }, agregado sobre los casos test.
- **Baseline:** F3-RRF (λ_relevance=1, resto 0) — solo-relevancia.
- **Resultado central:** la **frontera de Pareto** (relevancia↓ a cambio de
  revenue↑, etc.) y el **punto KPI**; demostrar que el punto KPI **domina al RRF
  en revenue@10 con pérdida de relevancia acotada** (guardrail). Esto ES "el
  ranking es una negociación".
- **Comparación justa:** mismo pool de F3, métricas por posición; el outcome model
  y la compra futura son ground-truth de MEDICIÓN, nunca features de inferencia
  (sin leakage: `convProb` usa P(compra) estimable, no la compra realizada).

---

## 6. Flujo de datos
1. Extensión generador → regenerar dataset (seed 42) con campos de negocio.
2. (co-occurrence/embeddings ya presentes; revenue/features se computan en runner.)
3. `f4-study` lee pool F3 + metadata de negocio + modos F2; computa features +
   expectedRevenue; barre λ; agrega métricas; Pareto; KPI; reporte.

---

## 7. Estrategia de testing (tests reales, sin mocks)
- **Unit (puros):** outcome (P(compra) monotónica en afinidad; revenue = P·price·margin
  known-answer), objective-features (cada f_k known-answer; rango [0,1]), scorer
  (un λ solo-margen ordena por margen; solo-relevancia = ranking por coseno;
  diversidad marginal evita duplicados; determinismo), revenueAtK + sellerExposureGini
  known-answer, paretoFrontier (set no-dominado correcto sobre puntos plantados),
  pickByKpi (respeta guardrails).
- **Integración (DB `thesis`):** un λ con peso en margen sube revenue@10 y baja
  nDCG@10 vs solo-relevancia (el trade-off existe y es medible); el punto KPI bate
  a F3-RRF en revenue con relevancia ≥ guardrail.
- **Determinismo:** misma seed/grilla ⇒ mismas métricas y misma frontera.

---

## 8. Criterios de aceptación
1. **Existe trade-off:** subir λ_margin sube revenue@10 y baja nDCG@10 (medido) —
   si no, la anti-correlación margen-relevancia del generador es insuficiente
   (ajustar y documentar).
2. **Frontera de Pareto** no trivial (>1 punto no-dominado) reportada con su JSON.
3. **El punto KPI domina a F3-RRF en revenue@10** con relevancia dentro del
   guardrail y mejor (o igual) diversidad/fairness — la negociación rinde.
4. **Higiene:** `pnpm typecheck` + `pnpm test:quality` verdes; tests nuevos verdes;
   sin leakage; no toca producción; reporte reproducible desde seed.

---

## 9. Riesgos y mitigaciones
- **Sin trade-off real → resultado vacío:** se fuerza la anti-correlación
  margen↔precio/popularidad en el generador; un test de integración verifica que
  el trade-off aparece; si no, se ajusta el coeficiente (documentado, no oculto).
- **Circularidad del outcome:** `convProb` (feature) y revenue (métrica) ambos
  usan P(compra) — pero el ranker NO ve la compra futura ni el outcome realizado;
  optimiza features estimables y se mide contra revenue ground-truth. Documentar
  que P(compra) estimada ≠ compra holdout (son señales distintas).
- **Dataset regenerado invalida F1/F2/F3 números:** los campos de negocio son
  aditivos (no cambian taste/co-occurrence), así que F1/F2/F3 se mantienen; aun
  así, tras F4 re-correr los runners previos sobre el dataset extendido para que
  todo el programa comparta un solo dataset final (igual que se hizo tras F3).
- **Gini/fairness mal definido:** test known-answer fija la fórmula.

---

## 10. Referencias
- `feedback_comphrensive.md` Idea 3 (multi-objective ranking, `s=Σλ_k f_k`, bandits).
- Multi-objective recsys: Pareto-efficient ranking; constrained MOO (Airbnb 2024);
  MOO-by-distillation (arXiv 2407.07181); Diversify & Conquer (2309.14046).
- MMR (Carbonell & Goldstein) — término de diversidad marginal greedy.
- F3 report — el baseline RRF y el pool que F4 reordena.

---

## 11. Secuencia de implementación (para el plan)
1. Generador: campos de negocio (margin/stock/seller) + anti-correlación + persist; regenerar.
2. `revenueAtK` + `sellerExposureGini` en métricas (+ tests known-answer).
3. `outcome.ts` (P(compra) reusando afinidad del generador + expectedRevenue) + tests.
4. `objective-features.ts` (las 5 f_k puntuales + rango) + tests.
5. `scorer.ts` (multiObjectiveRanker greedy + diversidad marginal) + tests.
6. `pareto.ts` (frontier + pickByKpi) + tests.
7. `f4-study.ts` runner: pool F3 → features → sweep λ → multi-métrica vs RRF →
   frontera + KPI → reporte md/JSON.
8. Corrida end-to-end (seed 42) + reporte.
9. Test de integración (trade-off existe; KPI bate RRF en revenue) + verificación final.
