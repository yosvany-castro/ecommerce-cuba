# Auditoría destructiva del programa de validación F6
**Fecha:** 2026-06-09 · **Dataset auditado:** n=5000/seed=123 (el cargado en la DB) + mercados in-memory n=2000/5000/10000 · **Scripts reproducibles:** `scripts/_audit/`

---

## 0. Veredicto ejecutivo

> **El resultado insignia de F6 — "el pipeline le gana a un e-commerce normal y su ventaja crece con el catálogo" — no sobrevive a la auditoría.** La ventaja publicada de +74% en nDCG@10 (n=5000) se convierte en **−24% (estadísticamente significativo, p=0.0005)** cuando se eliminan las fugas de información de los modelos globales. La métrica de negocio (revenue@10) es autorreferencial y la maximiza un ranker cínico que ignora al usuario. El mundo sintético está construido — en un caso, admitido en un comentario del propio código — para que el pipeline gane.
>
> **Lo que se destruye es la EVIDENCIA, no necesariamente el sistema.** La arquitectura es correcta y la ingeniería del harness es excelente (mi réplica reprodujo sus números al tercer decimal). Pero hoy no existe ninguna prueba válida de que esta tienda venda más que una normal — y el camino para obtenerla está claro (§5).

Cadena de la demostración central (experimento D, mismo dataset, misma lógica de ranking de ellos):

| Variante | popular-cohort | f3-rrf (champion) | Ventaja del pipeline |
|---|---|---|---|
| **V0 — tal como se publicó** | 0.088 | 0.153 | **+73.8%** (CI95 [+56%, +94%]) |
| V1 — solo grafo NPMI sin sesiones de test | 0.088 | 0.053 | **−39.7%** |
| V2 — solo popularidad sin sesiones de test | 0.053 | 0.129 | +146% |
| V3 — solo prod2vec sin sesiones de test | 0.088 | 0.140 | +58.4% |
| V4 — solo contexto de serving pre-compra | 0.088 | 0.189 | +114.6% |
| **V5 — todo limpio (el número honesto)** | **0.053** | **0.040** | **−23.9%** (CI95 [−36%, −9%], p=0.0005) |

La comparación publicada era **fuga contra fuga**: la fuga del grafo NPMI inflaba al pipeline (+0.10 de nDCG) y la fuga de popularidad inflaba al baseline (+0.035). Ninguno de los dos números existe en un sistema desplegable.

---

## 1. Metodología del ataque

1. **Lectura completa** del generador (`src/thesis/data/`), el harness (`src/thesis/eval/`), los scripts F6 y los 10 reportes committeados.
2. **Hipótesis explícitas** (H1–H10, abajo), cada una con un experimento diseñado para falsarla.
3. **Réplica fiel antes de criticar** — gates de fidelidad que pasaron:
   - Mi reconstrucción del grafo NPMI = artefacto `co_occurrence_top` de la DB: **overlap 1.000** (500 productos muestreados).
   - Mi réplica del head-to-head V0 = reporte committeado seed123: PC **0.088/0.179** y f3-rrf **0.153/0.287** (reporte: 0.088/0.179, 0.154/0.287).
   - Reutilicé su propio código de ranking (`popularCohortRanker`, `buildCandidatePool`, `buildUserModes`, `detectGiftIntent`, métricas) — solo parametricé los **datos** de entrada.
4. Experimentos: A+B (estructura del generador, in-memory), C (fuga NPMI), D (head-to-head limpio vs shipped + bootstrap + rivales), E (fuga vs escala). Cero llamadas a APIs de pago.

---

## 2. Hallazgos

### S1-CRÍTICO · H3: Fuga transductiva en los tres modelos globales

El split por sesión protege el *historial del usuario*, pero **prod2vec (E1), el grafo NPMI y la popularidad se construyen sobre `thesis.events` completo — sesiones de test incluidas** (`train-prod2vec.ts:28-32`, `backfill-cooccurrence.ts` SQL sin filtro, `unified-cases.ts:336-344`). El modelo vio la cesta exacta que contiene la compra que debe predecir (las compras pesan 5 en el grafo). Además el anchor del source NPMI (`lastViewedId`) es un ítem de la propia sesión de test (79.5% de los casos; en 12.7% es *el propio ítem de test*).

