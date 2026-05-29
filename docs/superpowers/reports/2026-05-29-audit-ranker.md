# Audit adversarial — Pipeline de ranking / personalización

**Fecha:** 2026-05-29
**Branch:** `audit/ranker-pipeline-2026-05-29` (NO mergeada a `main`)
**Base auditada:** `main` @ `d2c2f81` (merge de `feat/fase-3c-mmr-llm-reranker`)
**Handoff:** `docs/handoff-audit-reranker-pipeline.md`
**Disciplina:** `superpowers:systematic-debugging` + `superpowers:test-driven-development`

---

## 0. TL;DR

- **No se encontraron P0** (crash / corrupción / pérdida de datos). La
  infraestructura (cache, fallback, wiring, migraciones) está sólida, como
  afirmaba el cierre F3c.
- **Sí se encontraron defectos de correctitud/calidad** que degradan la función
  primaria (relevancia del feed) de forma silenciosa, en el path crítico de
  TODOS los usuarios personalizados. **Deben fixearse antes de F4.**
- **5 tests fallidos reproducibles** commiteados (4 archivos, 6 casos incl. 1
  control que pasa). Todos rojos en `main` por la razón correcta.
- **6 hallazgos adicionales** verificados por inspección de código (sin test por
  requerir fault-injection o ser decisiones de diseño documentadas).
- **3 hipótesis del handoff DESCARTADAS** tras verificación (ver §4) — evita que
  el próximo agente pierda tiempo en ellas.

| # | Hallazgo | Sev | Test | Código |
|---|---|---|---|---|
| 1 | MMR mezcla escalas `rrf_score` (~0.01) vs cosine (~1.0) → λ=0.7 actúa como λ≈0.04 | **P1** | `tests/unit/audit-mmr-scale.test.ts` | `mmr.ts:66` |
| 2 | Cache key del reranker es ciega al contexto → razones stale 4h | **P1** | `tests/unit/audit-rerank-cache-context.test.ts` | `cache-key.ts:14` |
| 3 | Llamada al LLM sin timeout → un DeepSeek colgado cuelga el feed | **P1** | (sin test, ver §3.3) | `deepseek-flash.ts` / `rerank.ts:62` |
| 4 | Feed personalizado topado en 10, ignora `limit` (default 20) | **P2** | `tests/integration/audit-feed-limit.test.ts` | `feed.ts:280-323` |
| 5 | MMR trata embedding ausente como "máxima diversidad" → favorece duplicados sin embedding | **P2** | `tests/unit/audit-mmr-missing-embedding.test.ts` | `mmr.ts:57-65` |
| 6 | Fallback silencioso del reranker: solo `console.warn`, sin métrica | **P2** | (sin test, ver §3.6) | `feed.ts:313-320` |
| 7 | El campo `rank` del LLM no ordena el feed (se usa el orden del array) | **P2** | (sin test, ver §3.7) | `feed.ts:162-168` |
| 8 | Cohort `unisex_indeterminado` ⇒ popularidad SIEMPRE vacía (cold start sin fallback) | **P2** | (sin test, ver §3.8) | `popular-by-cohort.ts:23` |
| 9 | `purchase` no excluye ni invalida cache → re-muestra lo recién comprado | **P2** | (sin test, ver §3.9) | `feed.ts` / `dismiss.ts` |
| 10 | `health-check` valida Anthropic (dormant), NO el provider activo (DeepSeek); hoy falla | **P2** | (sin test, ver §3.10) | `scripts/health-check.ts` |
| 11 | `import { describe } from "node:test"` colado en código de producción | **P2** | (sin test, ver §3.11) | `src/lib/math.ts:1` |
| — | Notas de diseño (RRF sin pesos, λ hardcoded, `cacheSystem` no-op en DeepSeek, typecheck roto por `.next`) | nota | — | §5 |

---

## 1. Setup verificado

