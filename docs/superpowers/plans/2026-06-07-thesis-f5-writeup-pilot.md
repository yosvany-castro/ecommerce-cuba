# Thesis F5 — Write-up + Pilot Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synthesize the committed F0–F4 results into an academic thesis document (Spanish Markdown chapters under `docs/thesis/`, compiled to one `tesis.pdf` via pandoc+xelatex) plus a final chapter that designs — without executing — the production A/B pilot.

**Architecture:** One Markdown file per chapter in `docs/thesis/`, a pandoc YAML metadata file, and a `build.sh`/`Makefile` that compile the chapters in order to `tesis.pdf`. This is a prose+build deliverable, NOT code: each task writes a chapter whose every results figure is quoted verbatim from a committed report, then a verification pass confirms number↔report traceability and that the PDF compiles. No `src/`, production, or dataset changes.

**Tech Stack:** Markdown, pandoc 3.1.3 + xelatex (installed + smoke-tested this session). Spanish prose; SOTA terms in English where standard.

**Spec:** `docs/superpowers/specs/2026-06-07-thesis-f5-writeup-pilot-design.md`

---

## Source-of-truth numbers (quote these EXACTLY; do not estimate)
All figures below are copied from the committed reports. Each chapter task repeats the subset it needs; an implementer reading one task out of order still has its numbers.

- **F0 baseline** (`docs/superpowers/reports/2026-05-29-thesis-f0-baseline-eval.md`, 282 cases, n=400 catalog/200 users, seed 42): nDCG@10 — random 0.017, popular-global 0.017, cosine-single-vector 0.150, popular-cohort 0.486. Recall@10 — popular-global 0.043 (NON-zero → F3c empty-baseline bug fixed). cosine ≫ random (8.8×).
- **F1 embeddings** (`...thesis-f1-embedding-study.md`, n=2000, common universe 1999, 1098 cases): nDCG@10 — e2_hybrid 0.124, e1_prod2vec 0.101, e3_two_tower 0.049, e5_context3 0.039, e0_text 0.038, e4_late 0.039. Recall@10 — e2_hybrid 0.252, e1 0.219, rest ≤0.094. complement-recall@10 ≈ 0.000–0.002 for ALL six. Production pick: e2_hybrid.
- **F2 multivector+gift** (`...thesis-f2-study.md`, common universe 1999, 1098 cases): overall nDCG@10 F2 0.152 vs F1-single 0.101; Recall@10 0.310 vs 0.219. gift|1mode (n=287) F2 0.063 vs 0.013; gift|2-3modes (n=62) F2 0.072 vs 0.006; self|1mode (n=598) 0.200 vs 0.151; self|2-3modes (n=151) 0.163 vs 0.109. Gift detection (n=1098): TP=135 FP=179 FN=214 TN=570 → precision 0.430 / recall 0.387 / F1 0.407. Recipient-fit@10 (gift, n=349): F2 0.476 vs F1 0.285.
- **F3 pool+rerank** (`...thesis-f3-study.md`, common universe 1999, 1098 cases, pool 200): pool recall 0.839 (921/1098) vs F2 top-30 recall 0.410 (450/1098). nDCG@10 | Recall@10 | MRR | set-change@10: baseline-rrf 0.177 | 0.336 | 0.145 | 0.000; mmr 0.125 | 0.204 | 0.119 | 0.527; cross-encoder 0.055 | 0.120 | 0.053 | 0.821; ltr 0.121 | 0.250 | 0.100 | 0.578. Finding: no reranker beats RRF on nDCG@10; set-change>0 refutes "doesn't change the set"; value is the pool. NPMI recovers GT complements text-cosine misses (npmiHits 7 > cosHits 0 in `tests/thesis/f3-cooccurrence.test.ts`).
- **F4 multi-objective** (`...thesis-f4-study.md`, common universe 1998, 1107 cases, 300 swept, pool 200, 24-config λ-grid): baseline F3-RRF nDCG@10 0.202, revenue@10 29702.21, sellerGini 0.103. Frontier 23/24 configs. Revenue-max cfg18 (λ rel=1,rev=1,div=0.5): relevance 0.056 (−72.4%), revenue 52523.96 (+76.8%) — FALLBACK, guardrail infeasible 0/24. Knee (min-max) cfg8 (λ rel=1,rev=0.5): relevance 0.081 (−59.8%), revenue 48498.10 (+63.3%), relN 0.529 revN 0.842. Attribution caveat: the −relevance% conflates the true revenue trade-off with a single-signal-relevance-feature-vs-4-source-RRF baseline mismatch.

