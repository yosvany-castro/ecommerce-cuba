# Cómo lograr que funcione de verdad
**Fecha:** 2026-06-09 · **Continuación de:** `auditoria-destructiva-f6-2026-06-09.md` · **Base:** investigación bibliográfica + experimentos limpios (`scripts/_audit/exp-f`, `exp-g`) + implementación (simulador v2, artefactos `--train-only`, loader `--clean`)

---

## 1. Lo que la evidencia limpia dice sobre dónde está el valor real

Con TODOS los componentes sin fuga (grafo NPMI train-only, prod2vec train-only, popularidad train-only, contexto pre-compra), sobre el dataset n=5000/seed=123 (exp-F, 1200 casos):

| Ranker (sin fuga) | nDCG@10 | Lectura |
|---|---|---|
| pc-oracle (popularidad en la categoría del ítem comprado) | 0.052 | techo "navegacional": el usuario ya en la categoría correcta |
| **conducta multi-modo (prod2vec limpio + PinnerSage)** | **0.046** | empata estadísticamente con el oráculo (CI95 [−34%, +15%]) |
| fusión v2 (conducta+kNN+popular+NPMI prefijo, RRF) | 0.041 | |
| item-kNN co-ocurrencia | 0.040 | |
| **pc-real (lo que una tienda normal puede hacer de verdad)** | **0.013** | el baseline honesto |
| texto E0 (mean / centrado / multi-modo) | 0.011–0.013 | **fracasa**: ≈ pc-real |

**Conclusiones que cambian el diseño:**

1. **La afirmación defendible existe y es fuerte: la personalización conductual limpia rinde ~3.5× el baseline realista** (0.046 vs 0.013). No es el "+74%" fantasma de F6 — es mejor argumento, porque sobrevive a la auditoría.
2. **La señal robusta es CONDUCTUAL (co-sesión), no textual.** El texto templado no separa lo que importa; y medí su anisotropía: coseno medio entre pares aleatorios E0 = **0.613** (centrado: 0.010). Todo umbral fijo sobre coseno crudo (p.ej. el caché semántico θ=0.92) está descalibrado: el "suelo" no es 0, es 0.61. *(Para texto real de Amazon/AliExpress —no templado— el texto puede mejorar, pero hay que medirlo, no asumirlo.)*
3. **La navegación es un rival serio**: nadie batió al oráculo de categoría. Implicación de producto: el feed personalizado compite contra "el usuario hace click en la categoría"; el valor incremental del feed hay que medirlo contra ese flujo, y la página de categoría en sí debe ordenarse con la misma personalización (ahí el "oráculo" es legítimo: la categoría la eligió el usuario).
4. **Historiales finos = régimen cold-start crónico**: ~2.8 compras de train por usuario. El prior por cohorte con shrinkage bayesiano (feedback del mentor, Fix 5) no es opcional: es la pieza que decide la primera impresión.

## 1b. El descubrimiento del mundo v2 (2026-06-10): el pipeline es ciego a la popularidad

Al re-correr la tabla de escala sobre el **simulador v2 calibrado** (Zipf, elasticidad, gift 8%, elección estocástica; exp-H y exp-I, sin fugas), el resultado invierte el mundo v1:

| Ranker (v2, η=0.3, n=5000, 800 casos) | nDCG@10 | hit@10 |
|---|---|---|
| pc-oracle (navegación: categoría del ítem comprado) | 0.122 | 0.217 |
| **pc-views-multi** (top-3 subcats VISTAS × popularidad, cuotas) | **0.016** | 0.033 |
| pc-views (subcat modal vista × popularidad) | 0.014 | 0.028 |
| **e1-views-pop** (coseno a modos × log-popularidad) | **0.011** | 0.019 |
| pop-global | 0.011 | 0.025 |
| pc-real (baseline ingenuo) | 0.007 | 0.014 |
| e1-views (coseno puro, historial de vistas) | 0.003 | 0.005 |
| **e1-modes (el pipeline actual)** | **0.000** | 0.001 |
| knn (NPMI) | 0.001 | 0.003 |

