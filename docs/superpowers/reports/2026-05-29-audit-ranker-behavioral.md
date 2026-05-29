# Audit conductual — Pipeline de ranking / personalización (manual, como usuario)

**Fecha:** 2026-05-29
**Branch:** `audit/ranker-pipeline-2026-05-29`
**Método:** exploración manual, conduciendo el sistema real (test_schema) como un
experto en recsys: catálogo realista de 42 productos (embeddings Voyage reales),
eventos reales (`insertEvent` + `processEventForPersonalization`), feed real
(`generateFeed`, reranker DeepSeek), búsqueda real (BM25 / cosine / normalizer).
Scripts reproducibles en `scripts/audit-explore/` (`00-seed` → `05-search`).
**Costo:** ~$0.05 (embeddings Voyage + ~25 llamadas DeepSeek de rerank/normalize;
**0 llamadas al mock aggregator** — evitadas a propósito).

Este reporte COMPLEMENTA el de código (`2026-05-29-audit-ranker.md`): aquí está
lo que el sistema **hace** ante interacciones reales, no lo que dice el código.

---

## 0. Veredicto

El núcleo de personalización **funciona, y bastante bien**. La mayoría de las
ideas correctas de recsys moderno (multi-vector, co-ocurrencia, MMR, reranker
contextual, cohortes, decay sesión/perfil) están **implementadas y se comportan
como deben** en escenarios reales. Los problemas no son de "no funciona" sino de
**adaptación entre contextos** (cambio de cohort, regalos, búsqueda no
personalizada) y de un par de fugas de señal.

---

## 1. Lo que funciona bien (verificado conduciendo el sistema)

