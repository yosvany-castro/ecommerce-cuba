# F6 — Síntesis de la campaña de validación & stress-testing

**Fecha:** 2026-06-08 · **Branch:** `feat/thesis-personalization-program` · **Schema:** `thesis`
**Spec:** `docs/superpowers/specs/2026-06-08-thesis-f6-validation-stress-test-design.md`
**Resumen no técnico:** `docs/thesis/RESUMEN-EJECUTIVO.md`

Toda cifra trazable a un reporte committeado (`docs/superpowers/reports/2026-06-08-thesis-f6-*`).
Comparaciones sobre **idénticos casos, candidatos y split**. Datos sintéticos con
verdad de fondo; sin mocks (Postgres + Voyage reales); rankers deterministas por seed.

---

## 0. La pregunta que F6 cierra

Los estudios F0–F4 nunca fueron comparables entre sí (universos de candidatos
distintos), y **el sistema completo nunca se midió contra el baseline tonto sobre los
mismos casos**. F6 construyó un **arnés head-to-head unificado** (`src/thesis/eval/unified-cases.ts`
+ `assembled.ts` + `scripts/thesis/f6-headtohead.ts`) y respondió, de forma justa y
honesta, si **toda la complejidad le gana a un e-commerce normal** (`popular-cohort`).

Dos marcos: **full** (feed de producción: catálogo\train) y **pool** (dado el pool de
200; aísla el valor del reranking).

---

## 1. W1 — Head-to-head (n=2000, seed 42)

**Full frame** (1107 casos). El pipeline es una FAMILIA de configs:
- **Relevancia (`f3-rrf`): nDCG@10 0.200 vs popular-cohort 0.177 → +13.0%**, y revenue@10 +162%.
- **Dial de revenue (`f4-revenue`): +363% revenue a costa de −67% nDCG.**
- Ningún reranker APRENDIDO bate a RRF (consistente con F3): **el mérito es el POOL multi-fuente**, no el reranker.
- Segmento regalo: popular-cohort sigue fuerte (cohorte=destinatario); el pipeline supera a los rankers de puro-gusto en recipient-fit (0.52 vs 0.27) pero no al heurístico de cohorte.

**Pool frame:** dentro del pool, popular-cohort gana en relevancia (−36% para f3-rrf) — confirma que el valor del pipeline está en el **retrieval sobre el catálogo completo**, no en reordenar un pool ya bueno.

---

## 2. W2 — Escala (la afirmación central de la tesis) ✅ CONFIRMADA

Feed de producción (full), `f3-rrf` vs `popular-cohort` nDCG@10, sobre un rango 5× de catálogo:

| n (catálogo) | popular-cohort | f3-rrf | **ventaja pipeline** | revenue (f3-rrf) | dial revenue (f4-revenue) |
|---|---|---|---|---|---|
| 2.000 | 0.177 | 0.200 | **+13.0 %** | +162 % | +? |
| 5.000 | 0.092 | 0.149 | **+62.6 %** | +185 % | +363 % |
| 10.000 | 0.065 | 0.111 | **+71.4 %** | +226 % | +537 % |

**`popular-cohort` decae monótonamente** (0.177→0.092→0.065): la señal cohorte=subcategoría
se diluye al crecer el catálogo. El pipeline se sostiene mucho mejor → **la ventaja
relativa crece monótonamente (+13%→+62.6%→+71.4%)**. Es el régimen del revendedor real
(catálogo Amazon/AliExpress enorme). *(n=10000 con submuestra de 2000 casos por memoria
—O(casos×catálogo)—; la señal de escala viene del universo de candidatos, no del conteo
de casos.)*

---

## 3. W3 — Robustez por seed (n=5000) ✅ ROBUSTA

| seed | popular-cohort | f3-rrf | ventaja | NPMI drop (W9) |
|---|---|---|---|---|
| 42 | 0.092 | 0.149 | +62.6 % | −0.341 |
| 7 | 0.096 | 0.149 | +55.3 % | −0.336 |
| 123 | 0.088 | 0.154 | +74.7 % | −0.331 |

Las tres semillas dan la misma dirección y magnitud (ventaja **+55 % a +75 %**, caída de
recall sin NPMI **−0.33 a −0.34**) → las conclusiones **no son artefacto del seed 42**.

---

## 4. Stress-tests §8 — veredictos

