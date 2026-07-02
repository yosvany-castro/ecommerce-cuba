# Handoff — Programa de tesis F0–F5 (personalización de ranking)

> **Para una sesión fresca.** Este documento es autocontenido: te da el contexto completo,
> el mapa del repo, cómo verificar todo, los peligros, y un *playbook* para "llevarlo al
> límite" (stress-testing). No asume contexto previo de la conversación.
>
> **Estado al entregar:** programa **F0–F5 COMPLETO y pusheado**. Rama
> `feat/thesis-personalization-program` @ `82fd882`, 95 commits sobre `main`, **NO mergeada**
> (restricción del dueño: no merge a `main`). Árbol limpio salvo `feedback_comphrensive.md`
> sin trackear (preexistente, no relacionado).

---

## 0. TL;DR

Se elevó el pipeline de ranking/personalización de un e-commerce reseller (MVP) a un
**producto final + estudio de tesis**. Cuatro contribuciones, cada una probada
empíricamente sobre un **simulador de marketplace con verdad de fondo conocida** y un
**arnés de evaluación riguroso**, reportando con honestidad dónde cada técnica ayuda y
dónde NO:

1. **Embeddings comerciales** (F1) — capturan relevancia, **no** complementariedad.
2. **Usuario multi-vector + modelo de regalo** (F2) — supera al vector único, sobre todo en regalos.
3. **Pool de candidatos multi-fuente + reranking** (F3) — el pool duplica el recall; ningún reranker bate a RRF en relevancia pura.
4. **Ranking multi-objetivo** (F4) — frontera de Pareto que negocia relevancia↔revenue.

La tesis está escrita (`docs/thesis/tesis.pdf`, español) y un piloto A/B queda **diseñado, no ejecutado**.

---

## 1. Contexto de negocio (por qué existe esto)

- E-commerce **reseller para Cuba**: revende catálogo de Amazon/AliExpress **sin stock físico**.
- **Cada llamada al agregador (mock) = costo real** en producción → minimizar fallbacks costosos es prioridad arquitectónica. Cualquier stress-test que dispare llamadas a Voyage/DeepSeek **gasta dinero real**.
- El sistema partía de un ranking de **relevancia única** (`λ_relevance = 1`). Una auditoría adversarial (`docs/handoff-audit-reranker-pipeline.md`, `docs/superpowers/reports/2026-05-15-fase-3c-audit-razones.md`) halló: (1) el reranker LLM "no cambiaba el set"; (2) el perfil de un vector se rompía con regalos; (3) el coseno no captura cross-sell. Esa crítica motivó el programa.

---

## 2. Arquitectura del programa (qué construyó cada fase)

Todo el código de tesis vive en `src/thesis/` y `scripts/thesis/`; los datos en el **schema Postgres `thesis`** (aislado del producto).

| Fase | Qué construyó | Ubicación clave |
|---|---|---|
| **F0** datos+eval | Simulador con ground-truth (catálogo, taxonomía, grafo de complementos, generador de comportamiento) + arnés de evaluación (métricas, split temporal, baselines, OPE) | `src/thesis/data/`, `src/thesis/eval/`, migr. `0021` |
| **F1** embeddings | 6 espacios tras interfaz común: E0 texto, E1 Prod2Vec, E2 híbrido, E3 two-tower, E4 chunk-MaxSim, E5 voyage-context-3 | `src/thesis/embedders/`, migr. `0022` |
| **F2** multi-vector | Usuario como distribución (PinnerSage: clustering **aglomerativo enlace-promedio coseno** + medoides, order-invariant) + detección de regalo + vector de destinatario efímero | `src/thesis/multivector/` |
| **F3** pool+rerank | Pool multi-fuente (retrieval + NPMI co-ocurrencia + popularidad cohort + exploración, fusión RRF, 200) + 4 rerankers (LTR, LLM listwise DeepSeek, cross-encoder MaxSim, MMR/RRF) | `src/thesis/rerank/` |
| **F4** multi-objetivo | Campos de negocio (margen, stock, vendedor) + objetivos (relevancia/margen/conversión/novedad/fairness/revenue) + scorer `Σλ_k·f_k` + frontera de Pareto | `src/thesis/objectives/` |
| **F5** tesis+piloto | 11 capítulos Markdown → `tesis.pdf` (pandoc+xelatex) + plan de piloto A/B (diseño) | `docs/thesis/` |

---

## 3. Resultados verificados (toda cifra traza a un reporte committeado)

Reportes fuente en `docs/superpowers/reports/`. **Datos: n=2000 productos, ~1098 casos de
evaluación, seed 42** (excepto F0 que es n=400 — NO mezclar escalas).