| # | Capacidad | Evidencia |
|---|---|---|
| W1 | **Formación de perfil mono-intención** | 5 vistas de lujo femenino → cohort `femenino_adulta` (warmup=3), feed 10/10 lujo femenino, razones concretas ("Combina con tu estilo elegante reciente"). exp1 |
| W2 | **Shift de intención en sesión** | perfil men-tech → ver vestidos: pivote **gradual** (1→3→flip a los 3 contradictorios), feed sigue el momento. exp2 |
| W3 | **Cross-sell por co-ocurrencia** | Laptop→{Mouse,Teclado} y Vestido→{Tacones,Cartera}: la co-ocurrencia surfacea **complementos** que el coseno hunde bajo **sustitutos** (Tablet/otro-vestido). Inyectado en el feed vía listB. exp3 |
| W4 | **Usuario multi-modo (k-means)** | 24 eventos femenino (ropa+joyería) → **2 modos bien separados** (modo#1 joyería 0.83, modo#2 ropa 0.79); el feed **mezcla ambos** (no es un "vector fantasma"). exp4 |
| W5 | **Embeddings semánticos** | iPhone→{funda 0.79, cargador 0.64, laptop 0.63}; vestido→{coctel 0.77, tacones 0.69}. Clústeres limpios. diag2 |
| W6 | **Búsqueda: BM25 + cosine + intent** | "Nike Air Zoom"→ exacto #1 (BM25); "algo elegante para una fiesta"→ vestidos (cosine, BM25 vacío); "regalo para mi abuelo"→ `intent=gift, masculino, 60-100`. exp5 |
| W7 | **Reranker contextual (DeepSeek)** | razones específicas y conscientes del contexto/cross-sell ("Carga rápida para tu nuevo iPhone", "Combinan con tus tacones"). |

> Nota sobre el hallazgo P1 de código (escala MMR rrf_score vs cosine): en feeds
> de **un solo clúster** NO se observó degradación (todos los candidatos eran del
> mismo clúster, así que el orden interno se mantuvo coherente). El defecto muerde
> en sets **cross-clúster** (cold start, popularidad mezclada) — consistente con
> el análisis de código.

---

## 2. Hallazgos conductuales (gaps / riesgos)

### B1 — [P2] Contaminación de modo durante la ventana de shift
**Qué vi (exp2):** un usuario men-tech (cohort `masculino_adulto`, modo tech)
empieza a ver vestidos. Las vistas #1 y #2 ocurren **mientras el cohort sigue
siendo masculino** (el flip recién pasa a la 3ª señal contradictoria). Esos 2
eventos de vestido **se acumulan en el modo TECH**: `masculino_adulto#1` pasó de
n=3 → 4 → 5 con embeddings de vestido.
**Por qué importa:** el vector "tech" del usuario queda contaminado con vestidos.
La próxima vez que esté en cohort masculino, su feed tech estará levemente sesgado
hacia moda femenina. Es el problema de "vector fantasma" a nivel de modo.
**Causa (código):** `track-hook.ts` actualiza el modo del **cohort actual** sin
verificar que la señal del evento coincida con ese cohort (la compuerta `if
(!newCohort)` sólo mira el cohort vigente, no si ESTE evento le pertenece).
**Fix sugerido:** no acumular al modo eventos cuya señal contradice el cohort
vigente (descartar o enrutar al cohort del propio evento).

### B2 — [P1] Cohort-switching duro: nunca se mezclan intereses de distinto cohort
**Qué vi (exp2):** tras el flip, el usuario tiene 2 modos —`masculino_adulto#1`
(n=5, su historial tech real) y `femenino_adulta#1` (n=1)— pero el feed usa **sólo
el bucket del cohort vigente**. El historial tech se **abandona** en cuanto entran
3 señales femeninas, y vuelve si entran 3 tech: ping-pong.
**Por qué importa:** toda la maquinaria multi-vector (que SÍ funciona, W4) está
**scopeada por cohort**. Un usuario real con intereses de distinto cohort (p.ej.
un hombre que compra su tech + regalos para su pareja/hijos) **nunca** recibe un
feed que combine ambos; sólo ve el último cohort activado. La "distribución del
usuario" (feedback Idea 1) se captura dentro de un cohort pero se pierde **entre**
cohortes.
**Fix sugerido:** permitir que el feed mezcle (RRF) los modos de los top-K cohorts
recientes del usuario, no sólo el cohort vigente de la sesión.

### B3 — [P2] Sin detección de regalo en navegación cross-género
**Qué vi (exp2):** durante todo el browse hombre→vestidos, `recipient` quedó en
`—` (null). El reranker trata los vestidos como **para el propio usuario** y, tras
el flip, le habla como mujer ("Justo lo que buscas ahora" para tacones). Nunca
infiere "esto podría ser un regalo".
**Por qué importa:** regalar es un caso de uso central de un reseller Cuba (se
compra para familia). La señal de regalo existe en la búsqueda (W6) pero no se
dispara navegando.
**Fix sugerido:** heurística de intent de regalo (browse cross-cohort sostenido →
marcar recipient / pedir confirmación en UI).

### B4 — [P1] La búsqueda no se personaliza, y descarta el intent de regalo
**Qué vi (exp5 + código `search.ts`):** `hybridSearch` recibe `anonymous_id/
user_id` pero **no los usa**: BM25+cosine puro. Un hombre-tech y una mujer-lujo
que buscan "reloj" obtienen resultados **idénticos**. Además el normalizador
extrae `recipient_gender/age/price` muy bien, pero la búsqueda sólo aplica
`normalized.filters` y **descarta `recipient_*`** (no filtra ni rankea por
destinatario).
**Por qué importa:** "adaptarse a búsquedas/intención" sólo aplica al **query**,
no al **usuario**. El intent de regalo detectado se pierde antes de rankear.
**Fix sugerido:** mezclar el vector de perfil en el cosine (β query/perfil, como
en el plan original) y propagar `recipient_*` a filtros/ranking.

### B5 — [P2] El prior de cold-start no es neutral (sesgo al clúster más denso)
**Qué vi (exp1):** usuario nuevo (0 eventos) → feed 7 tech / 3 lujo, #1 iPhone.
El "centroide global" del catálogo apunta al clúster más denso (tech, mi clúster
más grande), así que arranca sesgado. Además el reranker **inventa atributos** sin
datos: "Ideal para regalar a un joven conectado" con 0 señales.
**Por qué importa:** el primer feed (momento crítico de retención) está sesgado por
la composición del catálogo, no por neutralidad/diversidad; y las razones afirman
cosas no fundamentadas.
**Fix sugerido:** cold-start = popularidad global diversificada (no centroide); el
prompt del reranker no debería afirmar perfil cuando no hay señal.

---

## 3. Reconciliación con el reporte de código

- El **fallback silencioso** y la **cache ciega al contexto** (P1 de código) no se
  estresaron aquí (DeepSeek respondió siempre); siguen vigentes como riesgo de
  observabilidad/staleness.
- El **cap en 10 / `limit` ignorado** (P2) se confirma: todos los feeds
  personalizados volvieron 10 ítems aun pidiendo más internamente.
- La **no invalidación por compra** (P2): en exp1 el ítem comprado **no** reapareció
  (el reranker no lo retuvo ese turno) — el riesgo real es vía **cache hit** con
  top-30 sin cambios, no garantía de reaparición.

---

## 4. Prioridad sugerida (combinada con el reporte de código)

1. **B2** (cohort-switching duro, no mezcla cross-cohort) — limita la personalización real.
2. **B4** (búsqueda sin personalización + intent de regalo descartado).
3. **B1/B3/B5** (contaminación de modo, regalo, sesgo cold-start) en paralelo con F4.
4. Code P1: escala MMR, cache contextual, timeout LLM (ver reporte de código).

## 5. Reproducir
```
npx tsx scripts/audit-explore/00-seed.ts          # reset + catálogo + ambient + centroides
npx tsx scripts/audit-explore/01-women-luxury.ts  # cold start + perfil mono-intención
npx tsx scripts/audit-explore/02-intent-shift.ts  # shift de intención en sesión
npx tsx scripts/audit-explore/03-crosssell.ts     # co-ocurrencia vs coseno
npx tsx scripts/audit-explore/04-multimodal.ts    # k-means multi-modo
npx tsx scripts/audit-explore/05-search.ts        # BM25 / cosine / intent (sin mock)
```
