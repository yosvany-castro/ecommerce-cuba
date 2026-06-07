# Spec — F5: Documento de tesis + plan de piloto

**Fecha:** 2026-06-07
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** fase final. Sintetiza F0–F4 (todos COMPLETOS) en un documento de
tesis y diseña (sin ejecutar) el piloto de producción. No introduce código de
modelo ni toca el pipeline; es síntesis de resultados ya commiteados + un
toolchain de compilación a PDF.

**Insumos (todos commiteados — fuente única de verdad para las cifras):**
- `docs/superpowers/reports/2026-05-29-thesis-f0-baseline-eval.{md,json}`
- `docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.{md,json}`
- `docs/superpowers/reports/2026-05-29-thesis-f2-study.md`
- `docs/superpowers/reports/2026-06-07-thesis-f3-study.{md,json}`
- `docs/superpowers/reports/2026-06-07-thesis-f4-study.{md,json}`
- Specs F0–F4 (metodología y decisiones de diseño por fase).
- `feedback_comphrensive.md` (las 3 ideas: usuario multi-modo; comercial≠lingüístico;
  ranking multi-objetivo) y los reportes `audit-*`/`verdict-*` (la motivación).

---

## 1. Objetivo y entregable

Producir un **documento de tesis académico** (capítulos Markdown compilables a un
único PDF vía pandoc+xelatex) que un tribunal pueda leer y defender, MÁS un
capítulo final que **diseña el piloto A/B real sin ejecutarlo**. F5 no entrena ni
mide nada nuevo: sintetiza honestamente lo ya probado en F0–F4, incluidos los
hallazgos negativos.

**Toolchain verificado:** pandoc 3.1.3 + xelatex instalados en este entorno;
compilación md→PDF (con math LaTeX y acentos) probada OK. El spec puede prometer
un PDF construido.

**Idioma:** español (el dominio, el feedback y los reportes son en español; los
términos técnicos SOTA se mantienen en inglés donde es estándar).

**Portada:** SIN portada académica formal (universidad/tutor/carrera). El
documento abre con título técnico + autor (Yosvany Castro) + abstract, como
informe técnico/paper. La portada institucional la añade el autor por fuera si su
facultad la exige.

---

## 2. Alcance

### En alcance
- Capítulos Markdown en `docs/thesis/` (uno por sección, ver §4).
- Toolchain de build: `Makefile` + `build.sh` + metadata pandoc → `tesis.pdf`
  compilado y commiteado.
- Cada cifra de resultados **citada textualmente de los reportes commiteados** (sin
  re-correr, sin estimar).
- Capítulo de plan de piloto (diseño A/B, KPIs, guardrails, rollout por flags) —
  diseño, NO ejecución.

### Fuera de alcance
- Re-correr cualquier estudio o regenerar el dataset.
- Tocar `src/`, el pipeline de producción `d-personalization`, o el esquema DB.
- Ejecutar el piloto / promover a producción (eso sería un programa aparte).
- El cross-check público de F1 (sigue BLOCKED-EXTERNAL; se menciona como trabajo
  futuro, no se hace aquí).

### No-objetivos (YAGNI)
- No bibliografía con gestor externo (BibTeX opcional sólo si trivial; si no,
  referencias inline numeradas).
- No portada/firmas institucionales.

---

## 3. Disciplina de honestidad (núcleo de la tesis)
- **Toda cifra de resultados se cita de un reporte commiteado** y se referencia el
  archivo fuente. Cero números de memoria, cero estimaciones.
- **Se conservan los hallazgos negativos e incómodos** que las revisiones
  produjeron, porque son lo que hace la tesis defendible:
  - F1: complement-recall@10 ≈ 0.001 para LOS SEIS embedders → los embeddings dan
    relevancia, no complementariedad.
  - F3: NINGÚN reranker (LTR/cross-encoder/LLM) le gana al RRF-fusion en nDCG@10;
    el valor está en el pool, no en el reranker; set-change>0 refuta "no cambia el
    set" pero no prueba mejora.
  - F4: el guardrail de relevancia es infactible (0/24); el "−72.4% relevancia"
    conflaciona el trade-off real con un desajuste de baseline (feature de
    relevancia de una sola señal vs RRF de 4 fuentes) — declarado como caveat de
    atribución.
  - F2: gift-detector heurístico ~0.43 precisión / 0.39 recall.