---

## File Structure (all under `docs/thesis/`)
- `00-metadata.md` — pandoc YAML (title/author/date/abstract/lang/toc/xelatex).
- `01-introduccion.md`, `02-related-work.md`, `03-metodologia.md`,
  `04-f1-embeddings.md`, `05-f2-multivector.md`, `06-f3-rerank.md`,
  `07-f4-multiobjetivo.md`, `08-discusion.md`, `09-conclusion-trabajo-futuro.md`,
  `10-plan-piloto.md`, `README.md`, `build.sh`, `Makefile`.
- Output: `tesis.pdf` (committed at the end).

Writing order (spec §9): scaffold → methodology → F1 → F2 → F3 → F4 → related-work → intro+abstract → discussion+conclusion → pilot → compile+verify. (Intro/abstract last so they reflect what was actually found.)

---

## Task 1: Scaffold (metadata, README, build script)

**Files:** Create `docs/thesis/00-metadata.md`, `docs/thesis/README.md`, `docs/thesis/build.sh`, `docs/thesis/Makefile`

- [ ] **Step 1: Write `docs/thesis/00-metadata.md`**

```markdown
---
title: "Personalización de ranking para e-commerce reseller: un estudio empírico de embeddings comerciales, representación multi-vector del usuario, reranking contextual y ranking multi-objetivo"
author: "Yosvany Castro"
date: "2026"
lang: es
toc: true
toc-depth: 2
numbersections: true
geometry: margin=2.5cm
fontsize: 11pt
pdf-engine: xelatex
abstract: |
  Este trabajo eleva el pipeline de personalización de un e-commerce reseller
  (reventa de catálogo Amazon/AliExpress sin stock físico, donde cada llamada al
  agregador tiene costo real) desde una heurística de relevancia única a un
  sistema de ranking de dos etapas evaluado con rigor. Sobre un simulador de
  marketplace con verdad de fondo conocida y un arnés de evaluación con holdout
  temporal, se estudian empíricamente cuatro contribuciones: (1) embeddings
  comerciales (texto, Prod2Vec, híbrido, two-tower, late-interaction,
  contextualizado), hallando que capturan relevancia pero no complementariedad;
  (2) representación multi-vector del usuario con un modelo explícito de regalo,
  que supera al vector único sobre todo en sesiones de regalo; (3) un pool de
  candidatos multi-fuente con cuatro familias de reranker, que cambian el
  conjunto recuperado pero no superan a la fusión RRF en relevancia pura; y
  (4) ranking multi-objetivo, cuya frontera de Pareto permite negociar
  explícitamente relevancia y revenue. Se reportan los hallazgos negativos con la
  misma honestidad que los positivos, y se diseña —sin ejecutarlo— un piloto A/B
  para producción.
---
```

- [ ] **Step 2: Write `docs/thesis/build.sh`**

```bash
#!/usr/bin/env bash
# Compile the thesis chapters (in order) into a single PDF via pandoc + xelatex.
set -euo pipefail
cd "$(dirname "$0")"
pandoc \
  00-metadata.md \
  01-introduccion.md \
  02-related-work.md \
  03-metodologia.md \
  04-f1-embeddings.md \
  05-f2-multivector.md \
  06-f3-rerank.md \
  07-f4-multiobjetivo.md \
  08-discusion.md \
  09-conclusion-trabajo-futuro.md \
  10-plan-piloto.md \
  -o tesis.pdf \
  --pdf-engine=xelatex \
  --toc --number-sections
echo "[thesis] wrote tesis.pdf"
```

- [ ] **Step 3: Write `docs/thesis/Makefile`**

```make
.PHONY: pdf clean
pdf:
	bash build.sh
clean:
	rm -f tesis.pdf
```

- [ ] **Step 4: Write `docs/thesis/README.md`**