**Por qué colapsa el pipeline actual en un mundo realista** (mecanismos conocidos de la literatura, no bugs):
1. El coseno-a-modos es **ciego a la popularidad**: en skip-gram los ítems ultra-frecuentes derivan hacia el centroide del espacio → el retrieval personal los rankea BAJO, justo cuando son lo que la gente compra.
2. El **NPMI descuenta la popularidad por construcción** (es la definición de PMI) — excelente para complementos de nicho, fatal como fuente principal en mundo Zipf.
3. Los modos del harness se construían con ~2.8 **compras** de train (en v2, ~70% best-sellers fuera del gusto) — el historial de **vistas** (~25-30 ítems) es el correcto y es lo que producción ya usa (`track-hook`).
4. El pipeline entero fue diseñado —sin saberlo— para el mundo v1 de popularidad plana, donde estos tres defectos no se manifiestan (y las fugas los premiaban).

**Fixes con evidencia** (exp-I): añadir un **prior multiplicativo de popularidad** al score de retrieval (`coseno × log(2+pop)`) revive el camino vectorial **×11** (0.001→0.011); la mejor forma realista del feed frío es **"predecir categorías desde las vistas → popularidad dentro de ellas con cuotas"** (pc-views-multi, ×2.3 sobre pc-real). La lección de producto: el home feed compite contra la navegación (pc-oracle 0.122 inalcanzable sin intención declarada) — el lugar natural de la personalización fina es la página de categoría (donde la "cohorte oráculo" es legítima: la eligió el usuario) y el cross-sell en PDP/carrito.

**Tensión de calibración documentada**: con utilidad multiplicativa `att^η`, clavar 72/28 en concentración de ventas (η≈0.7) empuja las compras in-taste a ~30% (lo empírico es 40-60%). η=0.3 deja 55%/20 de concentración e in-taste 32%. La salida de fondo es popularidad **endógena** (emergente de la exposición del recomendador en el loop cerrado, estilo RecSim) en vez de atractivo intrínseco puro — roadmap #6.

## 1c. Loop de aprendizaje en producción — implementado (roadmap #7)

- `src/sectors/d-personalization/explore/epsilon.ts`: exploración ε-greedy por slot con **propensities exactas** (exploit: 1−ε; explore: ε/|pool en el draw|), pool = candidatos recuperados-no-servidos (nunca muestra disparates). Puro, testeado (6 tests).
- Migración `0023_feed_impressions.sql`: log de impresiones por slot (request, posición, producto, source, propensity) en public + test_schema. **Aplicada.**
- `feed.ts`: ambos caminos de salida sirven con exploración y loggean impresiones (fire-and-forget; un fallo de logging jamás rompe el feed). `EXPLORATION_EPSILON` (default 0.1; 0 = off).
- Esto desbloquea `ope.ts` (IPS/SNIPS/DR) sobre logs reales: `loggingProp` = columna `propensity`, y da la materia prima del píloto A/B.

## 2. Fundamentos (literatura) y cómo los aplicamos

| Problema | Fundamento | Aplicación aquí |
|---|---|---|
| Fugas en eval offline | Ji et al., *A Critical Study on Data Leakage in RecSys Offline Evaluation* (TOIS 2023): respetar la **línea temporal global**; los modelos globales no pueden ver datos posteriores al punto de predicción | `--train-only` en `backfill-cooccurrence` y `train-prod2vec`; `--clean` en el loader/harness (popularidad train-only + contexto pre-compra). **Implementado.** |
| Demanda irreal (plana) | Brynjolfsson, Hu & Simester (Mgmt Sci 2011): canal online ≈ **72/28** | Simulador v2: atractivo intrínseco Zipf. Calibrado: **s=1.0, η=0.7 → top-20%=70%, Gini 0.71** (v1: 44%, 0.41). **Implementado.** |
| Conversión sin precio | Click-based MNL / cascade browse (Mgmt Sci): el precio entra en la utilidad de elección | v2 `priceGamma`: P(cart/buy) × exp(−γ·sens·banda/3); compras de banda alta 41%→28%. **Implementado.** |
| Elección determinista (oráculo) | RecSim / RecSim NG (Google), survey de simuladores 2206.11338: usuario = modelo de elección sobre una **exposición**, no un argmax sobre el catálogo | v2 `stochasticChoice`: muestreo Plackett–Luce ∝ score. **Implementado.** Falta el paso final: exposición mediada por el recomendador (slate + cascada) — §4.3. |
| Coseno engañoso | Anisotropía/hubness; whitening soft-ZCA, mean-centering | Medido (0.613→0.010). Para el caché semántico: calibrar θ por FPR sobre la distribución empírica de pares (Fix 3 del mentor), no decretar 0.92. Para retrieval de texto real: centrar + (si hace falta) whitening. |
| Loop degenerado | Jiang et al., *Degenerate Feedback Loops in RecSys* (AIES 2019); mitigación: exploración UCB/Thompson + corrección por propensities | `feed.ts` hoy NO tiene exploración y los logs no tienen propensities → añadir ε/Thompson a la mezcla y loggear p(slot) → desbloquea `ope.ts` (IPS/SNIPS/DR, ya implementado y hoy muerto). |
| Representación de usuario | PinnerSage (KDD'20) multi-vector; Item2Vec (2016); two-tower con corrección de sesgo de muestreo (Yi et al., RecSys'19) | Ya implementado (modos + prod2vec). El upgrade v2 del embedding conductual: two-tower entrenado con in-batch negatives corregidos, cuando haya datos reales. |