```
pnpm test:unit       → 176/176 ✅
pnpm test:quality    → 0 violations (87 archivos base; 91 con los del audit) ✅
pnpm verify:supabase → DB viva, 22 tablas, embedding dim 1024 ✅
pnpm health-check    → ❌ falla (Anthropic credit depleted) — ver hallazgo #10
pnpm typecheck       → ❌ falla SOLO por tipos generados en .next/dev/* — ver §5
```

> **Disciplina de lectura (importante para el próximo agente):** la *primera*
> lectura de `feed.ts` vino corrupta (mostraba un `fetchExcludedIds` duplicado,
> una función `applyRerankOrder` y `toFeedItem` con `similarity:0` — **nada de
> eso existe en el archivo real**). Todas las afirmaciones de este reporte se
> basan en re-lecturas verificadas y/o `cat` directo, no en la primera lectura.
> Si auditás de nuevo, confirmá cada `file:line` con `cat`/`grep`.

---

## 2. Findings con test (P1/P2)

### 2.1 — [P1] MMR mezcla escalas: `rrf_score` vs cosine

**Test:** `tests/unit/audit-mmr-scale.test.ts` — ROJO (`expected 'C' to be 'B'`).

**Síntoma / mecanismo.** `mmr.ts:66`:

```ts
const score = lambda * cand.rrf_score - (1 - lambda) * maxSim;
```

`cand.rrf_score` viene de `rrfFuse` (`rrf.ts:30`): `1/(k0 + rank)` con `k0=60`.
Valores reales: rank #1 en 1 fuente ≈ `0.0164`; rank #1 en 3 fuentes ≈ `0.049`;
rank bajo ≈ `0.009`. Es decir **`rrf_score ∈ ~[0.008, 0.05]`**.

`maxSim` es cosine `∈ [0,1]`. Con λ=0.7 el término de relevancia llega como
máximo a `0.7·0.05 ≈ 0.035`, mientras que el de diversidad llega a `0.3·1.0 =
0.30`. La MMR canónica (Carbonell & Goldstein) asume **ambos términos en la misma
escala** (cosine para los dos). Mezclar relevancia ~0.01 con similitud ~1.0 hace
que el λ=0.7 documentado se comporte como **λ efectivo ≈ 0.04**: después del
primer pick, la diversidad domina y el ranking de fusión se ignora casi por
completo.

**Por qué no se detectó antes.** El unit test existente
(`mmr-personalization.test.ts:46`, "λ=0.7 balanced") usa `rrf_score` de
`1.0/0.95/0.5` — valores que **nunca** ocurren en producción. El mutation test de
`MMR_LAMBDA` "pasó" pero bajo esas mismas entradas irreales, así que el tuning de
λ está efectivamente **sin probar** en condiciones reales.

**Impacto en producción.** MMR decide *cuáles 30 de los 100* candidatos fusionados
avanzan al reranker LLM. Con la diversidad dominando, ítems muy relevantes pero
algo similares a un ya-seleccionado se descartan antes de llegar al LLM. En el
path sin perfil (`feed.ts:281`) el top-30 se sirve directo → el usuario ve un set
diverso pero de relevancia degradada. Afecta el 100% de los feeds.

**Fix sugerido (no implementado).** Normalizar la relevancia a `[0,1]` antes de
la MMR (p.ej. min-max sobre los `rrf_score` del set, o usar el *rango* en vez del
score), de modo que λ pondere magnitudes comparables. Re-correr el mutation test
de λ con `rrf_score` realistas.

---

### 2.2 — [P1] Cache key del reranker es ciega al contexto

**Test:** `tests/unit/audit-rerank-cache-context.test.ts` — ROJO (keys iguales).

**Síntoma / mecanismo.** El reranker es **contextual**: `prompt.ts` le pide
"re-rankear … para ESTE usuario en ESTE momento" y `feed.ts:296-309` le pasa
`hour`, `day_of_week` y `last_interaction` (último producto visto). Pero la cache
key (`cache-key.ts:14`) es:

```ts
const input = `${user_profile_id}|${sorted.join(",")}|${PROMPT_VERSION}`;
```