**F0 baseline** (`...f0-baseline-eval.md`, 282 casos, n=400): nDCG@10 — random 0.017,
popular-global 0.017, cosine-single 0.150, **popular-cohort 0.486** (cohort=subcategoría es
el señal más fuerte a esta escala; *se espera que esto cambie a mayor escala*).

**F1 embeddings** (`...f1-embedding-study.md`): nDCG@10 — **e2_hybrid 0.124** > e1_prod2vec
0.101 ≫ e3 0.049 ≈ e4/e5/e0 ~0.039. Recall@10 e2 0.252. **complement-recall@10 ≈ 0 para los
SEIS** → hallazgo negativo: ningún embedding recupera complementos. Pick de producción:
**e2_hybrid** (ratio ≈3.3× sobre texto en nDCG).

**F2 multi-vector** (`...f2-study.md`): overall nDCG@10 **F2 0.152 vs F1-single 0.101**;
gift|2-3modes **F2 0.072 vs 0.006** (~12×, el vector único colapsa); recipient-fit@10 **0.476
vs 0.285**; detección de regalo precisión **0.430** / recall 0.387 (heurística honesta).

**F3 pool+rerank** (`...f3-study.md`): **pool recall 0.839 (921/1098) vs F2 top-30 0.410**;
nDCG@10 — **baseline-rrf 0.177 (mejor)** > mmr 0.125 ≈ ltr 0.121 > cross-encoder 0.055;
set-change@10 0.527–0.821 (refuta "el reranker no cambia el set") pero **ninguno bate a
RRF**. NPMI recupera complementos que el coseno no (test `f3-cooccurrence.test.ts`:
npmiHits 7 > cosHits 0). **El valor está en el POOL, no en el reranker.**

**F4 multi-objetivo** (`...f4-study.md`): baseline F3-RRF nDCG@10 **0.202**, revenue@10
**29702**, sellerGini 0.103. Knee min-max cfg8 (λ rel=1,rev=0.5): −59.8% relevancia / +63.3%
revenue. Revenue-max cfg18: −72.4% / +76.8%. **Honestidad obligatoria:** (a) el guardrail
relevancia≥0.7·base es **infactible (0/24 configs)** → el punto KPI es fallback;
(b) **caveat de atribución**: el −72.4% conflaciona el trade-off real con un desajuste de
baseline (el feature de relevancia es 1 señal coseno-a-modos vs el RRF de 4 fuentes).

---

## 4. Mapa del repo

- **Código:** `src/thesis/{data,eval,embedders,multivector,rerank,objectives}/`, `taxonomy.ts`, `types.ts`.
- **CLIs:** `scripts/thesis/**` (ver tabla de scripts en §6).
- **Migraciones:** `supabase/migrations/0021_thesis_schema.sql` (schema + GT tables), `0022_thesis_embeddings.sql` (item_vectors, item_chunk_vectors). Campos de negocio de F4 viven en `products.metadata` jsonb (sin migración).
- **Tests:** `tests/thesis/*.test.ts` (38 archivos). ⚠️ ver §7 hazard.
- **Reportes (fuente de verdad):** `docs/superpowers/reports/2026-0*-thesis-f{0,1,2,3,4}-*.{md,json}`.
- **Specs/planes:** `docs/superpowers/specs/` y `docs/superpowers/plans/` (`2026-*-thesis-f*`).
- **Tesis:** `docs/thesis/` (11 capítulos `.md` + `00-metadata.md` + `build.sh` + `Makefile` + `README.md` + `tesis.pdf`).

---

## 5. Prerrequisitos de entorno

`.env` necesita (ver `.env.example`):
- `SUPABASE_DB_URL` — Postgres real con **pgvector** (pooler `postgres.qyvpkzjwofouquyvaoag`, **free-tier que auto-pausa** — si la primera query falla, reintenta; suele ser lag de pooler tras restore, no pausa real).
- `VOYAGE_API_KEY` — embeddings (voyage-4, dim 1024) y voyage-context-3. **Llamadas = $.**
- `DEEPSEEK_API_KEY` — reranker LLM listwise (se usa DeepSeek porque los créditos Anthropic estaban agotados; `ANTHROPIC_API_KEY` también existe). **Llamadas = $.**

**Regla dura del repo:** NO se permite mockear DB/LLM/embeddings (lo enforza un AST checker:
`pnpm test:quality`). Tampoco aserciones débiles (`toBeDefined`/`not.toBeNull` prohibidas).
Todo test corre contra Postgres real + API Voyage real.

---

## 6. Cómo verificar / reproducir todo