## 3. Arquitectura objetivo (qué mantener, qué cambiar)

**Mantener (validado o estructuralmente correcto):**
- Pool multi-fuente + **RRF** (ganador honesto en relevancia; ningún reranker aprendido lo bate).
- **Multi-modo conductual** (PinnerSage sobre prod2vec): el mejor ranker limpio.
- Grafo NPMI **nightly** para cross-sell en PDP/carrito ("frequently bought together") — su rol real; en el feed del home su aporte limpio es menor de lo que F6 decía.
- Filtros (no pesos negativos), prior por cohorte, MMR.

**Cambiar:**
1. **Métrica de negocio**: revenue *realizado* (la compra simulada/real capturada en el top-k × precio × margen), nunca E[rev] del modelo del ranker. El f4-revenue actual optimiza un espejismo (el ranker cínico precio×margen lo bate con nDCG 0.002).
2. **LLM reranker**: hoy está en producción sin evidencia (excluido de F6) y con coste real por sesión. Decisión basada en datos: entra al head-to-head limpio (con su coste y latencia) o sale del feed. Su lugar más prometedor no es reordenar el top-30, sino los **casos especiales** (regalo explícito, búsqueda conversacional, upsell argumentado) donde el contexto textual importa.
3. **Detector de regalo**: a prevalencia real (~8%), precisión ≈13%. Subir el umbral de disparo (coherencia ≥0.7 + mínimo de ítems mayor), tratarlo como *modo sugerido* (UI: "¿es un regalo?") en vez de pivote silencioso, y medirlo como acción con confirmación del usuario — eso genera etiquetas reales.
4. **Caché semántico**: recalibrar θ con la distribución empírica (anisotropía 0.61 medida) y FPR objetivo ≤0.1% (Fix 3 del mentor, ahora con número propio).

## 4. El plan de validación que puede decir "NO" (y por eso vale)

1. **Re-correr F6 limpio** — **HECHO**: reporte oficial `...n5000-seed123-full-clean.{md,json}` generado por el propio harness con artefactos `--train-only`. Resultado (n=2800):
   - `f3-rrf` 0.041 vs `popular-cohort` (oráculo) 0.053 → **−21.2%**: el harness mismo imprime *"even the relevance-optimal pipeline config does NOT beat popular-cohort"*. Coincide con la predicción de la auditoría (réplica: 0.040 vs 0.053).
   - `f3-rrf` 0.041 vs **`popular-cohort-real` 0.016** → **+156% (×2.6)**: la afirmación honesta y defendible del proyecto contra una tienda normal SIN bola de cristal.
   - `e2_hybrid` empata como campeón limpio (0.041); el segmento regalo colapsa a ~0.005 para todos los métodos personalizados (la maquinaria de regalo no aporta valor medible en mundo limpio).
   - Criterio de éxito futuro: **batir a pc-real Y a item-kNN con CI95 que excluya 0**, no "batir a un baseline dopado".
2. **Repetir sobre el simulador v2** (Zipf+elasticidad+gift 8%+PL): regenerar datasets con `--zipf-s 1.0 --zipf-eta 0.7 --price-gamma 0.8 --p-gift-max 0.16 --stochastic` y re-medir. En el mundo v2, popular-cohort tiene señal REAL (best-sellers existen) — si la personalización sigue ganando ahí, el argumento es sólido.
3. **Cerrar el loop en simulación** (siguiente pieza del simulador): exposición mediada por el recomendador (slate de k posiciones + cascada con prob. de continuación) → permite medir (a) lift de un ranker *sirviendo de verdad*, (b) dinámica del loop (¿se degenera sin exploración?), (c) OPE contra el log simulado con propensities conocidas — validar IPS/SNIPS/DR antes de usarlos con datos reales.
4. **Producción**: exploración ε/Thompson en la mezcla + log de propensities + métricas por sesión (CTR, CVR, revenue/sesión) → **ejecutar el piloto A/B ya diseñado**. Es la única prueba que el negocio puede llevar al banco.