Ninguna entrada contextual participa. Mientras el set de candidatos (top-30) no
cambie, dos requests en contextos distintos (mañana vs noche; acaba de ver un
abrigo vs un traje de baño) colisionan en la misma key y el segundo se sirve la
respuesta cacheada del primero por hasta `CACHE_TTL_HOURS = 4h`.

**Impacto en producción.** Las razones "Vio X hace pocos minutos" se vuelven
stale: tras ver otro producto (si no hay datos de co-ocurrencia que muevan el
top-30, lo normal en catálogo joven), el feed puede seguir diciendo "complementa
el iPhone que viste". El diferenciador del MVP (reranking contextual) queda
silenciosamente congelado 4h por usuario.

**Fix sugerido.** Incluir en la key un hash de las dimensiones de contexto que el
prompt realmente usa (bucket de hora, `last_interaction`/last-viewed id,
recipient). Trade-off: baja el hit-rate; mitigar con buckets gruesos (p.ej.
franja horaria, no hora exacta).

---

### 2.3 — [P2] Feed personalizado topado en 10, ignora `limit`

**Test:** `tests/integration/audit-feed-limit.test.ts` — ROJO (`expected 10 to be 12`).

**Síntoma / mecanismo.** `generateFeed` default `limit = 20` (`feed.ts:175`) y lo
respeta en el path sin perfil vía `top30.slice(0, limit)` (`feed.ts:281`). Pero el
path personalizado nunca puede exceder 10:

- el reranker está fijado a exactamente 10 (`rerank.ts:21` `.length(10)`),
- y el fallback hardcodea `top30.slice(0, 10)` (`feed.ts:315`),
- tras lo cual `cached.slice(0, limit)` (`feed.ts:323`) solo puede achicar.

**Impacto.** Un usuario con perfil (logueado/anónimo-con-cookie) pidiendo
`limit=20` con 12 candidatos válidos recibe **10**; el mismo shape sin perfil
devolvería hasta 20. El default de 20 nunca se honra para los usuarios que más
queremos servir. Inconsistencia objetiva del contrato de la función.

**Fix sugerido.** Decidir el tamaño del feed personalizado explícitamente: o el
reranker devuelve `min(limit, candidatos)` (cambiar `.length(10)` a un rango y el
prompt), o documentar que el feed personalizado es de 10 y alinear el default de
`limit`. Hoy es ambiguo.

---

### 2.4 — [P2] MMR trata embedding ausente como "máxima diversidad"

**Test:** `tests/unit/audit-mmr-missing-embedding.test.ts` — control PASA, BUG ROJO.

**Síntoma / mecanismo.** `mmr.ts:57-65`: `maxSim` arranca en 0; si un candidato no
tiene embedding (`normFor` → null) el loop de similitud se saltea y `maxSim`
queda 0 → **penalización de diversidad cero**. Igual, un ítem ya seleccionado sin
embedding (`mmr.ts:61 if (!selN) continue;`) no ejerce repulsión.

El test demuestra la **asimetría**: un duplicado *con* embedding se suprime
correctamente (control verde); el *mismo* duplicado *sin* embedding se surface
(bug rojo) porque esquiva la penalización.

**Impacto.** En producción el mapa de embeddings lo arma
`feed.ts:fetchProductEmbeddings` con `WHERE embedding IS NOT NULL`, así que los
candidatos de co-ocurrencia/popularidad sin embedding caen acá rutinariamente.
Para un reseller que jala de Amazon/AliExpress, los productos sin embedding son
justo los que menos conocemos — y MMR los favorece sistemáticamente.

**Fix sugerido.** Penalizar (o excluir) candidatos sin embedding en MMR, o
loguear/contar cuántos candidatos llegan sin embedding (observabilidad).

---

## 3. Findings sin test (verificados por inspección)