```markdown
# Tesis — Personalización de ranking (programa F0–F5)

Documento de tesis sintetizando el programa F0–F4. Capítulos en Markdown,
compilados a un único PDF.

## Capítulos
1. `01-introduccion.md` — problema, crítica de partida, contribuciones.
2. `02-related-work.md` — estado del arte.
3. `03-metodologia.md` — simulador con ground-truth + arnés de evaluación.
4. `04-f1-embeddings.md` — estudio de embeddings comerciales.
5. `05-f2-multivector.md` — usuario multi-vector + modelo de regalo.
6. `06-f3-rerank.md` — pool multi-fuente + estudio de rerankers.
7. `07-f4-multiobjetivo.md` — ranking multi-objetivo y frontera de Pareto.
8. `08-discusion.md` — discusión, límites, validez.
9. `09-conclusion-trabajo-futuro.md` — conclusión y trabajo futuro.
10. `10-plan-piloto.md` — diseño del piloto A/B (no ejecutado).

## Compilar el PDF
Requiere `pandoc` y `xelatex` (`sudo apt-get install -y pandoc texlive-xetex texlive-fonts-recommended`).

```bash
bash docs/thesis/build.sh   # → docs/thesis/tesis.pdf
# o:  make -C docs/thesis pdf
```

## Trazabilidad
Toda cifra de resultados se cita de un reporte commiteado en
`docs/superpowers/reports/` (F0 baseline, F1, F2, F3, F4). Ninguna cifra es
estimada.
```

