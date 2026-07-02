# Spec — F2: Multi-vector usuario × destinatario + modelo de regalo

**Fecha:** 2026-05-29
**Estado:** Aprobado (brainstorming) — pendiente revisión de spec
**Branch:** `feat/thesis-personalization-program`
**Programa:** tercer bloque de la elevación del pipeline de personalización a
nivel tesis + producto. Construye sobre F0 (datos + arnés de eval) y F1
(embeddings comerciales). Fases posteriores (fuera de alcance): F3 generación de
candidatos + reranker contextual real; F4 ranking multi-objetivo; F5 escritura /
piloto / promoción a producción.

**Specs/planes previos (leer):**
- F0+F1 design: `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`
- F0 plan: `docs/superpowers/plans/2026-05-29-thesis-f0-data-eval-foundation.md`
- F1 plan: `docs/superpowers/plans/2026-05-29-thesis-f1-embedding-study.md`
- F1 resultado: `docs/superpowers/reports/2026-05-29-thesis-f1-embedding-study.md`
- Motivación de negocio/conducta: los tres reports `2026-05-29-audit-*` / `verdict-*`
- `feedback_comphrensive.md` (Idea 1: usuario multi-modo; el caso regalo)

---

## 1. Objetivo y contribución de tesis

Demostrar empíricamente dos tesis que F1 dejó abiertas:
1. **"Un usuario es una distribución, no un punto"** — representar a cada usuario
   con varios vectores (modos de interés) supera al vector único de F1 cuando el
   usuario es genuinamente multi-interés.
2. **"El regalo necesita representación propia"** — detectar la intención de
   regalo y rankear para el *destinatario* (no para el comprador) supera al perfil
   propio, y evita que el historial de regalos envenene el perfil del usuario.