### 3.3 — [P1] Llamada al LLM sin timeout
`deepseek-flash.ts` hace `client().chat.completions.create({...})` **sin
`timeout` ni `AbortSignal`**; `rerank.ts:62` tampoco lo configura. El SDK de
OpenAI default ~600s y reintentos. Un DeepSeek lento/colgado bloquea el request
de feed completo (el `try/catch` de `feed.ts:294-320` solo captura *errores*, no
*latencia*). El handoff (5.4) lo sospechaba; **confirmado**.
**Fix:** pasar `{ timeout: 1500, maxRetries: 0 }` (o un `AbortController`) y dejar
que el fallback MMR entre por timeout, no solo por error.
*Sin test:* reproducirlo requiere un endpoint lento controlable (mockear el LLM
está prohibido por `test:quality`).

### 3.6 — [P2] Fallback silencioso sin observabilidad
`feed.ts:314` es solo `console.warn("[feed] reranker failed…")`. No hay métrica
ni contador de fallback-rate. En prod, si DeepSeek falla el 100% del tiempo, el
único síntoma es la ausencia de razones en la UI. **Fix:** emitir métrica/evento
de `reranker_fallback` para alertar.

### 3.7 — [P2] El `rank` del LLM no ordena el feed
`resolveWithReasons` (`feed.ts:162-168`) mapea `items` **en el orden del array** y
usa `it.rank` solo para `similarity: 1/(it.rank+1)`. El orden final del feed es el
orden del array que devolvió el LLM, no su campo `rank`. Si el LLM devuelve el
array desordenado respecto a `rank` (zod valida unicidad de ranks pero **no** que
el array esté ordenado, `rerank.ts:74-77`), el feed sale mal ordenado y la
`similarity` mostrada no corresponde a la posición. Frágil. **Fix:** ordenar por
`rank` antes de resolver.

### 3.8 — [P2] `unisex_indeterminado` ⇒ popularidad vacía (cold start)
`popular-by-cohort.ts:23`: `if (!gender || !age_band) return [];`. El cohort por
defecto (`feed.ts:182`, y el de la mayoría de usuarios nuevos/anónimos) no tiene
género/edad ⇒ la lista C (popularidad) es **siempre vacía**. El fallback de
popularidad que el feedback recomienda para usuarios casuales nunca dispara para
el cohort por defecto. **Fix:** popularidad global (sin filtro demográfico) como
fallback cuando el cohort es indeterminado.

### 3.9 — [P2] `purchase` no excluye ni invalida cache
Solo `a-tracking/dismiss.ts` inserta en `excluded_products`; `purchase` no. No hay
invalidación de `feed_rerank_cache` por evento (solo el cron de expirados,
`cron-rerank-cache-cleanup.ts`). Resultado: tras comprar el top-1, el producto
sigue siendo candidato y, si el top-30 no cambió, la cache hit (TTL 4h) lo
re-muestra con su razón cacheada. Puede ser intencional para consumibles, pero
está **indocumentado** y la cache lo hace pegajoso. **Fix:** definir política
(excluir N días tras compra, o invalidar cache por perfil en `purchase`).

### 3.10 — [P2] `health-check` valida el provider equivocado
`scripts/health-check.ts` prueba Voyage (OK) y **Anthropic** (`anthropic.ts:43`),
que es el provider *dormant*. Hoy **falla** por créditos Anthropic agotados,
mientras el provider activo (DeepSeek) **nunca se verifica**. Da una señal de
salud roja por algo irrelevante y verde-falso sobre el path real. **Fix:** que
`health-check` pruebe `defaultProvider`.

### 3.11 — [P2] `import { describe } from "node:test"` en producción
`src/lib/math.ts:1` importa `describe` de `node:test` (framework de testing) en un
módulo de producción usado por todo el ranker (`mmr.ts`, `effective.ts`, …). No se
usa; es un leftover accidental. Riesgo de bundling (edge/cliente) y ruido. **Fix:**
borrar la línea.

---

## 4. Hipótesis DESCARTADAS (no son bugs)

Verificadas contra el código real y resultaron falsas — documentadas para no
re-investigarlas:

