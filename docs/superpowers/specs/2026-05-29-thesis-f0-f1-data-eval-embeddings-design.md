# Spec — F0 (Datos + Evaluación) + F1 (Embeddings comerciales)

**Fecha:** 2026-05-29
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** primer bloque de la elevación del pipeline de personalización a
nivel **tesis + producto real**. Fases futuras (fuera de este spec): F2
multi-vector usuario×destinatario + modelo de regalo; F3 generación de
candidatos + reranker contextual real; F4 ranking multi-objetivo aprendido; F5
escritura/piloto.

**Contexto previo (leer):**
- `docs/superpowers/reports/2026-05-29-audit-ranker.md` (bugs de código)
- `docs/superpowers/reports/2026-05-29-audit-ranker-behavioral.md` (conducta)
- `docs/superpowers/reports/2026-05-29-verdict-personalizacion-vs-ecommerce-normal.md` (veredicto)
- `feedback_comphrensive.md` (las 3 ideas: usuario multimodal; relación comercial ≠ lingüística; ranking multi-objetivo)

---

## 1. Objetivo y contribución de tesis

Construir la **base empírica** del programa: un **simulador de marketplace con
ground-truth conocido**, un **arnés de evaluación** de nivel industrial, y sobre
ellos un **estudio comparativo de estrategias de embedding**.

**Contribución de este bloque (defendible en tesis):** una comparación
apples-to-apples de embeddings *textuales* vs *comportamentales* vs *híbridos* vs
*two-tower* vs *late-interaction* sobre tres preguntas comerciales que el coseno
de texto no resuelve bien:
1. recuperar la **próxima compra del mismo gusto** (relevancia personal),
2. recuperar **complementos** (cross-sell) — relación comercial, no lingüística,
3. recuperar **cola larga** (ítems nuevos/poco vistos).

Medido con holdout temporal, métricas beyond-accuracy, estimación off-policy y
cross-check en un dataset público.

**Por qué primero:** la tesis es empírica y el producto debe ganar dinero; sin un
arnés que mida lift de forma creíble, ninguna fase posterior es demostrable. Este
bloque también **arregla el baseline roto** del eval F3c (delta 0% espurio).

---

## 2. Alcance

### En alcance (F0 + F1)
- Generador de catálogo híbrido (~5.000 sintéticos + 512 reales ancla) con
  embeddings Voyage y **vector latente de atributos** (ground truth).
- Grafo de complementariedad ground-truth (complemento/sustituto).
- Generador de usuarios y comportamiento con **estado latente conocido**
  (gusto multimodal, destinatarios/regalo, sensibilidad a precio).
- Adaptador de un dataset público de e-commerce al esquema (validez externa).
- Arnés de evaluación: split temporal, suite de métricas, baselines, ablation
  runner, estimadores OPE, runner de simulación (v1 click-model), reporte.
- Cinco estrategias de embedding tras una interfaz común `Embedder`:
  E0 texto, E1 Prod2Vec, E2 híbrido, E3 two-tower, E4 late-interaction (ColBERT).

### Fuera de alcance (fases posteriores)
- Multi-vector usuario×destinatario y reranker contextual (F2/F3).
- Ranking multi-objetivo aprendido / bandits (F4).
- Cambios en el `generateFeed` de producción (se consume vía interfaz `Ranker`
  para medir, no se reescribe aquí).
- Piloto online real (F5).

### No-objetivos (YAGNI)
- No entrenar LLMs propios. ColBERT arranca con checkpoint multilingüe
  pre-entrenado (inferencia).
- No infra de serving en tiempo real para los embeddings nuevos (esto es banco de
  pruebas offline; la promoción a producción es decisión posterior por evidencia).

---

## 3. Arquitectura

Unidades aisladas, cada una con un propósito y testeable sola. Código nuevo bajo
`src/thesis/` (lib) y `scripts/thesis/` (CLIs de generación/entrenamiento/run).
Aislamiento de datos: **esquema DB dedicado `thesis`** (paralelo a `public` /
`test_schema`), creado por migración nueva; añade scope `"thesis"` a
`getPgClient`. No toca datos de producción ni de test.

```
[catalog-gen] ─┐
[gt-relations]─┼─► DB schema `thesis` ─► [split temporal] ─► train / test
[behavior-gen]─┘                                   │
[public-adapter]──────────────────────────────────┘
        │
        ▼
  train each Embedder (E0..E4) on TRAIN
        │
        ▼
  Eval harness: for each (Embedder × Ranker-baseline) → retrieve/rank TEST holdout
        │
        ├─ métricas (accuracy + beyond-accuracy + complement-recall)
        ├─ OPE (IPS/SNIPS/DR) sobre la política logged
        └─ ablation runner → tablas de tesis (markdown/JSON)
```

---

## 4. Componentes — especificación