**Por qué ahora:** F1 estableció (resultado justo, n=2000, 1042 casos) que los
embeddings dan **relevancia** (nDCG@10 e2_hybrid 0.126 > e1_prod2vec 0.104 ≫
texto 0.039) pero **no complementariedad** (complement-recall@10 ≈ 0.001 en los 6
espacios). El audit conductual además mostró que el perfil de un solo vector
**se rompe con regalos** (feed del comprador de regalos "siempre un destinatario
atrás") y **promedia intereses ortogonales a un fantasma**. F2 ataca exactamente
esos dos huecos: multimodalidad y regalo. El cross-sell (complementariedad) NO es
objetivo de F2 — pertenece al grafo de co-ocurrencia/NPMI, confirmado por F1.

**Aporte SOTA:** PinnerSage (Pal et al., KDD'20) multi-vector con Ward+medoids,
extendido con un **eje destinatario/regalo** (factorización usuario×destinatario)
que la literatura de multi-interés no modela explícitamente — contribución
original defendible.

---

## 2. Alcance

### En alcance (F2)
- **Formación de modos del usuario** (PinnerSage): clustering Ward del historial
  → k modos adaptativo por usuario, cada modo = medoide + peso + recencia.
- **Detección de intención de regalo** a nivel sesión (señales de la ventana de
  sesión, sin ground-truth en inferencia).
- **Vector de destinatario efímero** construido desde los ítems de la
  sesión-regalo, que reemplaza el perfil propio mientras dura la sesión-regalo
  (no contamina los modos permanentes).
- **Retrieval multi-modo** por cuotas proporcionales al peso + fusión RRF.
- **Evaluación segmentada** (self / gift / nivel de multimodalidad) + métrica
  **recipient-fit@k**, contra el baseline single-vector de F1, vía el arnés F0.

### Fuera de alcance
- Generar datos nuevos: el generador de F0 ya emite y persiste
  `sim_user_recipients`, `sim_sessions.intent` (self/gift) y demografía del
  destinatario (verificado en `0021_thesis_schema.sql` y `behavior-model.ts`).
- Tocar el pipeline de producción `src/sectors/d-personalization/` (la promoción
  a producción es decisión posterior, basada en la evidencia de F2).
- Reranker LLM, multi-objetivo, cross-sell (F3/F4 y el grafo NPMI existente).
- Destinatarios persistentes como buckets (variante considerada y descartada en
  brainstorming a favor del vector efímero por sesión; ver §9).

### No-objetivos (YAGNI)
- No clasificador ML entrenado de intención: la detección es por reglas/señales
  de sesión (interpretable, sin datos de entrenamiento de intención).
- No serving en tiempo real; F2 es banco de pruebas offline sobre el arnés.

---

## 3. Decisiones de diseño (del brainstorming)
1. **Núcleo:** las 3 piezas integradas (multi-vector + regalo + retrieval).
2. **Modos:** PinnerSage — Ward jerárquico + medoides, k adaptativo por usuario.
3. **Regalo:** detección a nivel **sesión** + **vector de destinatario efímero**
   (no persistente, no envenena los modos).
4. **Retrieval:** **cuotas por modo + RRF** (reusa `rrf` del repo).
5. **Eval:** **segmentado** (self/gift × multimodalidad) **+ recipient-fit@k**.
6. **Espacio base de ítems:** **E1 `e1_prod2vec`** (persistido en
   `thesis.item_vectors`, espacio de vector único más fuerte de F1 en relevancia).
   NOTA: E2-hybrid NO sirve como base porque es un ranker de score-fusion, no un
   espacio de vector único clusterizable. El historial del usuario se clusteriza
   en el espacio E1.

---

## 4. Arquitectura

Código nuevo bajo `src/thesis/multivector/` (librería pura + las que tocan DB en
el runner) y `scripts/thesis/` (runner del estudio F2). Aislado de producción.

```
thesis.item_vectors (space='e1_prod2vec')  ─┐
thesis.events / holdout / sim_sessions /    │
  sim_user_recipients / products.metadata   │
                                            ▼
 [modes.ts]   historial usuario → Ward → k modos {medoide, peso, recencia}
 [gift-detect.ts] sesión → {isGift, señales}              (reglas, sin GT en inferencia)
 [gift-vector.ts] ítems de la sesión-regalo → vector destinatario efímero
 [retrieve.ts] modos activos (o vector regalo) → top-K por cuota → rrfFuse → orden
                                            ▼
 [scripts/thesis/f2-study.ts] arnés F0 (Ranker) → eval SEGMENTADO + recipient-fit
   → docs/superpowers/reports/2026-..-thesis-f2-study.md
```

### 4.1 `src/thesis/multivector/modes.ts` (puro)
- `buildUserModes(historyVectors: number[][], opts): UserMode[]` donde
  `UserMode = { medoid: number[]; weight: number; size: number }`.
- **Ward** clustering aglomerativo sobre los vectores del historial (espacio E1),
  cortado para producir k adaptativo según una regla de distancia/tamaño
  (umbral de fusión + cota máxima de modos, p.ej. ≤ 5). Cada cluster se resume por
  su **medoide** (el ítem real más central, no el centroide — interpretable, à la
  PinnerSage) y un **peso** = fracción de eventos del cluster.
- Determinista (orden estable; sin RNG, o RNG sembrado si hace falta desempatar).
- Caso degenerado: historial vacío → `[]`; 1 ítem → 1 modo.

### 4.2 `src/thesis/multivector/gift-detect.ts` (puro)
- `detectGiftIntent(sessionItems: SessionItem[], userModes: UserMode[], opts): GiftSignal`
  donde `GiftSignal = { isGift: boolean; score: number; reasons: string[] }`.
- Señales (de la ventana de sesión, NO de ground truth): (a) navegación
  **cross-cohort sostenida** respecto a los modos del usuario (la sesión apunta a
  una demografía/categoría lejana del perfil); (b) **coherencia demográfica
  interna** de la sesión (los ítems vistos comparten género/edad-banda entre sí
  pero NO con el usuario). Umbral configurable.
- `SessionItem` = `{ product_id, vector, gender_target, age_target }`.
- Determinista; devuelve también `reasons` para interpretabilidad/tesis.

### 4.3 `src/thesis/multivector/gift-vector.ts` (puro)
- `buildRecipientVector(sessionItemVectors: number[][]): number[]` = medoide o
  mean-pool L2-normalizado de los ítems de la sesión-regalo (representa la
  intención hacia el destinatario en el espacio E1). Vacío → `[]`.
- **Efímero**: vive solo en la request; NO se escribe a `item_vectors` ni a los
  modos del usuario (clave para no envenenar el perfil — bug del feedback).

### 4.4 `src/thesis/multivector/retrieve.ts` (puro, sobre vectores en memoria)
- `multiModeRank(opts): string[]` implementa el contrato `Ranker` de F0
  (`rank(ctx, candidates) → string[]`). Modos activos:
  - sesión self → los `UserMode[]` del usuario;
  - sesión gift → un único "modo" = el vector de destinatario efímero (peso 1).
- Por cada modo: rankea candidatos por coseno → lista; toma una **cuota**
  proporcional al peso del modo; fusiona las listas con **`rrfFuse`** (importado
  de `@/sectors/d-personalization/retrieve/rrf`, ya existe) → orden final.
- Reusa `RankedList`/`rrfFuse` del repo; sin reimplementar RRF.

### 4.5 `scripts/thesis/f2-study.ts` (toca DB, sin mocks)
- Carga `e1_prod2vec` de `item_vectors`, eventos/holdout, `sim_sessions`,
  `sim_user_recipients`, metadata de productos.
- Construye, para cada usuario de test: sus modos (4.1) y, por sesión de test, la
  señal de regalo (4.2) y el vector de destinatario (4.3).
- Compara dos rankers sobre el MISMO universo común y los MISMOS casos que F1
  (apples-to-apples): **baseline = F1 single-vector (mean-pool de los ítems train
  en E1)** vs **F2 = `multiModeRank`**.
- Evalúa con el arnés F0 (`evaluateRanker` / `aggregateCases`), **particionando
  por segmento** y calculando **recipient-fit@k**.
- Emite `docs/superpowers/reports/2026-..-thesis-f2-study.md` (+ JSON).

---

## 5. Evaluación (segmentada + recipient-fit)

- **Segmentos** (por verdad conocida, sin filtrar el ranking):
  - intención de la sesión del holdout: **self** vs **gift** (`sim_sessions.intent`);
  - multimodalidad del usuario: **1 modo**, **2–3 modos**, **4+ modos**.
- **Métricas por segmento:** Recall@k, nDCG@k, MRR (las de F0), F2 vs baseline F1.
  - Hipótesis: F2 ≫ baseline en *gift* y en *2–3/4+ modos*; F2 ≈ baseline en
    *self mono-modo* (si pierde ahí materialmente → regresión a investigar).
- **Métrica nueva `recipientFitAtK`** (en `src/thesis/eval/metrics.ts`, con test
  known-answer): en sesiones-regalo, fracción del top-k cuyo `gender_target` y
  banda de edad caen dentro del perfil del destinatario real
  (`sim_user_recipients`). Mide directamente lo que el negocio quiere del regalo.
- **Validación de discriminación del arnés:** un usuario sintético con dos gustos
  ortogonales debe producir 2 modos cuyos top-k cubren AMBOS gustos, mientras el
  baseline single-vector cubre un compromiso vacío (réplica controlada del
  experimento del feedback).

---

## 6. Flujo de datos
1. (Datos ya existen de F0/F1; regenerables con los CLIs `thesis:*`.)
2. `f2-study` lee E1 vectors + eventos + holdout + sim_sessions + recipients.
3. Por usuario: `buildUserModes`; por sesión de test: `detectGiftIntent` →
   (si gift) `buildRecipientVector`.
4. `multiModeRank` vs baseline F1 sobre el universo común → `evaluateRanker`
   segmentado + `recipientFitAtK`.
5. Reporte md/JSON con tablas por segmento + la métrica de regalo.

---

## 7. Estrategia de testing (tests reales, sin mocks; `pnpm test:quality` lo enforza)
- **Unit (puros):** `modes` (2 gustos ortogonales → 2 modos; 1 ítem → 1 modo;
  determinismo), `gift-detect` (sesión cross-cohort plantada → isGift; sesión
  coherente con perfil → no), `gift-vector` (efímero, normalizado, vacío→[]),
  `retrieve` (cuotas respetan pesos; gift usa solo el vector destinatario;
  reusa rrfFuse), `recipientFitAtK` known-answer.
- **Integración (DB `thesis` real):** mundo pequeño plantado → F2 supera al
  baseline single-vector en el segmento *gift* y en usuarios multi-modo
  (`recipient-fit` y nDCG); empata en *self mono-modo*.
- **Determinismo:** misma seed/datos ⇒ mismas métricas.

---

## 8. Criterios de aceptación
1. **Discriminación:** el arnés muestra, en un mundo plantado, que F2 recupera
   ambos gustos de un usuario bimodal y respeta al destinatario en gift, donde el
   single-vector no.
2. **Lift segmentado:** tabla clara F2 vs F1 por segmento; F2 gana en gift y
   multi-modo, no regresiona en self mono-modo (con significancia/IC).
3. **recipient-fit:** F2 mejora recipient-fit@10 en sesiones-regalo vs F1.
4. **Higiene:** `pnpm typecheck` y `pnpm test:quality` verdes; tests nuevos
   verdes; no toca producción; reporte reproducible desde seed.

---

## 9. Riesgos y mitigaciones
- **Sintético ≠ real:** las señales de regalo se calibran contra la verdad del
  generador; reportar el caveat; el cross-check público de F1 (pendiente) cubre
  validez externa del programa.
- **Sobreajuste de gift-detect a cómo el generador crea sesiones-regalo:** las
  señales se definen sobre propiedades generales (cross-cohort, coherencia
  interna), no sobre parámetros del generador; reportar precisión/recall de la
  detección contra `sim_sessions.intent` como diagnóstico honesto.
- **Universo común se encoge** (E1 solo cubre ítems con interacción): igual que
  F1, se reporta `|commonIds|`; el baseline y F2 corren sobre el mismo universo.
- **Ward costo O(n²) por usuario:** el historial por usuario es pequeño (decenas
  de ítems) → barato; cota máxima de modos acota el corte.
- **Variante destinatarios-persistentes:** descartada para F2 (más datos por
  destinatario, más complejidad); el vector efímero ataca el bug central con menos
  riesgo. Queda como posible F2.5 si la evidencia lo pide.

---

## 10. Referencias
- Pal et al., *PinnerSage*, KDD 2020 (multi-vector usuario, Ward + medoids).
- Li et al., *MIND*, CIKM 2019 (multi-interest, alternativa a PinnerSage).
- Pinterest, *Synergizing Implicit & Explicit Interests*, KDD 2025.
- Cormack et al., *Reciprocal Rank Fusion*, SIGIR 2009 (fusión por cuotas).
- `feedback_comphrensive.md` Idea 1 (usuario como distribución; experimento 70/30).

---

## 11. Secuencia de implementación (para el plan)
1. `recipientFitAtK` en métricas (+ test known-answer).
2. `modes.ts` (Ward + medoids) + tests puros.
3. `gift-detect.ts` + tests puros.
4. `gift-vector.ts` + tests puros.
5. `retrieve.ts` (cuotas + rrfFuse) + tests puros.
6. `f2-study.ts` runner: baseline F1 vs F2, eval segmentado + recipient-fit.
7. Corrida end-to-end (n=2000, seed 42) + reporte md/JSON.
8. Test de integración de discriminación (mundo plantado bimodal + gift).
9. Verificación final + push.