- **Caveat sintético** explícito en metodología y discusión: dataset generado;
  validez externa pendiente (cross-check público).
- **Verificación de consistencia número↔reporte** como paso de cierre.

---

## 4. Estructura (un archivo por capítulo en `docs/thesis/`)

| Archivo | Contenido |
|---|---|
| `00-metadata.md` | Bloque YAML de pandoc: título técnico, autor (Yosvany Castro), fecha (2026), abstract (~200 palabras), `lang: es`, opciones xelatex/TOC. SIN portada institucional. |
| `01-introduccion.md` | Problema (e-commerce reseller Cuba, sin stock físico, cada llamada al aggregator = $ real). La crítica de partida (audit/verdict: el reranker "no cambiaba el set"; el coseno no captura cross-sell). Las 3 contribuciones (usuario multi-modo+regalo; comercial≠lingüístico; ranking multi-objetivo). Estructura del documento. |
| `02-related-work.md` | SOTA ya citado en los specs: PinnerSage (multi-vector), Yi et al. two-tower + logQ, ColBERT/ColBERTv2 (late interaction), Prod2Vec/Item2Vec, RRF (Cormack), NPMI (cross-sell), multi-objective/Pareto recsys, OPE/nDCG, MMR. Referencias inline numeradas. |
| `03-metodologia.md` | El simulador de marketplace con ground-truth conocido (catálogo sintético + grafo de complementos GT + comportamiento con gusto latente + regalo + señales de negocio); el arnés de eval (split temporal, métricas, baselines, ablations); por qué ground-truth permite atribución rigurosa; el caveat sintético + el plan de validez externa. Cita specs F0/F2/F3/F4. |
| `04-f1-embeddings.md` | Estudio comparativo de 6 embedders (E0 texto…E5 voyage-context-3). Tabla real del reporte F1 (1098 casos, universo 1999). Hallazgo: e2_hybrid/e1 ganan en relevancia ~2.7× sobre texto; complement-recall≈0 en todos → cross-sell no vive en embeddings. Recomendación de producción e2_hybrid. |
| `05-f2-multivector.md` | Usuario multi-vector (PinnerSage) + modelo de regalo (detección demográfica por sesión + vector de destinatario efímero). Tabla segmentada self/gift × multimodalidad del reporte F2. F2 > single-vector en todo; colapso del single-vector en gift multi-modo; recipient-fit@10 0.476 vs 0.285. Detección honesta ~0.43/0.39. |
| `06-f3-rerank.md` | Pool multi-fuente (retrieval+NPMI+popular+exploración) + 4 familias de reranker. Tabla F3: pool-recall 0.839 vs F2 top-30 0.410; set-change@10 por reranker; nDCG@10 — RRF mejor. Hallazgo: el reranker cambia el set (refuta el audit) pero no le gana al RRF en relevancia; el valor es el pool. Incluye el fix de generador (siembra de complementos) y el P0 de espacio del cross-encoder. |
| `07-f4-multiobjetivo.md` | Ranking multi-objetivo s(p|u)=Σλ_k f_k; frontera de Pareto; trade-off revenue↔relevancia (revenue-max +76.8%/−72.4%; knee min-max +63.3%/−59.8%); guardrail infactible (fallback honesto); el caveat de atribución (feature single-signal vs RRF de 4 fuentes). Tabla del reporte F4. |
| `08-discusion.md` | Qué funcionó y qué no, integrado: las 3 ideas confirmadas/matizadas; los hallazgos negativos como contribución; límites (sintético, costo, gift heurístico, baseline mismatch de F4); amenazas a la validez y mitigaciones; qué generaliza y qué no. |
| `09-conclusion-trabajo-futuro.md` | Cierre del arco F1→F4; trabajo futuro (cross-check público F1, item2vec/two-tower fine-tuned con datos reales, bandit contextual para λ, features de relevancia multi-señal para F4, ColBERT real vía API). |
| `10-plan-piloto.md` | Diseño del piloto A/B real (NO ejecutado): qué promover a `d-personalization` (e2_hybrid embeddings, multi-vector+regalo, knee multi-objetivo), detrás de flags; KPIs online (CTR, CVR, revenue-per-session, profundidad de sesión); guardrails (relevancia/fairness mínimas, fallback rate del LLM, latencia p99); diseño experimental (baseline vs tratamiento, tamaño de muestra, duración); riesgos y rollback; mapa de rollout por fases. |
| `README.md` | Índice de capítulos + instrucciones de compilación + lista de cualquier `[COMPLETAR]` restante (sólo si quedara alguno). |