### 4.1 Esquema DB `thesis` (identificadores en inglés)
Replica las tablas que el pipeline consume sin calificar (`products`, `events`,
`user_profiles`, `user_profile_modes`, `session_vectors`, `co_occurrence`,
`co_occurrence_top`, `cohort_centroids`, `anonymous_sessions`, `excluded_products`,
`feed_rerank_cache`) — igual que `test_schema` — **más** tablas de ground truth:

- `gt_product_factors(product_id PK, factor_vector vector, taxonomy jsonb)` — el
  vector latente "verdadero" y la ruta de taxonomía de cada producto sintético.
- `gt_product_relations(product_a_id, product_b_id, relation_type text, strength real, PK(a,b,relation_type))` —
  `relation_type ∈ {complement, substitute, upgrade, accessory}`.
- `sim_users(user_id PK, latent_state jsonb, p_gift real, price_sensitivity real)` —
  estado latente conocido (clusters de gusto, etc.).
- `sim_user_recipients(id PK, user_id FK, relation text, gender text, age_min int, age_max int)`.
- `sim_sessions(session_id PK, user_id FK, intent text, recipient_id FK NULL, started_at timestamptz)` —
  intención verdadera por sesión (`self` | `gift`).
- `holdout(user_id, product_id, occurred_at, split text)` — `split ∈ {train,test}`;
  el/los ítems "futuros" reservados para evaluación.

Migración: `supabase/migrations/00NN_thesis_schema.sql` (+ replicate de las tablas
del pipeline en `thesis`). Helper `getPgClient({scope:"thesis"})` con
`search_path = thesis, public, extensions`.

### 4.2 Catalog generator (`scripts/thesis/data/catalog-gen.ts`)
- Taxonomía declarativa: `categoría → subcategorías → marcas → atributos`
  (género objetivo, banda de edad, banda de precio, estilo, color, material).
- Combinatoria muestreada → ~5.000 productos; títulos/descripciones en español
  por plantillas parametrizadas (variadas, no triviales, para que BM25 y embeddings
  tengan señal real).
- Cada producto recibe un **factor_vector** latente (one-hot/embeddings de sus
  atributos) → `gt_product_factors`. El embedding Voyage se calcula del texto.
- Incluye las **512 reales** (de `public.products`) como ancla, marcadas
  `source='thesis-real'` vs `source='thesis-syn'`.
- Determinista dado `--seed`. Interfaz: `generateCatalog({n, seed, pg})`.

### 4.3 Grafo de complementariedad GT (`scripts/thesis/data/gt-relations.ts`)
- Reglas por taxonomía: p.ej. `telefono → {funda, cargador, audifonos}` (complement),
  `vestido → {tacones, cartera, collar}` (complement/accessory),
  misma subcategoría + distinta marca → `substitute`, gama superior → `upgrade`.
- Persiste en `gt_product_relations` con `strength`. Este grafo es el **patrón-oro**
  para `complement-recall@k`. Hipótesis de validación: recuperable por
  co-ocurrencia, NO por coseno de texto.

### 4.4 Generador de comportamiento (`scripts/thesis/data/behavior-gen.ts`)
Modelo generativo con verdad conocida:
- **Usuario latente:** mezcla de `K∈[1,3]` clusters de gusto (centros en el espacio
  de factores), `price_sensitivity`, `novelty_seeking`, `p_gift`, y 0–3
  `recipients` (relación + demografía).
- **Sesión:** con prob `p_gift` es *gift* (muestrea del cluster demográfico del
  recipient), si no es *self* (muestrea del gusto propio). Registra `intent` y
  `recipient` verdaderos en `sim_sessions`.
- **Modelo de click/compra:** prob de view ∝ softmax(sim(item, intención) ·β
  − γ·|precio−presupuesto| + δ·log popularidad). Cadena view→(cart)→(purchase)
  con tasas de embudo. Co-ocurrencia intra-sesión sembrada desde el grafo GT
  (los complementos se co-ven/co-compran). Emite también `dismiss` ocasional.
- **Ground truth de eval:** por usuario, el gusto real (para evaluar recuperación
  de perfil multi-vector en F2), la intención por sesión (para evaluar
  cohorte/regalo), y la **próxima compra** reservada en `holdout`.
- Determinista dado `--seed`. Parámetros (N usuarios, días, tasas) configurables.

### 4.5 Adaptador de dataset público (`scripts/thesis/data/public-adapter.ts`)
- Carga un dataset abierto de e-commerce (sesiones/compras) y lo mapea al esquema
  (`products`, `events`) en `thesis` con `source='public'`. Subconjunto acotado.
- Propósito: cross-check de validez externa de las conclusiones del estudio de
  embeddings. Dataset concreto a fijar en el plan (candidato: Amazon Reviews 2023
  categoría moda/electrónica, o un dataset de sesiones tipo RetailRocket/Yoochoose
  según licencia).