### Verificación segura (no toca el dataset de estudio)
```bash
pnpm health-check        # conectividad DB/servicios
pnpm test:unit           # 176 unit tests (no tocan schema thesis)
pnpm test:quality        # 0 violaciones esperadas (no-mock + aserciones fuertes)
pnpm typecheck && pnpm lint
```

### Compilar la tesis
```bash
bash docs/thesis/build.sh    # → docs/thesis/tesis.pdf  (requiere pandoc + xelatex)
# instalar si falta: sudo apt-get install -y pandoc texlive-xetex texlive-fonts-recommended
```

### Scripts de tesis (todos `pnpm thesis:<x>`)
| Script | Hace |
|---|---|
| `thesis:catalog` | genera catálogo sintético (`--n`, `--seed`) |
| `thesis:relations` | grafo de complementos/sustitutos GT |
| `thesis:behavior` | sesiones + eventos (`--users`, `--days`, `--seed`) |
| `thesis:train-prod2vec` | entrena E1 (`--dim`, `--epochs`, `--seed`) |
| `thesis:train-two-tower` | entrena E3 |
| `thesis:build-chunks` | E4 chunk embeddings |
| `thesis:build-context3` | E5 voyage-context-3 |
| `thesis:backfill-cooccurrence` | reconstruye co_occurrence + NPMI desde events |
| `thesis:embedding-study` | estudio F1 → reporte |
| `thesis:f2-study` / `f3-study` / `f4-study` | estudios F2/F3/F4 → reportes |
| `thesis:eval` | arnés genérico (baselines/ablations) |
| `thesis:public` | adaptador para dataset público (F1 cross-check, **pendiente de dataset**) |

### Regenerar el dataset completo (orden EXACTO, seed 42)
```bash
pnpm thesis:catalog --n 2000 --seed 42 \
 && pnpm thesis:relations \
 && pnpm thesis:behavior --users 800 --days 90 --seed 42 \
 && pnpm thesis:train-prod2vec --dim 64 --epochs 30 --seed 42 \
 && pnpm thesis:train-two-tower \
 && pnpm thesis:build-chunks \
 && pnpm thesis:build-context3 \
 && pnpm thesis:backfill-cooccurrence
# luego cualquier estudio: pnpm thesis:f3-study  (etc.)
```
> ⚠️ `build-chunks`/`build-context3`/`train-*` y los estudios LLM **gastan API ($)**.

---

## 7. ⚠️ Peligros y gotchas (LEER antes de tocar nada)

1. **`tests/thesis/harness-discrimination.test.ts` DESTRUYE el dataset.** Hace `TRUNCATE thesis.products CASCADE`, y el FK `ON DELETE CASCADE` borra `item_vectors` (vectores E1 + catálogo). **Correr `vitest run tests/thesis` completo BORRA los datos de los que dependen los reportes y el PDF.** Si lo corres, **regenera el dataset después** (§6). Para verificar sin destruir, corre tests individuales que no truncan, o solo `pnpm test:unit`.
2. **Subagents en background mueren callados.** Los runners pesados (`f3-study`, `f4-study`, builds de embeddings) repetidamente devolvieron status vacío al morir a mitad. Si orquestas con subagents: **verifica el commit/reporte en disco** y corre/commitea el job tú mismo si hace falta.
3. **DB free-tier auto-pausa + lag de pooler.** Un fallo de conexión inicial suele ser lag tras restore, no pausa. Reintenta antes de diagnosticar "DB caída".
4. **Costo por llamada.** Voyage + DeepSeek cobran por uso. Stress-tests a gran escala pueden ser caros — presupuesta.
5. **`cosineSim` ahora LANZA en mismatch de dimensión** (fix de F3: el cross-encoder consultaba E1-64d contra E4-1024d). Si añades un espacio, respeta dims.
6. **No mergear a `main`** sin autorización explícita del dueño.

---

## 8. 🔥 Playbook para "llevarlo al límite" (stress-testing)

Ordenado por valor/impacto. Cada uno valida o rompe una afirmación de la tesis.

### A. Escala (el límite #1 que la tesis declara)
La tesis corre a **n=2000**; declara la escala como limitación. **Regenera a n=5000 y n=10000**
(más usuarios/días) y re-corre **todos** los estudios. Preguntas a responder:
- ¿Sigue `popular-cohort` dominando en F0, o se desploma al crecer el pool por subcategoría (la memoria lo predice)?
- ¿`e2_hybrid` mantiene su ventaja ~3.3× en F1?
- ¿El pool de F3 sigue duplicando el recall, o el efecto era de tamaño-de-pool relativo?
- ¿La frontera de Pareto de F4 cambia de forma?
> Esto es lo más valioso: la validez de todo el arco depende de que las conclusiones sean estables a escala.