**Números (exp-C, dataset real n=5000/seed123, 2801 casos):**
- Hit-rate del source NPMI (test ∈ top-50 del anchor): **64.3% shipped → 13.2%** con grafo solo-train → **16.2%** con serving honesto (anchor pre-compra + grafo solo-train). **~75% del poder aparente de NPMI es fuga.**
- Forense de aristas: el **69.4%** de las aristas (anchor→test) que producen hits **existen únicamente por sesiones de test**; otro 8.3% solo supera el umbral count≥3 gracias a ellas.
- **La fuga crece con la escala** (exp-E): cuota de fuga **63.7% (n=2000) → 80.4% (n=5000) → 87.9% (n=10000)**, mientras la señal legítima decae 25.4% → 12.2% → 7.2%. La curva publicada "NPMI importa más cuanto más grande el catálogo" es la curva de la fuga.

*Respuesta a la defensa esperable* ("en producción el grafo también vería las sesiones"): no — el grafo se recomputa **nightly** (`cron-npmi-recompute`); en el momento de servir, la sesión actual y su futuro **no pueden** estar en el grafo. El harness evaluó un sistema físicamente imposible de desplegar.

### S1-CRÍTICO · H4: La métrica de negocio es autorreferencial y gameable

`revenue@10` no es revenue realizado: es `Σ P̂(buy)·precio·margen` donde **la affinity de P̂ es el coseno del candidato a los mode-medoids del usuario** (`unified-cases.ts:556-567`, `outcome.ts`) — exactamente la señal que el propio pipeline maximiza. Además la logística asigna **P(buy)≈12% a un ítem de afinidad CERO**: enseñar productos caros irrelevantes "genera" revenue.

**Falsación (exp-D):** un ranker cínico `precio×margen desc` — cero personalización, nDCG@10 = **0.002** — obtiene revenue@10 = **77,782**: un **30% más que f4-revenue** (59,955, el "campeón de revenue" del reporte) y **4.3×** popular-cohort. **Todos los titulares de revenue (+162%…+537%, el "+5×" del resumen ejecutivo, y el W7 adversarial "extrae más revenue en todos los perfiles") quedan invalidados** — los gana un ranker de escaparate de lujo aleatorio.

### S1-CRÍTICO · H1+H2: El mundo sintético está construido para que el pipeline gane

1. **Popularidad plana — el baseline está condenado por diseño** (exp-A): compras por ítem con Gini 0.41 y top-10% de ítems = 26% de ventas (el retail real es Zipf, ~80/20). No existe atractivo intrínseco por producto; la "popularidad" es ruido casi uniforme (por eso `popular-global` puntúa 0.005, cuando en una tienda real es un baseline respetable). El decay de popular-cohort con la escala es **aritmética pura**: su ventana top-40 cubre 74% de la subcategoría mediana a n=2000, 29% a n=5000, 15% a n=10000 (P(ítem-test ≤ 40 en su subcategoría): 90.6% → 51.6% → 29.8%). **La "dilución del rival con el catálogo" la fabrica el generador**, no la descubre el experimento.
2. **Los complementos se siembran para que NPMI los recupere** — el comentario de `behavior-model.ts:139-146` lo dice textualmente: *"Seeding GT complements into the same session makes anchor↔complement genuinely co-occur, so NPMI recovers the GT complement graph — **the thesis's central claim**"*. Eso es construir el dataset para que la tesis sea cierta.
3. **…y aun así la historia causal del resumen ejecutivo es falsa** (exp-B): solo el **~3%** de las compras de test son complementos sembrados (66% in-taste, ~30% regalo). El "NPMI rescata ~1 de cada 3 compras (celular→funda que el texto no ve)" **no puede ser complementariedad**: es co-ocurrencia de mismo-gusto (redundante con el coseno) más la fuga de H3.
4. **p_gift ~ U[0, 0.6] → ~30% de sesiones son regalos** (838/2801 casos). En la realidad es 5-10%: el peso del segmento regalo en los promedios está inflado 3-6×.
5. **Sin elasticidad-precio**: P(cart)=0.4 y P(buy|cart)=0.5 constantes — empujar productos caros no cuesta conversión en este mundo. Justo la dimensión que el ranking "revenue-óptimo" explota.
6. **Usuarios-oráculo, cero loop**: cada sesión muestra al usuario el top de **su propia afinidad latente sobre el catálogo completo** — un buscador personal perfecto. El recomendador jamás influye en la exposición: no hay position bias, no hay feedback loop, no hay nada de lo que la visión del producto ("tienda que se retroalimenta") necesita medir.