### 4.6 Arnés de evaluación (`src/thesis/eval/`)
- **`Ranker` interface:** `rank(userCtx, candidatePoolOrAll) → rankedProductIds[]`.
  Todo baseline y todo método futuro (embedders, reranker, multi-objetivo) lo
  implementa. Permite ablations uniformes.
- **`Embedder` interface:** `embedItems(products) → vectors`, `embedQuery(userCtx)
  → vector(s)`, `score(query, item) → number`. E0..E5 lo implementan.
- **Splitter** (`split.ts`): holdout temporal por usuario (train<t*, test≥t*) +
  leave-one-out next-purchase. Determinista.
- **Métricas** (`metrics.ts`, con fórmulas y tests known-answer):
  - Accuracy: `Recall@k`, `nDCG@k`, `MRR`, `MAP`, `HitRate@k`.
  - Beyond-accuracy: cobertura de catálogo, diversidad intra-lista
    (`1 − avg pairwise cosine`), novedad (`−log popularidad`), serendipia, Gini.
  - Comercial: `complement-recall@k` (fracción de complementos GT del último ítem
    presentes en el top-k).
- **Baselines** (`baselines/`): random, popular-global, popular-cohort, BM25,
  cosine-single-vector (= sistema actual). Cada uno = un `Ranker`.
- **Ablation runner** (`ablate.ts`): corre el producto cartesiano de configs
  (embedder × baseline × parámetros) y agrega métricas → tablas.
- **OPE** (`ope.ts`): IPS, SNIPS y doubly-robust para estimar reward online
  (CVR/revenue) desde la política logged sintética; con propensities conocidas
  (las del generador) para validar los estimadores contra la verdad.
- **Simulación** (`sim.ts`): v1 = click-model calibrado del generador (determinista,
  barato) para A/B offline a escala; agentes-LLM (AlignUSER) como stretch.
- **Reporte** (`report.ts`): tablas markdown/JSON + series para gráficos.

### 4.7 Estrategias de embedding (`src/thesis/embedders/`)
Interfaz común `Embedder`. Secuenciadas (cada una entregable y medible sola):
- **E0 Texto** — wrapper de Voyage (actual). Línea base.
- **E1 Prod2Vec** — skip-gram con negative sampling sobre secuencias de sesión
  (ítems co-vistos/co-comprados); dim configurable; entrena offline y persiste.
  Objetivo: maximizar `log σ(v_i·v_j)` para pares en ventana + negativos.
- **E2 Híbrido** — gate por nº de interacciones del ítem:
  `e = α·textNorm + (1−α)·behavNorm`, `α = κ/(κ+n_interactions)` (texto domina en
  cold-start; comportamiento al calentarse). Variante concat+proyección como
  alternativa a evaluar.
- **E3 Two-tower** — torre item (atributos+texto) y torre query (contexto de
  usuario), entrenadas con in-batch negatives + hard negatives + **corrección logQ
  de sesgo de muestreo** (Yi et al., RecSys'19). El embedding de la torre item se
  usa para retrieval ANN; la torre query produce el vector de consulta.
- **E4 Late-interaction (chunk-MaxSim, in-repo)** — multi-vector por ítem
  embebiendo por separado los chunks del producto (título / descripción /
  atributos) con Voyage; score `MaxSim`. Aproxima ColBERT a nivel de chunk SIN
  GPU/torch (el repo no los tiene); ColBERT real vía Jina API queda como variante
  futura. **Decisión 2026-05-29.** Se aplica como **re-scoring de un candidate
  set** (no ANN completo) para mantener costo acotado.
- **E5 voyage-context-3 (candidato de producción)** — embeddings contextualizados
  de chunk (un vector por chunk con contexto global del documento) vía la API
  `voyage-context-3`, pooled a un vector por ítem. No es MaxSim multi-vector; es
  el **candidato realista de serving** (un vector denso por ítem, drop-in para
  pgvector) que el estudio compara contra E0–E4. **Añadido 2026-05-29** por el
  objetivo producción-primero.

> **Entregable de producción de F1:** además de las tablas académicas E0–E5, el
> runner del estudio emite una **recomendación explícita** del embedder a
> desplegar, ponderando calidad (taste/complementos/cola) contra costo/latencia
> de serving. Conecta la tesis con el producto que debe ganar dinero.

---

## 5. Flujo de datos
1. `catalog-gen --seed S --n 5000` → `thesis.products` + `gt_product_factors`.
2. `gt-relations` → `gt_product_relations`.
3. `behavior-gen --seed S --users U --days D` → `events`, `sim_*`, `holdout`.
4. `public-adapter` → subset público en `thesis` (`source='public'`).
5. `train-embedders` → vectores E1..E4 persistidos; E0 ya está.
6. `eval-run` → para cada (Embedder × baseline) rankea el holdout → métricas + OPE
   + ablations → `docs/superpowers/reports/2026-..-f1-embedding-study.md`.

---

## 6. Estrategia de testing (tests reales, sin mocks — `pnpm test:quality` lo enforza)
- **Unit:** métricas con known-answer (nDCG/Recall/MAP a mano), splitter
  determinista, Prod2Vec sobre corpus diminuto con vecindad conocida, gate E2,
  estimadores OPE sobre política logged con propensities y reward conocidos.
- **Integración (DB real, esquema `thesis`):** "genera mundo pequeño (≈200
  productos, 50 usuarios) → entrena E1 → E1 supera a random y popular en
  `complement-recall@10`".