## 5. Roadmap priorizado

| # | Qué | Estado |
|---|---|---|
| 1 | Artefactos `--train-only` + loader/harness `--clean` + baseline `popular-cohort-real` | **Hecho** (este turno) |
| 2 | Simulador v2: Zipf calibrado 72/28, elasticidad-precio, gift 8%, elección estocástica PL | **Hecho** (knobs con defaults v1 bit-idénticos; 16 tests) |
| 3 | Reporte F6-clean oficial (n=5000/seed123) | **En curso** |
| 4 | Regenerar D0–D4 con v2 y re-correr W1–W3 limpio (la tabla de escala honesta) | Pendiente — 1 día de cómputo |
| 5 | Revenue realizado como métrica de negocio (requiere #6 para la versión completa) | Pendiente |
| 6 | Exposición mediada por recomendador + cascada en el simulador (cierra el loop) | Pendiente — 2-3 días |
| 7 | Exploración + propensities en `feed.ts`; activar `ope.ts` sobre logs | Pendiente — 2 días |
| 8 | Recalibrar caché semántico (θ por FPR con anisotropía medida) | Pendiente — ½ día |
| 9 | Decisión LLM (head-to-head limpio con coste) y gift como acción confirmable | Pendiente |
| 10 | Piloto A/B real | El veredicto final |

## 6. Reproducción

```bash
# evaluación sin fuga (artefactos + harness):
pnpm thesis:backfill-cooccurrence --train-only
pnpm thesis:train-prod2vec --train-only        # ⚠ sobrescribe item_vectors e1
pnpm thesis:f6-headtohead --n 5000 --seed 123 --clean

# simulador v2 calibrado (datasets nuevos):
pnpm thesis:behavior --users 2000 --days 90 --seed 42 \
  --zipf-s 1.0 --zipf-eta 0.7 --price-gamma 0.8 --p-gift-max 0.16 --stochastic

# experimentos de esta fase:
npx tsx scripts/_audit/exp-f-clean-champion.ts   # campeón limpio + anisotropía
npx tsx scripts/_audit/exp-g-calibrate-v2.ts     # calibración Zipf/elasticidad
```

### Fuentes principales
- Ji, Sun, Zhang, Li — *A Critical Study on Data Leakage in Recommender System Offline Evaluation*, [TOIS 2023](https://dl.acm.org/doi/10.1145/3569930) / [arXiv:2010.11060](https://arxiv.org/abs/2010.11060)
- Brynjolfsson, Hu, Simester — *Goodbye Pareto Principle, Hello Long Tail*, [Management Science 2011](https://pubsonline.informs.org/doi/10.1287/mnsc.1110.1371)
- Ie et al. — *RecSim: A Configurable Simulation Platform for RecSys*, [arXiv:1909.04847](https://arxiv.org/abs/1909.04847); RecSim NG [arXiv:2103.08057](https://arxiv.org/pdf/2103.08057); survey de simuladores [arXiv:2206.11338](https://arxiv.org/pdf/2206.11338)
- Jiang et al. — *Degenerate Feedback Loops in Recommender Systems*, [AIES 2019](https://www.aies-conference.com/2019/wp-content/papers/main/AIES-19_paper_187.pdf)
- *Mitigating Exposure Bias in Recommender Systems* — [ACM TORS 2024](https://dl.acm.org/doi/10.1145/3641291)
- Click-based MNL / cascade: [The Click-Based MNL Model (Mgmt Sci)](https://pubsonline.informs.org/doi/10.1287/mnsc.2021.00281), [pricing+ranking bajo cascade](https://dl.acm.org/doi/abs/10.1287/mnsc.2021.4246)
- Anisotropía/isotropía y whitening: [Semantics at an Angle (arXiv:2504.16318)](https://arxiv.org/html/2504.16318v2), [Soft-ZCA Whitening (arXiv:2411.17538)](https://arxiv.org/pdf/2411.17538)