### Build
- `docs/thesis/00-metadata.md` lleva el bloque YAML pandoc (title/author/date/abstract,
  `toc: true`, `numbersections: true`, `pdf-engine: xelatex`, `lang: es`,
  márgenes/fuente).
- `docs/thesis/build.sh` y `Makefile`: `pandoc 00-metadata.md 01-*.md … 10-*.md
  -o tesis.pdf --pdf-engine=xelatex --toc --number-sections`.
- El PDF (`docs/thesis/tesis.pdf`) se compila y se commitea en la tarea final.

---

## 5. Flujo
1. Escribir cada capítulo citando su reporte fuente (números verificados).
2. Build script + metadata.
3. Compilar `tesis.pdf`; verificar que compila sin error.
4. Verificación de consistencia: cada cifra clave del documento aparece en un
   reporte commiteado (check cruzado, documentado).

---

## 6. Estrategia de verificación (no hay tests unitarios de prosa)
- **Consistencia número↔reporte:** para las cifras de resultados de cada capítulo,
  confirmar que existen textualmente en el reporte citado. Se hace en la revisión
  de cada capítulo y en una pasada final.
- **Compila:** `bash docs/thesis/build.sh` produce `tesis.pdf` sin error (exit 0,
  PDF no vacío).
- **Sin placeholders:** ningún `TODO`/`TBD`/`[COMPLETAR]` salvo, si acaso, datos
  administrativos que el autor deba poner (idealmente ninguno, por §1 sin portada).
- **No toca código:** `git diff` sólo bajo `docs/thesis/`.

---

## 7. Criterios de aceptación
1. 11 capítulos + README + build escritos en `docs/thesis/`.
2. `tesis.pdf` compila y contiene todas las secciones con TOC y numeración.
3. Toda cifra de resultados es trazable a un reporte commiteado (sin invenciones,
   sin estimaciones); los hallazgos negativos están presentes.
4. El capítulo de piloto es un diseño accionable (qué/cómo/guardrails/riesgos), no
   una ejecución.
5. No toca `src/`, producción, ni el dataset.

---

## 8. Riesgos y mitigaciones
- **Inventar cifras:** prohibido; cada número se cita del reporte. La revisión por
  capítulo lo verifica.
- **Inconsistencia entre dataset n=400 (F0 baseline) y n=2000 (F1–F4):** el
  capítulo de metodología lo declara — el baseline-eval de F0 fue a n=400; los
  estudios por fase corren sobre el dataset regenerado n=2000 (con complementos).
  No se mezclan cifras de escalas distintas en una misma tabla.
- **PDF no compila (math/acentos/orden de archivos):** smoke-test ya pasó;
  el build se valida en la tarea final; si un capítulo rompe LaTeX, se corrige el
  Markdown problemático.
- **Sobre-afirmar:** la discusión mantiene los caveats (sintético, baseline
  mismatch de F4, gift heurístico) — la honestidad es el activo de la tesis.

---

## 9. Secuencia de implementación (para el plan)
1. `docs/thesis/` scaffold: `00-metadata.md` (YAML pandoc) + `README.md` + `build.sh` + `Makefile`.
2. `03-metodologia.md` (generador + arnés; cita specs).
3. `04-f1-embeddings.md` (números del reporte F1).
4. `05-f2-multivector.md` (reporte F2).
5. `06-f3-rerank.md` (reporte F3).
6. `07-f4-multiobjetivo.md` (reporte F4).
7. `02-related-work.md` (SOTA).
8. `01-introduccion.md` + abstract en `00-metadata.md` (se escriben tras los
   resultados, para que reflejen lo realmente hallado).
9. `08-discusion.md` + `09-conclusion-trabajo-futuro.md`.
10. `10-plan-piloto.md`.
11. Compilar `tesis.pdf` + verificación de consistencia número↔reporte + commit final.