- **Validación de discriminación del arnés:** el grafo GT es recuperable por
  co-ocurrencia pero **no** por coseno de texto (prueba que el eval distingue
  relación comercial de lingüística).
- **Determinismo:** misma seed ⇒ mismas métricas (reproducibilidad de tesis).

---

## 7. Costo / cómputo
- Embeddings Voyage ~5.512 productos ≈ **$0.11**.
- Prod2Vec / two-tower: dims chicas, entrenan en CPU en minutos a escala 5k.
- ColBERT: checkpoint multilingüe pre-entrenado (solo inferencia) en este bloque.
- Generación y eval: sin llamadas al mock aggregator ($0) y sin LLM salvo el
  stretch de agentes-LLM (opcional, documentado).

---

## 8. Criterios de aceptación del bloque
1. **Arnés correcto:** reproduce un orden/métrica conocidos sobre un mundo plantado
   (test de discriminación verde).
2. **Estudio comparativo:** tabla clara Embedder×métrica sobre gusto / complementos
   / cola, vs baselines, con intervalos/significancia, y narrativa de cuál gana en
   qué y por qué.
3. **Baseline arreglado:** el bug de delta 0% del eval F3c queda corregido y
   documentado.
4. **Validez externa:** las conclusiones principales se replican (cualitativamente)
   en el dataset público.
5. **Reproducibilidad:** todo corre desde `--seed`; `pnpm typecheck` y
   `pnpm test:quality` verdes; tests nuevos verdes.

---

## 9. Riesgos y mitigaciones
- **Sintético ≠ real** → ancla real (512) + dataset público (C) + generador
  calibrado; conclusiones se reportan con ese caveat explícito.
- **Bloque grande** → secuenciar E0→E1→E2 (núcleo) → E3 → E4; cada uno es un
  incremento medible; E4 puede promoverse a fase aparte si el cronograma aprieta.
- **Sobreajuste del generador a lo que el método favorece** → el grafo GT y el
  modelo de click se definen ANTES y con reglas neutrales; ablations y dataset
  público controlan el sesgo.
- **Costo Voyage / rate limits** → batch + cache de embeddings por hash de texto.

---

## 10. Referencias (SOTA que fundamenta el diseño)
- Pal et al., *PinnerSage*, KDD 2020 — arXiv 2007.03634 (multi-vector usuario; F2).
- Pinterest, *Synergizing Implicit & Explicit Interests*, KDD 2025 — arXiv 2506.23060.
- Yi et al., *Sampling-Bias-Corrected Neural Modeling*, RecSys 2019 (two-tower logQ; E3).
- Khattab & Zaharia, *ColBERT* / *ColBERTv2*; *Jina-ColBERT-v2* arXiv 2408.16672 (E4).
- *LLM4Rerank* WWW 2025; *REARANK* arXiv 2505.20046; RankGPT/Zephyr (F3 futuro).
- *MOO by distillation* arXiv 2407.07181; *Diversify & Conquer* 2309.14046 (F4 futuro).
- nDCG como métrica OPE — arXiv 2307.15053; *OPE of candidate generators* RecSys 2025.
- *AlignUSER* (LLM-agent world models para eval) — arXiv 2601.00930 (simulación).
- Barkan & Koenigstein, *Item2Vec*, 2016 (E1).

---

## 11. Secuencia de implementación (para el plan)
1. Migración `thesis` schema + scope + helpers de conexión.
2. Catalog generator + `gt_product_factors` + embeddings Voyage.
3. Grafo de complementariedad GT.
4. Generador de comportamiento + `sim_*` + `holdout`.
5. Arnés: interfaces `Ranker`/`Embedder`, splitter, métricas (+ tests), baselines.
6. Ablation runner + reporte; **arreglar baseline F3c**.
7. OPE + simulación v1.
8. Embedders E0 (wrap) → E1 → E2 → E3 → E4.
9. Adaptador de dataset público + corrida de cross-check.
10. Corrida completa del estudio comparativo + reporte de resultados.