| W | Afirmación / pregunta | Veredicto |
|---|---|---|
| **W4** | Caveat de atribución de F4 (single-signal vs fusion) | **CERRADO.** La relevancia multi-señal cierra **84–102%** del confound (84.9% n2k, 101.9% n5k, 83.7% n10k). Trade-off REAL ≈ **+46.8% revenue por −36.9% nDCG** (vs el +62%/−52% que F4 reportó por el artefacto). |
| **W5** | ¿Reranker entrenado en revenue bate a RRF? | **Depende de escala.** FALLA el guardrail a n2k/n5k; **PASA a n10k** (bate a RRF en revenue@10 con nDCG ≥ 0.7·RRF). Resultado nuevo emergente. |
| **W6** | ¿p99 < 1.5s? | **PASA con margen enorme** (~26 ms sin LLM). Retrieval es la etapa O(N·dim) que crece con el catálogo. |
| **W7** | ¿Adapta a perfiles extremos? | El detector dispara 2/3 regalos; extrae más revenue en todos los perfiles; degrada a self-mode con gracia cuando falla. |
| **W8** | ¿Mejorable el detector de regalo sin leakage? | F1≈0.44; la heurística age+gender conjunta **NO** supera a la de solo-género (negativo honesto). |
| **W9** | ¿NPMI aporta señal ortogonal? | **CONFIRMADO y CRECE con escala.** Quitar NPMI cuesta −0.27→−0.34→−0.38 pool-recall; ~28–37% de las compras alcanzables vía NPMI pero NO por coseno. |

---

## 5. Hallazgo metodológico (bug cazado por el stress-test)

W8 destapó que el head-to-head alimentaba al detector de regalo con el **historial de
train** (cuyo demográfico modal = el del comprador) → cross-cohort imposible → **el
regalo nunca disparaba** (F2 estaba muerto en el head-to-head). Se corrigió para correr
el detector sobre la **sesión real** del producto de test (excluyéndolo = sin leakage),
y para medir recipient-fit vs el destinatario **GT** (no el predicho). Tras el fix, el
pipeline en regalo subió recipient-fit 0.29→0.52. *El stress-testing cumplió su función:
encontró y corrigió un defecto real antes de declarar conclusiones.*

---

## 6. Veredicto por afirmación de la tesis

- **Embeddings dan relevancia, no complementariedad** → **SOSTIENE** (W9: la
  complementariedad vive en NPMI, no en el coseno; ortogonalidad confirmada y creciente).
- **El pool multi-fuente es la contribución de valor** → **SOSTIENE y se REFUERZA a
  escala** (W1/W2: el pool, no el reranker, es lo que bate al MVP, y cada vez por más).
- **Ningún reranker bate a RRF en relevancia pura** → **SOSTIENE** (W1, todas las escalas).
- **El ranking multi-objetivo es una palanca real relevancia↔revenue** → **SOSTIENE, y
  el caveat de atribución queda CERRADO** (W4): el trade-off verdadero es más suave que
  lo reportado en F4.
- **Escala (limitación #1)** → **RESUELTA a favor**: la ventaja del pipeline crece con
  el catálogo (W2), robusta entre seeds (W3).
- **Detector de regalo débil** → **SOSTIENE como limitación** (W8): ~0.44 F1, sin mejora
  fácil sin leakage.

---

## 7. Limitaciones honestas

- **Datos sintéticos**: validez externa real pendiente del piloto A/B (F5, diseñado, no
  ejecutado) o de un dataset público (§8-H, BLOCKED-EXTERNAL).
- **n=10000 con submuestra de casos** (memoria); la señal de escala (universo de
  candidatos) es robusta, pero las cifras n=10000 no son sobre el 100% de los casos.
- **E3 (two-tower) y E4/E5 (chunk/context3) omitidos a escala**: no entran en el
  head-to-head; E4/E5 solo alimentan el cross-encoder (el peor reranker) y columnas
  extra del estudio F1.
- **El reranker-revenue (W5)** gana en revenue *del modelo de outcome sintético*, no de
  usuarios reales (mismo caveat que F4).

---

## 8. Artefactos

- Código: `src/thesis/eval/{unified-cases,assembled,adversarial}.ts`,
  `src/thesis/objectives/relevance-multi.ts`, `src/thesis/rerank/revenue-ltr.ts`,
  runners `scripts/thesis/f6-*.ts`, tests `tests/thesis/f6-*.test.ts`.
- Reportes: `docs/superpowers/reports/2026-06-08-thesis-f6-{headtohead,attribution,revenue-rerank,latency,adversarial,gift-robustness,pool-ablation}-*.{md,json}`.
- Ejecutivo: `docs/thesis/RESUMEN-EJECUTIVO.md`. Capítulo de tesis: `docs/thesis/11-f6-validacion.md`.