### S2-GRAVE · H5: Los documentos citan números que no existen en los artefactos

El capítulo (`11-f6-validacion.md`) y el resumen ejecutivo citan **+13.0% (0.200 vs 0.177) a n=2000** y **+363% revenue**. El reporte committeado actual (`...n2000-seed42-full.json`, regenerado en `a2bec87` tras el fix de fidelidad gift) dice **+33.2% (0.236) y +339%**; y los revenue champions reales son +434…+537%. La tabla insignia "+13→+63→+71%" **mezcla harness pre-fix (n=2000) y post-fix (n=5000/10000)** — las filas no son comparables entre sí, y el pie del resumen ("cada cifra es trazable a reportes verificados") es falso para la primera fila.

### S2-GRAVE · H7: El sistema validado no es el sistema desplegado

- `feed.ts` de producción **incluye el LLM reranker**; los 10 reportes F6 tienen `llm_enabled: false` — **el componente más distintivo de la visión ("vendedor IA") no participó en ninguna cifra del head-to-head**.
- El "campeón" validado (`f3-rrf`) es el pool multi-fuente en orden RRF **pelado** — sin LTR, sin F4, sin LLM. El pipeline integrado real (`assembled-ltr-f4`) **pierde contra popular-cohort por −41.6%** a n=2000 (está en el JSON, no en el capítulo).
- Latencia "p99≈26ms": fuerza bruta O(N·d) en RAM a n=2000-10000, sin LLM y sin round-trips de DB. A escala de un revendedor real de Amazon/AliExpress (10⁵–10⁸ ítems) ese camino no existe; el de producción (pgvector + LLM con compuerta p99<1.5s) es otro sistema. El "corre en milisegundos" del resumen ejecutivo no describe el producto.

### S2-GRAVE · H6: El baseline tiene un oráculo (y aun así ambos lados estaban dopados)

`ctx.cohort = subcategoría del ÍTEM DE TEST` (`unified-cases.ts:611-614`): popular-cohort recibe la subcategoría de lo que el usuario va a comprar — información que ninguna home page tiene. Con cohorte realista (modal del train), PC cae de 0.088 a **0.032**. Es decir: la comparación publicada no es "vs un e-commerce normal" — es vs un e-commerce con bola de cristal *parcial*, dopado además con popularidad fugada (V2: 0.088→0.053 sin fuga). Ambos números del titular están construidos.

### S2-GRAVE · H9: Toda la maquinaria aprendida no aporta nada sobre el CF de 2003

Un **item-kNN por co-ocurrencia** (suma de NPMI a los ítems del train — el "customers who bought X also bought Y" de Amazon 2003, sin embeddings, sin modos, sin gift detector, sin RRF):
- Frame shipped: 0.095 — el 62% del f3-rrf (0.153) con una fracción mínima de la complejidad.
- **Frame limpio: item-kNN 0.040 = f3-rrf 0.040 — empate exacto.** Las fases F1 (prod2vec), F2 (PinnerSage multi-modo + gift), F3 (pool 4 fuentes + RRF) no superan, en el mundo sin fugas, a una matriz dispersa de co-ocurrencia.

(Conecta con el hallazgo honesto que ellos mismos reportaron: ningún reranker aprendido bate a RRF. El problema es que el paso anterior — el pool — tampoco bate a lo trivial cuando se le quita la fuga.)

### S3 · H8: Detector de regalos — inutilizable a prevalencia real

W8: con umbrales de producción, precision ≈ **0.38-0.41** (FPR≈0.31) con prevalencia sintética del 26%. A prevalencia realista (~8%), por Bayes: precision ≈ **13%** — **7 de cada 8 pivotes a "modo regalo" serían falsos** en la tienda real. Matiz a su favor: el pivote falso usa la media de la sesión (degradación benigna). Matiz en contra: el W7 "adversarial" son **4 perfiles** hechos a mano evaluados con la métrica circular de H4 — anécdota, no evidencia.