- [ ] **Step 5: Make build.sh executable and commit (no compile yet — chapters don't exist)**

```bash
chmod +x docs/thesis/build.sh
git add docs/thesis/00-metadata.md docs/thesis/README.md docs/thesis/build.sh docs/thesis/Makefile
git commit -m "docs(thesis): F5 scaffold — pandoc metadata, build script, README"
```

---

## Task 2: Methodology chapter

**Files:** Create `docs/thesis/03-metodologia.md`

- [ ] **Step 1: Write the chapter**

Write `docs/thesis/03-metodologia.md` in Spanish, `# Metodología` as the top heading. Cover, drawing on the F0/F2/F3/F4 specs (cite them as design docs, not numbers):
- **El simulador de marketplace con verdad de fondo.** Catálogo sintético (~2000 productos, taxonomía categoría×subcategoría×marca×género×edad×banda-precio×estilo, en español, embeddings Voyage reales) con un `factor_vector` latente conocido por producto; un grafo de complementariedad ground-truth (complemento/sustituto por reglas de taxonomía); un generador de comportamiento con estado latente conocido (mezcla de clusters de gusto, destinatarios/regalo con `p_gift`, sensibilidad a precio) que produce sesiones temporales y co-ocurrencia intra-sesión sembrada desde el grafo de complementos; y campos de negocio (margen anti-correlacionado con la banda de precio, stock, vendedor) para F4.
- **Por qué ground-truth.** Conocer el gusto real, la intención por sesión, los complementos y la "próxima compra" permite holdout temporal sin fuga y ablations que atribuyen el lift a cada componente — imposible con datos puramente observacionales.
- **El arnés de evaluación.** Split temporal leave-one-out (última sesión de compra → test; el resto → train); suite de métricas (Recall@k, nDCG@k, MRR, MAP, HitRate; diversidad intra-lista, novedad, Gini de exposición; complement-recall, recipient-fit, set-change, revenue@k); baselines (random, popular-global, popular-cohort, cosine-single-vector); estimadores OPE (IPS/SNIPS/DR); todo determinista por seed.
- **Disciplina de datos reales.** Sin mocks de DB/LLM/embeddings (enforzado por un AST checker); cada estudio corre contra Postgres real y la API Voyage real.
- **Caveat de escala y validez externa.** El baseline-eval inicial (F0) se midió a n=400; los estudios por fase (F1–F4) corren sobre el dataset regenerado a n=2000 (con complementos y campos de negocio). NO se mezclan cifras de escalas distintas en una misma tabla. El dataset es sintético; la validez externa (cross-check sobre un dataset público de sesiones) queda como trabajo futuro (adaptador `thesis:public` listo, pendiente de dataset).
- Cita los specs: `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`, `...f2-...`, `...f3-...`, `...f4-...`.

- [ ] **Step 2: Verify it compiles in isolation**

Run: `cd docs/thesis && pandoc 00-metadata.md 03-metodologia.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -`
Expected: `OK` (no LaTeX error; catches bad math/escapes early).

- [ ] **Step 3: Commit**

```bash
git add docs/thesis/03-metodologia.md
git commit -m "docs(thesis): methodology chapter (synthetic ground-truth + eval harness)"
```

---

## Task 3: F1 embeddings chapter

**Files:** Create `docs/thesis/04-f1-embeddings.md`

- [ ] **Step 1: Write the chapter** (`# Embeddings comerciales (F1)`, Spanish)

Content + the EXACT table (quote from `docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md`):
- Framing: ¿qué representación de producto recupera mejor (a) la próxima compra, (b) los complementos, (c) la cola larga? Seis estrategias tras una interfaz común: E0 texto (Voyage), E1 Prod2Vec (comportamental), E2 híbrido (texto⊕comportamiento por fusión de score), E3 two-tower (in-batch+logQ), E4 late-interaction chunk-MaxSim, E5 voyage-context-3.
- Comparación justa: universo común de 1999 ítems, 1098 casos, mismos usuarios/candidatos para todos; sólo cambia el vector. (Tres P0 de equidad corregidos por revisión adversarial: universo común, intersección de complementos, híbrido seguro en dimensión.)
- Results table (nDCG@10 / Recall@10 / complement-recall@10):

| Espacio | nDCG@10 | Recall@10 | complement-recall@10 |
|---|---|---|---|
| e2_hybrid | 0.124 | 0.252 | 0.000 |
| e1_prod2vec | 0.101 | 0.219 | 0.000 |
| e3_two_tower | 0.049 | 0.094 | 0.000 |
| e4_late | 0.039 | 0.087 | 0.002 |
| e5_context3 | 0.039 | 0.085 | 0.001 |
| e0_text | 0.038 | 0.086 | 0.001 |

- Hallazgos: el híbrido y Prod2Vec baten al texto ~2.7× en relevancia (nDCG@10 0.124/0.101 vs 0.038); **complement-recall ≈ 0 para los seis** → los embeddings, incluso los comportamentales, NO recuperan complementos específicos en el top-10 de ~2000 candidatos rankeados por gusto. Conclusión de programa: el cross-sell vive en el grafo de co-ocurrencia/NPMI, no en el coseno; los embeddings son para relevancia/descubrimiento. Recomendación de producción: **e2_hybrid** (mejor calidad; un vector denso barato, drop-in para pgvector).

- [ ] **Step 2: Verify number↔report traceability**

Run: `grep -E "e2_hybrid|e1_prod2vec|0.124|0.101|complement" docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md | head`
Expected: the cited figures (0.124, 0.101, the complement-recall column) appear in the source report.

- [ ] **Step 3: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 04-f1-embeddings.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/04-f1-embeddings.md
git commit -m "docs(thesis): F1 embeddings chapter (relevance yes, complementarity no)"
```

---

## Task 4: F2 multi-vector + gift chapter

**Files:** Create `docs/thesis/05-f2-multivector.md`

- [ ] **Step 1: Write the chapter** (`# Usuario multi-vector y modelo de regalo (F2)`, Spanish)

Content + EXACT figures from `docs/superpowers/reports/2026-05-29-thesis-f2-study.md`:
- Idea: "un usuario es una distribución, no un punto" (PinnerSage: clustering aglomerativo coseno + medoides, order-invariant) + el regalo necesita representación propia (detección demográfica por sesión + vector de destinatario efímero que no envenena el perfil).
- Segmented results table (nDCG@10, F1-single vs F2-multivec):

| Segmento | n | F1-single | F2-multivec |
|---|---|---|---|
| overall | 1098 | 0.101 | 0.152 |
| self\|1mode | 598 | 0.151 | 0.200 |
| self\|2-3modes | 151 | 0.109 | 0.163 |
| gift\|1mode | 287 | 0.013 | 0.063 |
| gift\|2-3modes | 62 | 0.006 | 0.072 |

- Recipient-fit@10 (sesiones gift, n=349): F2 0.476 vs F1-single 0.285.
- Gift detection vs ground truth (n=1098): precisión 0.430 / recall 0.387 / F1 0.407 (heurístico honesto — TP=135, FP=179, FN=214, TN=570).
- Hallazgos: F2 supera al vector único en TODO segmento; el single-vector **colapsa** en gift multi-modo (gift|2-3modes 0.006 → F2 0.072, 12×); el feed de regalo apunta al destinatario ~1.7× mejor. Ambas tesis confirmadas, con la detección de regalo declarada como heurística imperfecta.

- [ ] **Step 2: Verify traceability**

Run: `grep -E "0.152|gift\||0.476|Precision|0.430|recipient" docs/superpowers/reports/2026-05-29-thesis-f2-study.md | head`
Expected: cited figures present in the report.

- [ ] **Step 3: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 05-f2-multivector.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/05-f2-multivector.md
git commit -m "docs(thesis): F2 multi-vector + gift chapter (segmented lift, recipient-fit)"
```

---

## Task 5: F3 pool + reranker chapter

**Files:** Create `docs/thesis/06-f3-rerank.md`

- [ ] **Step 1: Write the chapter** (`# Generación de candidatos y reranking (F3)`, Spanish)

Content + EXACT figures from `docs/superpowers/reports/2026-06-07-thesis-f3-study.md`:
- Framing: el audit dijo que el reranker "no cambia el set". Hipótesis: estaba hambriento (pool chico, sin features que el retrieval no tenga). F3 = pool grande multi-fuente (retrieval F2 + co-ocurrencia NPMI + popularidad cohort + exploración, fusión RRF, 200) + 4 familias de reranker (LTR con features, LLM listwise DeepSeek, cross-encoder MaxSim, baselines MMR/RRF).
- Pool recall: **0.839 (921/1098) vs F2 top-30 0.410 (450/1098)** — el pool grande captura ~2× más compras futuras.
- Reranker table (nDCG@10 | Recall@10 | MRR | set-change@10):

| Reranker | nDCG@10 | Recall@10 | MRR | set-change@10 |
|---|---|---|---|---|
| baseline-rrf | 0.177 | 0.336 | 0.145 | 0.000 |
| ltr | 0.121 | 0.250 | 0.100 | 0.578 |
| mmr | 0.125 | 0.204 | 0.119 | 0.527 |
| cross-encoder | 0.055 | 0.120 | 0.053 | 0.821 |

- Hallazgos honestos: los rerankers **sí cambian el set** (set-change 0.53–0.82, refuta el audit) pero **ninguno le gana al RRF en nDCG@10**; el valor está en el POOL (2×), no en el reranker — sobre datos sintéticos con relevancia como único objetivo. NPMI recupera los complementos GT que el coseno de texto no (test de discriminación: npmiHits 7 > cosHits 0), confirmando la premisa de F1 (cross-sell ≠ embedding). Menciona el fix de generador (siembra de complementos, era el spec §4.4 no implementado) y el P0 de espacio del cross-encoder (consultaba E1-64d contra E4-1024d) que la revisión final cazó.

- [ ] **Step 2: Verify traceability**

Run: `grep -E "0.839|0.410|baseline-rrf|set-change|0.177" docs/superpowers/reports/2026-06-07-thesis-f3-study.md | head`
Expected: cited figures present.

- [ ] **Step 3: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 06-f3-rerank.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/06-f3-rerank.md
git commit -m "docs(thesis): F3 candidate pool + reranker chapter (pool 2x recall; RRF wins relevance)"
```

---

## Task 6: F4 multi-objective chapter

**Files:** Create `docs/thesis/07-f4-multiobjetivo.md`

- [ ] **Step 1: Write the chapter** (`# Ranking multi-objetivo (F4)`, Spanish)

Content + EXACT figures from `docs/superpowers/reports/2026-06-07-thesis-f4-study.md`:
- Idea (feedback Idea 3): el ranking final es una negociación entre objetivos, `s(p|u)=Σ λ_k·f_k`. Objetivos: relevancia, margen, conversión, novedad, fairness de vendedores, revenue. Outcome model: revenue esperado = P(compra)·precio·margen. Barrido de 24 configs de λ → frontera de Pareto → punto KPI.
- Baseline F3-RRF: nDCG@10 0.202, revenue@10 29702.21, sellerGini 0.103. Frontera: 23/24 configs.
- Operating points table (vs baseline):

| Punto | λ (rel,rev,div) | relevancia (nDCG@10) | Δ rel | revenue@10 | Δ rev |
|---|---|---|---|---|---|
| baseline (RRF) | — | 0.202 | — | 29702 | — |
| knee (min-max) cfg8 | rel=1, rev=0.5, div=0 | 0.081 | −59.8% | 48498 | +63.3% |
| revenue-max cfg18 | rel=1, rev=1, div=0.5 | 0.056 | −72.4% | 52524 | +76.8% |

- Hallazgos: el trade-off relevancia↔revenue es **real y dial-able** (ponderar revenue sube revenue, baja relevancia); el knee min-max (cfg8) es el compromiso defendible. **Honestidad obligatoria:** (a) el guardrail de relevancia≥0.7·base es **infactible (0/24)** → el punto KPI es un fallback al máximo de revenue; (b) **caveat de atribución** — el −72.4% conflaciona el costo real del trade-off con un desajuste de baseline (el feature de relevancia es una sola señal coseno-a-modos, mientras el baseline RRF fusiona 4 fuentes; el gap cfg0→baseline es una-señal-vs-fusión, el gap cfg0→esquina-revenue es el trade-off verdadero). Tres P0 que las revisiones cazaron y se arreglaron (margen peleaba contra revenue → objetivo revenue explícito; runner O(pool²) → early-exit; reporte afirmaba en falso el guardrail → declarado infactible).

- [ ] **Step 2: Verify traceability**

Run: `grep -E "0.202|29702|cfg8|cfg18|72.4|63.3|infeasible|FALLBACK|Attribution" docs/superpowers/reports/2026-06-07-thesis-f4-study.md | head`
Expected: cited figures + the attribution/infeasibility disclosures present.

- [ ] **Step 3: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 07-f4-multiobjetivo.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/07-f4-multiobjetivo.md
git commit -m "docs(thesis): F4 multi-objective chapter (Pareto frontier, honest trade-off caveats)"
```

---

## Task 7: Related work chapter

**Files:** Create `docs/thesis/02-related-work.md`

- [ ] **Step 1: Write the chapter** (`# Estado del arte`, Spanish, inline numbered references)

Cover the SOTA cited across the specs, grouped by contribution, with a 1–2 sentence positioning of how this work relates:
- **Representación de usuario:** PinnerSage (Pal et al., KDD 2020), MIND (Li et al., CIKM 2019), Pinterest implicit+explicit interests (KDD 2025).
- **Embeddings de recuperación:** two-tower con corrección logQ (Yi et al., RecSys 2019), Item2Vec/Prod2Vec (Barkan & Koenigstein 2016), ColBERT/ColBERTv2 + Jina-ColBERT-v2 (late interaction), voyage-context-3 (contextualized chunks).
- **Fusión y diversidad:** RRF (Cormack et al., SIGIR 2009), MMR (Carbonell & Goldstein, SIGIR 1998).
- **Cross-sell:** co-ocurrencia / NPMI (asociación, no proximidad lingüística).
- **Reranking LLM:** RankGPT/Zephyr, LLM4Rerank (WWW 2025), REARANK (2025).
- **Multi-objetivo:** Pareto-efficient ranking, MOO constreñido (Airbnb 2024), MOO-by-distillation (2024), bandits de diversidad.
- **Evaluación:** nDCG como métrica OPE (2023), OPE de candidate generators (RecSys 2025), AlignUSER (world models LLM, 2026).
Position: este trabajo combina multi-vector + co-ocurrencia + reranking + multi-objetivo en un pipeline único evaluado con ground-truth sintético, y reporta dónde cada técnica ayuda y dónde NO.

- [ ] **Step 2: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 02-related-work.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/02-related-work.md
git commit -m "docs(thesis): related work chapter (SOTA positioning)"
```

---

## Task 8: Introduction chapter (+ abstract already in metadata)

**Files:** Create `docs/thesis/01-introduccion.md`

- [ ] **Step 1: Write the chapter** (`# Introducción`, Spanish)

- **Contexto y problema:** e-commerce reseller para Cuba; revende Amazon/AliExpress sin stock físico; cada llamada al agregador mock = $ real en producción → minimizar fallbacks costosos es prioridad arquitectónica. El sistema partía de un ranking de relevancia única (λ_relevance=1).
- **La crítica de partida (los reportes audit/verdict):** una auditoría adversarial halló que el reranker LLM "no cambiaba el set" (devolvía los mismos 10 que MMR), que el perfil de un solo vector se rompía con regalos, y que el coseno no captura cross-sell. El veredicto: un "ecommerce normal bien hecho" daba ~80% del valor; la personalización profunda había que justificarla con evidencia.
- **Las tres contribuciones** (mapeadas a las 3 ideas del feedback): (1) usuario como distribución multi-modo + modelo de regalo; (2) la relación comercial (cross-sell) no es proximidad lingüística → co-ocurrencia, no coseno; (3) el ranking es una negociación multi-objetivo. Cada una probada empíricamente con su lift y sus límites.
- **Método en una frase:** un simulador con verdad de fondo + un arnés de evaluación riguroso permiten atribuir el lift de cada componente y reportar honestamente dónde no ayuda.
- **Estructura del documento** (lista de capítulos).

- [ ] **Step 2: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 01-introduccion.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/01-introduccion.md
git commit -m "docs(thesis): introduction chapter (problem, critique, contributions)"
```

---

## Task 9: Discussion + conclusion chapters

**Files:** Create `docs/thesis/08-discusion.md`, `docs/thesis/09-conclusion-trabajo-futuro.md`

- [ ] **Step 1: Write `08-discusion.md`** (`# Discusión`, Spanish)

- **Qué funcionó:** embeddings comportamentales/híbridos para relevancia (F1); multi-vector+regalo, sobre todo en el segmento regalo (F2); el pool multi-fuente que duplica el recall (F3); la frontera de Pareto que vuelve explícito el trade-off de negocio (F4).
- **Los hallazgos negativos como contribución (honestidad):** los embeddings NO recuperan complementos (F1 complement-recall≈0); ningún reranker le gana al RRF en relevancia pura (F3); el guardrail de relevancia de F4 es infactible y su −relevancia% tiene un componente de desajuste de baseline (no todo es trade-off). Estos resultados negativos son tan valiosos como los positivos: dicen DÓNDE poner el esfuerzo (co-ocurrencia para cross-sell; el pool, no el reranker; objetivos múltiples para revenue).
- **Límites:** dataset sintético (validez externa pendiente); el detector de regalo es heurístico (~0.43 precisión); el baseline single-signal de F4; el costo/latencia del LLM listwise; escala (n=2000).
- **Amenazas a la validez y mitigaciones:** ground-truth sintético podría favorecer ciertos métodos → reglas neutrales definidas antes, ablations, y el cross-check público pendiente; determinismo por seed para reproducibilidad.

- [ ] **Step 2: Write `09-conclusion-trabajo-futuro.md`** (`# Conclusión y trabajo futuro`, Spanish)

- **Conclusión:** el arco F1→F4 muestra que la personalización profunda se justifica cuando (a) la representación captura la multimodalidad real del usuario y el caso de regalo, (b) el cross-sell se modela donde vive (co-ocurrencia), y (c) el ranking negocia múltiples objetivos; medido todo con rigor y reportando los límites.
- **Trabajo futuro:** cross-check sobre dataset público de sesiones (validez externa; adaptador listo); item2vec/two-tower fine-tuned con clicks/compras reales; ColBERT real vía API multilingüe; bandit contextual para λ por usuario; features de relevancia multi-señal para que el baseline de F4 sea justo; y el piloto A/B (capítulo siguiente).

- [ ] **Step 3: Verify compile + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 08-discusion.md 09-conclusion-trabajo-futuro.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/08-discusion.md docs/thesis/09-conclusion-trabajo-futuro.md
git commit -m "docs(thesis): discussion + conclusion/future-work chapters"
```

---

## Task 10: Pilot plan chapter

**Files:** Create `docs/thesis/10-plan-piloto.md`

- [ ] **Step 1: Write the chapter** (`# Plan de piloto A/B (diseño, no ejecutado)`, Spanish)

A concrete, actionable design (explicitly NOT executed here):
- **Qué promover a `src/sectors/d-personalization/` detrás de flags:** (1) embeddings e2_hybrid como espacio de retrieval; (2) representación multi-vector del usuario + detección de regalo y vector de destinatario; (3) pool multi-fuente (RRF de retrieval+NPMI+popular) en vez del top-30 actual; (4) reranking en el **punto knee** de la frontera multi-objetivo (no la esquina de revenue) — empezar conservador.
- **Diseño experimental:** A (control = pipeline actual / RRF relevancia) vs B (tratamiento = lo anterior); asignación por usuario estable; duración y tamaño de muestra para detectar un efecto razonable en revenue-per-session con potencia adecuada; segmentación self vs gift en el análisis.
- **KPIs online:** CTR del feed, CVR, **revenue/GMV por sesión**, profundidad de sesión, tasa de uso del fallback del reranker.
- **Guardrails (rollback automático si se cruzan):** caída de relevancia/engagement más allá de un umbral; fairness de exposición de vendedores (Gini) por encima de un techo; latencia p99 del feed por encima del SLA; fallback-rate del LLM por encima de un umbral; cualquier incremento de costo de agregador por compra fuera de presupuesto (recordar: cada llamada = $).
- **Riesgos y mitigaciones:** el trade-off de F4 muestra que ponderar revenue cuesta relevancia → empezar en el knee y mover λ por bandit sólo si el engagement de largo plazo aguanta; el detector de regalo es imperfecto → degradar a self-mode ante baja confianza; sintético≠real → el piloto ES la validación externa que falta.
- **Rollout por fases:** shadow (sin servir) → 5% → 25% → 100%, con checkpoint de guardrails entre fases.

- [ ] **Step 2: Verify compiles + commit**

```bash
cd docs/thesis && pandoc 00-metadata.md 10-plan-piloto.md -o /tmp/_m.pdf --pdf-engine=xelatex && echo OK && rm -f /tmp/_m.pdf; cd -
git add docs/thesis/10-plan-piloto.md
git commit -m "docs(thesis): pilot A/B plan chapter (design only, not executed)"
```

---

## Task 11: Full compile + consistency verification + final commit

**Files:** Create `docs/thesis/tesis.pdf` (build output)

- [ ] **Step 1: Build the full PDF**

Run: `bash docs/thesis/build.sh`
Expected: `[thesis] wrote tesis.pdf`, exit 0.

- [ ] **Step 2: Verify the PDF is non-trivial and has all sections**

Run:
```bash
ls -la docs/thesis/tesis.pdf && pandoc 00-metadata.md 01-introduccion.md 02-related-work.md 03-metodologia.md 04-f1-embeddings.md 05-f2-multivector.md 06-f3-rerank.md 07-f4-multiobjetivo.md 08-discusion.md 09-conclusion-trabajo-futuro.md 10-plan-piloto.md -t plain 2>/dev/null | grep -cE "Metodología|Embeddings comerciales|multi-vector|reranking|multi-objetivo|Discusión|Conclusión|piloto"
```
(run from `docs/thesis/`)
Expected: `tesis.pdf` exists and is >50KB; the grep finds the major section titles (≥8).

- [ ] **Step 3: Consistency check — every headline figure traces to a committed report**

Run (from repo root):
```bash
for pair in "0.124:f1" "0.152:f2" "0.839:f3" "29702:f4" "0.430:f2"; do
  num="${pair%%:*}"; rep="${pair##*:}";
  grep -q "$num" docs/superpowers/reports/2026-0*-thesis-${rep}*.md && echo "$num OK ($rep)" || echo "$num MISSING in $rep report";
done
```
Expected: all `OK` — each chapter's headline number exists in its source report (no invented figures).

- [ ] **Step 4: Confirm scope — only docs/thesis touched**

Run: `git status --porcelain docs/thesis/ && git diff --stat HEAD~10 -- src/ | tail -1`
Expected: thesis files listed; no `src/` changes in the F5 commits.

- [ ] **Step 5: Commit the PDF + push**

```bash
git add docs/thesis/tesis.pdf
git commit -m "docs(thesis): compile full thesis PDF (F0-F4 synthesis + pilot plan)"
git push origin feat/thesis-personalization-program
```
Expected: pushed; local == remote.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** scaffold §4 build→Task 1; methodology §4→Task 2; F1–F4 chapters §4→Tasks 3–6; related-work→Task 7; intro+abstract→Task 8 (+ Task 1 metadata abstract); discussion+conclusion→Task 9; pilot→Task 10; compile+verify §6/§7→Task 11.
- **Honesty discipline (spec §3):** every results chapter task quotes figures verbatim from its committed report and includes a Step that greps the report to confirm the numbers exist; negative findings are explicitly required in Tasks 3 (complement-recall≈0), 5 (RRF wins), 6 (infeasible guardrail + attribution caveat), 9 (discussion).
- **No code/production/dataset changes:** all files under `docs/thesis/`; Task 11 Step 4 asserts it.
- **Number consistency across chapters:** F1–F4 all use the n=2000 / 1098-case (F4: 1107) studies; the F0 baseline (n=400) is only referenced in methodology with its scale caveat — never mixed into a results table (spec §8). The exact figures are pinned in the "Source-of-truth numbers" block and repeated per task.
- **Build correctness:** every chapter task compiles in isolation (catches LaTeX/math errors early); Task 11 compiles the whole document in the fixed chapter order from `build.sh`.
- **Writing order:** methodology→results→related-work→intro→discussion→pilot (intro/abstract written after results so they reflect actual findings; abstract lives in 00-metadata.md written in Task 1 but its claims match the pinned numbers).