1. **"`popular-by-cohort` ignora `excludedIds`"** (vector 5.9). Falso:
   `popular-by-cohort.ts:33` filtra `AND NOT (id = ANY($4::uuid[]))`. Las 3
   listas (A `retrieve.ts:22`, B `feed.ts:251`, C) respetan `excluded`.
2. **"El vector de sesión se pasa sin normalizar y domina la mezcla"** (vector
   5.8). Falso: `feed.ts:228` normaliza (`sessionUnnorm ? normalize(...) : null`)
   y `effective.ts` además espera el vector ya normalizado. α tope = `ALPHA_MAX`.
3. **"`applyRerankOrder(reranked)` recibe `{items}` y revienta / cache.ts sin
   import de `PROMPT_VERSION`"** — artefacto de la **lectura corrupta** inicial.
   El código real no tiene `applyRerankOrder`; `cache.ts:2` sí importa
   `PROMPT_VERSION`. `normalize([0,…])` es seguro ante vector cero (`math.ts`).

---

## 5. Notas de diseño (no se commitea test; decisiones, no bugs)

- **RRF sin pesos por fuente** (`rrf.ts`): las 3 listas pesan igual; popularidad
  (señal débil) compite a la par con semántica. El handoff (4.7) lo marca; es un
  trade-off conocido de RRF score-free. Considerar pesos por fuente.
- **λ MMR hardcoded 0.7** (`mmr.ts:3`): no configurable por cohort/usuario.
  Relacionado con #1 — al arreglar la escala, exponer λ como hiperparámetro.
- **`cacheSystem: true` es no-op bajo DeepSeek** (`deepseek-flash.ts` no lee
  `input.cacheSystem`). La mitigación de latencia que cita el cierre F3c
  ("prompt caching ya implementado") **no aplica al provider activo**; solo
  aplicaría con Anthropic restaurado. Relevante para la compuerta p99<1.5s.
- **`typecheck` rojo** por `.next/dev/types/link.d.ts` y `validator.ts`
  (artefactos generados de Turbopack dev), no por código fuente. CI que corra
  `pnpm typecheck` fallará. **Fix:** excluir `.next` del tsconfig de typecheck o
  limpiar antes de correr.

---

## 6. Métricas del audit

- **Tests fallidos commiteados:** 4 archivos / 6 casos (5 rojos + 1 control
  verde). Cada uno verificado rojo en `main` por la razón correcta.
  - `tests/unit/audit-mmr-scale.test.ts`
  - `tests/unit/audit-mmr-missing-embedding.test.ts` (1 control verde + 1 bug rojo)
  - `tests/unit/audit-rerank-cache-context.test.ts`
  - `tests/integration/audit-feed-limit.test.ts`
- **Costo:** ~$0.0003 (12 embeddings Voyage del test de integración). Cero
  llamadas pagas al LLM (el test de límite fuerza el fallback con key inválida).
- **Cobertura nueva:** escalado relevancia/diversidad en MMR, path
  embedding-ausente en MMR, dimensión de contexto de la cache key, y manejo de
  `limit` en el path personalizado — ninguno cubierto antes.
- **Hallazgos:** 2×P1 con test, 1×P1 sin test, 2×P2 con test, 6×P2 sin test,
  4 notas de diseño, 3 hipótesis descartadas. **0 P0.**

---

## 7. Recomendación

- **Antes de F4:** fixear #1 (escala MMR), #2 (cache contextual) y #3 (timeout
  LLM). Son los tres que degradan/arriesgan el path crítico de forma silenciosa.
- #4–#11 pueden ir en paralelo con F4.
- Re-correr el mutation test de `MMR_LAMBDA` con `rrf_score` realistas tras el
  fix #1; hoy el tuning de λ está efectivamente sin verificar.
- **NO mergear esta branch a `main`.** Es solo el cuerpo de findings (tests
  rojos a propósito). Los fixes van en branches separadas, con autorización.
```