### S3 · H10: La estadística que faltaba

Ninguna cifra publicada lleva intervalo de confianza ("la robustez por semilla ES la prueba de varianza" — no: es varianza del *generador*, no del muestreo de casos). Mi bootstrap pareado (10k remuestras): V0 +73.8% CI95 [+56%, +94%] (sí, significativo — *dentro del mundo con fugas*); **V5 −23.9% CI95 [−36%, −9%], p(flip)=0.0005 — significativo EN CONTRA**. Y el titular de n=2000 (+13% o +33%) jamás se replicó con otras semillas (la robustez se midió solo a n=5000).

### S3 · H11: OPE muerto + producción sin exploración = la visión no es medible

- `ope.ts` (IPS/SNIPS/DR, correctamente implementados) **no lo importa nadie**: rigor decorativo.
- `feed.ts` **no tiene exploración** (cero epsilon/bandit/random en el sector). Consecuencias: los logs reales no tendrán propensities (OPE imposible), y el loop "recomiendo → el usuario interactúa → reentreno con eso" degenera (burbuja de filtro / atrincheramiento) sin que nadie pueda detectarlo, porque tampoco hay A/B (el piloto está diseñado y no ejecutado).

### S4 · Menores (lista corta)
- `testSession` se elige con un JOIN sin orden (si el ítem se vio en una sesión anterior, el detector de regalo puede correr sobre la sesión equivocada — no determinista entre re-cargas de DB).
- El source popular del pool usa la cohorte de `train[0]` — un elemento de orden **arbitrario** de Postgres (SELECT sin ORDER BY).
- `e1_universe`=4999≠5000 (1 producto sin vector por no aparecer en sesiones multi-ítem) — el sanity check de productos lo tolera en silencio.
- En 12.7% de los casos el anchor NPMI es el propio ítem de test → el source NPMI no puede acertar por construcción (y lo enmascara el promedio).
- El "resultado emergente a escala" del LTR-revenue (W5) hereda todas las fugas (features npmi/popularidad/E1) — no es interpretable hasta repetirlo limpio.

---

## 3. Qué sobrevive (y es valioso)

1. **La arquitectura es la correcta para 2026**: multi-vector PinnerSage, dos espacios (semántico + co-ocurrencia), RRF, filtros en vez de pesos negativos, prior por cohorte, multi-objetivo explícito. El feedback externo (`feedback_comphrensive.md`) está implementado de verdad, no maquillado.
2. **La ingeniería del harness es de primera**: determinismo absoluto (pude replicar sus números al tercer decimal y su grafo NPMI con overlap 1.000 — eso casi nunca pasa en evaluaciones de ML), casos unificados, ablations, reportes versionados. Esa infraestructura es justamente lo que permitió ESTA auditoría.
3. **Cultura de honestidad parcial real**: reportaron negativos (LLM no gana, LTR no gana, detector débil, "datos sintéticos" como límite). Los fallos no son de mala fe — son los dos errores clásicos: split per-user que no protege a los modelos globales, y métricas que comparten señal con el ranker.
4. **176/176 tests unitarios pasan**; el código es legible y está documentado con intención.
5. **Matiz importante a favor**: el colapso del mundo limpio castiga sobre todo al embedding *conductual* (prod2vec se queda sin las sesiones de test). El retrieval por **texto** (E0/Voyage, e2_hybrid) no tiene fuga de sesiones y no fue el campeón evaluado — es plausible que un pipeline texto+co-ocurrencia limpio sí muestre ventaja real. **No está demostrado que el sistema sea malo; está demostrado que aún no hay evidencia de que sea bueno.**

---

## 4. Hipótesis → experimento → veredicto (mapa)