### B. Estabilidad por seed (¿conclusión o suerte?)
Re-corre con **seeds distintos** (no solo 42). Si las conclusiones (orden de embedders, lift de F2, RRF gana en F3) se mantienen, son robustas; si no, son artefactos del seed.

### C. Cerrar el caveat de atribución de F4 (el más honesto/importante)
F4 declaró que el −72.4% conflacia el trade-off real con un desajuste de baseline (feature de
relevancia = 1 señal coseno-a-modos vs RRF de 4 fuentes). **Implementa un feature de
relevancia multi-señal** (mezcla retrieval+NPMI+popularidad como el baseline) y re-mide el
**trade-off verdadero**. Cierra la principal deuda metodológica de la tesis.

### D. Reranker entrenado sobre el outcome de negocio
F3 halló que ningún reranker bate a RRF **en relevancia pura** (único objetivo). F4 mostró que
multi-objetivo cambia eso. **Entrena un reranker (LTR/LLM) directamente sobre revenue@k** y
prueba si bate a RRF en revenue manteniendo relevancia ≥ umbral. Sería un resultado nuevo fuerte.

### E. Latencia y p99 (gate de producción)
La spec de fase-3c tenía compuerta **p99 < 1.5s**. Mide la latencia end-to-end del feed
(retrieval → pool → reranker LLM → scorer multi-objetivo) a escala. ¿Aguanta el SLA? ¿Cuánto
cuesta el LLM listwise por request y cuál es su fallback-rate bajo carga?

### F. Perfiles adversariales (prueba manual, como hizo el dueño)
Construye perfiles extremos y observa la adaptación del pipeline:
- regalo puro (comprador ≠ destinatario, demografías opuestas),
- multi-modal 5+ intereses ortogonales,
- precio-extremo (solo cola alta / solo barato),
- sesión ambigua (¿el detector de regalo ~0.43 precisión falla con gracia? ¿degrada a self-mode?).
Mide recipient-fit, set-change y revenue en cada uno.

### G. Robustez del detector de regalo (precisión ~0.43 es flojo)
Es la limitación más concreta. Genera sesiones de regalo ambiguas, mide modos de fallo
(FP=179, FN=214 sobre 349 en el reporte F2) e intenta mejorar la heurística sin meter leakage de GT.

### H. Validez externa — F1 public cross-check (🔒 BLOCKED-EXTERNAL)
El único ítem de estudio incompleto. Consigue un **dataset público real de sesiones**, corre
`pnpm thesis:public` (adaptador listo) y valida si las conclusiones sintéticas se sostienen en
datos reales. Es la validación que el piloto A/B también daría.

### I. Ablations de fuentes del pool (F3)
Quita una fuente a la vez (sin NPMI / sin popularidad / sin exploración) y mide el impacto en
pool-recall y nDCG. Confirma qué fuente aporta qué (la tesis afirma que NPMI aporta señal ortogonal).

---

## 9. Limitaciones conocidas / preguntas abiertas (honestidad)

- **Datos sintéticos** → validez externa pendiente (ítem H). El ground-truth podría favorecer ciertos métodos pese a reglas neutrales y ablations.
- **Detector de regalo heurístico** (~0.43 precisión).
- **Baseline single-signal de F4** (ítem C) — el −relevancia% sobreestima el costo del trade-off.
- **Ningún reranker bate a RRF** en relevancia pura sobre datos sintéticos (¿cambia con outcome de negocio? ítem D).
- **Escala n=2000** (ítem A).
- **Guardrail de relevancia de F4 infactible** (0/24) — el punto KPI es fallback.

---

## 10. Quick-start para la sesión fresca

```bash
cd /workspaces/ecommerce-cuba
git checkout feat/thesis-personalization-program   # ya estás aquí
pnpm health-check && pnpm test:unit && pnpm test:quality   # verificación segura
bash docs/thesis/build.sh                                  # regenera el PDF
# leer: docs/thesis/tesis.pdf  +  los reportes en docs/superpowers/reports/2026-*-thesis-f*
```
Luego elige un ítem del §8 y, **antes de correr `vitest run tests/thesis`**, vuelve a leer el
hazard #1 (§7). Si rompes el dataset, regenéralo con el pipeline de §6.

**Punto de partida sugerido para "al límite":** §8-A (escala n=5000/10000) + §8-B (estabilidad
por seed) en paralelo — juntos dicen si la tesis entera aguanta. Después §8-C (cerrar el caveat
de F4) por ser la deuda metodológica más citada.