| # | Hipótesis | Experimento | Veredicto |
|---|---|---|---|
| H1 | La popularidad plana condena al baseline por diseño | exp-A (Gini, cobertura ventana-40) | **Confirmada** |
| H2 | El "28-37% NPMI" es eco del dial de siembra | exp-B (composición: solo 3% complementos) | **Confirmada** (mecanismo distinto al narrado: es fuga + mismo-gusto) |
| H3 | Fuga transductiva en modelos globales | exp-C/D/E | **Confirmada y cuantificada** (64→13/16%; +74→−24%; fuga 64→88% con escala) |
| H4 | revenue@10 es circular y gameable | código + ranker cínico | **Confirmada** (0.002 nDCG gana la métrica de negocio) |
| H5 | Documentos ≠ artefactos | git + JSONs | **Confirmada** (+13% y +363% no existen) |
| H6 | Baseline con oráculo | PC realista | **Confirmada** (0.088 → 0.032) |
| H7 | Sistema validado ≠ desplegado (LLM, latencia) | reportes + feed.ts | **Confirmada** |
| H8 | Gift detector inviable a prevalencia real | W8 + Bayes | **Confirmada** (~13% precision) |
| H9 | La maquinaria no supera al CF 2003 | item-kNN | **Confirmada** (empate exacto en limpio) |
| H10 | Sin significancia calculada | bootstrap propio | **Confirmada** (y V5 significativo en contra) |
| H11 | El loop de la visión no es medible hoy | ope.ts + feed.ts | **Confirmada** (OPE muerto, sin exploración) |

---

## 5. Plan de reparación (en orden)

**Fase 1 — Higiene de la evaluación (1-2 días, sin tocar el producto):**
1. Construir co-ocurrencia, prod2vec y popularidad **solo con eventos de train** (excluir las sesiones de test globalmente). Anchor y contexto gift = **prefijo pre-compra** de la sesión.
2. Baselines obligatorios: popular-cohort **sin oráculo**, item-kNN co-ocurrencia, y un ALS/BPR sencillo. El pipeline solo "gana" si los bate a todos.
3. Bootstrap pareado + CI95 en TODA tabla; replicar n=2000 con 3 semillas.
4. Re-correr W1-W3 y aceptar los números que salgan. (Predicción honesta según esta auditoría: la ventaja será pequeña o nula con E1 conductual; probar el campeón texto+co-ocurrencia.)

**Fase 2 — Un simulador que pueda decir "no" (3-5 días):**
5. Popularidad Zipf (atractivo intrínseco por ítem), elasticidad-precio en P(buy|view), p_gift 5-10%, complementos con tasa realista, y **exposición mediada por el recomendador** (position bias + loop cerrado). Sin esto, cualquier éxito futuro seguirá siendo sospechoso.
6. Métrica de negocio **realizada** (precio×margen de la compra simulada capturada en top-k), nunca E[rev] con la señal del ranker. 

**Fase 3 — Coherencia y producto:**
7. Regenerar TODA la cadena documental desde una sola versión del harness; check automático de que cada cifra citada exista en un JSON committeado.
8. Decidir el papel del LLM: o entra al head-to-head (con coste y latencia medidos) o sale del feed. Hoy pagas su coste sin evidencia de su lift.
9. Añadir exploración (ε-greedy o Thompson en la mezcla) + loggear propensities → activar `ope.ts` sobre logs reales → **ejecutar el piloto A/B ya diseñado**. Para la visión de "tienda que se retroalimenta y vende sola", esta es la única validación que cuenta; todo lo offline es preludio.
10. La visión "vendedor IA" (upsell/cross-sell como acciones, página adaptativa) hoy no tiene NINGÚN experimento — ni siquiera sintético. Tratarla como roadmap por validar, no como capacidad demostrada.

---

## 6. Reproducibilidad

```
scripts/_audit/
├── exp-ab-generator-audit.ts   # estructura del generador (A+B), in-memory, sin DB
├── dump.ts                     # dump read-only de la DB → data/*.json
├── lib.ts                      # réplica fiel del loader con knobs de fuga parametrizados
├── exp-c-npmi-leak.ts          # fuga NPMI (gate overlap 1.000)
├── exp-d-clean-vs-shipped.ts   # head-to-head V0..V5 + bootstrap + rivales (gate vs reporte ✓)
├── exp-e-npmi-scale.ts         # cuota de fuga vs escala (63.7→80.4→87.9%)
└── exp-d-results.txt           # salida íntegra del exp-D
```
Todo es determinista (seeds fijas), solo lecturas de DB, cero llamadas a APIs de pago.
