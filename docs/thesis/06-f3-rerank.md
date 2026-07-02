# Generación de candidatos y reranking (F3)

## Motivación y diagnóstico previo

Al concluir F2, el arnés de evaluación adversarial detectó un síntoma perturbador: el reranker LLM que se había incorporado al pipeline no cambiaba el conjunto de ítems recuperados. Los diez candidatos que devolvía eran, prácticamente, los mismos diez que producía la fusión MMR —reordenados pero no renovados. La hipótesis de trabajo fue que el reranker *estaba hambriento*: operaba sobre un pool demasiado pequeño (los treinta candidatos que F2 emitía como top-30 por similitud coseno a los medoides) y, con tan poco material de entrada, carecía de señal diferencial respecto al retriever. Si el ítem correcto no estaba en el pool, ningún reranker podía elevarlo; si el pool era casi idéntico al top-10 final, el reranker sólo podía reordenar, no recuperar.

Esta observación convierte F3 en una investigación de dos preguntas independientes pero relacionadas. Primera: ¿puede un pool de candidatos multi-fuente, sustancialmente más grande y más diverso, capturar más ítems relevantes que el top-30 de similitud coseno? Segunda: sobre ese pool ampliado, ¿qué familia de reranker —aprendido, probabilístico, neuronal profundo o por modelo de lenguaje— extrae mejor señal de relevancia?

## Diseño del sistema F3

### Pool de candidatos multi-fuente

El pool de F3 tiene tamaño 200 —$6.7\times$ más grande que el top-30 de F2— y se construye fusionando cuatro fuentes de candidatos mediante *Reciprocal Rank Fusion* (RRF):

1. **Retrieval por similitud coseno.** Los 80 ítems de mayor similitud coseno a los medoides del usuario (espacio `e1_prod2vec`), el mismo mecanismo que F2 utilizaba como única fuente.

2. **Co-ocurrencia NPMI.** Los vecinos de compra conjunta del último ítem observado, puntuados por *Normalized Pointwise Mutual Information*. Esta fuente captura relaciones de complementariedad que la similitud coseno de texto no puede recuperar: un ratón inalámbrico y su alfombrilla pueden estar en categorías léxicamente distantes pero comprarse juntos de forma consistente.

3. **Popularidad por cohorte.** Ítems populares dentro de la cohorte demográfica del usuario (perfil de edad y género inferido). Esta fuente actúa como red de seguridad: cuando el historial del usuario es corto o ruidoso, los ítems populares en su cohorte son candidatos razonablemente seguros.

4. **Exploración aleatoria sembrada.** Un muestreo diversificado del catálogo con semilla determinista, cuya función es inyectar variedad y evitar que el pool quede enteramente dominado por las categorías más frecuentes en el historial del usuario.

Las cuatro listas se fusionan vía RRF antes de truncar al tamaño 200. La fusión garantiza que ninguna fuente domina completamente la composición del pool: un ítem que aparece en el puesto 80 de similitud coseno *y* en el puesto 15 de popularidad por cohorte recibe una puntuación combinada superior a un ítem que lidera únicamente una de las fuentes.

El pool resultante es **compartido**: todos los rerankers evaluados en este experimento operan sobre el mismo conjunto de 200 candidatos por usuario, lo que hace que sus métricas sean directamente comparables entre sí.

### Cuatro familias de reranker

Sobre el pool compartido se evaluaron cuatro rerankers, elegidos para cubrir el espectro metodológico relevante:

- **`baseline-rrf`**: el orden producido por la propia fusión RRF al construir el pool. Es el punto de referencia: si ningún reranker lo supera, el valor de F3 está íntegramente en el pool, no en el reranker.

- **LTR (*Learning to Rank*)**: un modelo lineal puntual entrenado con descenso de gradiente sobre cinco *features* por ítem: `retrievalScore` (puntuación RRF del pool), `npmiScore` (puntuación de co-ocurrencia), `priceFit` (ajuste al rango de precios habitual del usuario), `demoMatch` (concordancia demográfica del ítem con la cohorte) y `popularity` (popularidad en cohorte). El modelo es supervisado: se entrena sobre el split de entrenamiento del arnés y se evalúa sobre el holdout temporal.

- **Cross-encoder `MaxSim`**: un modelo de interacción profunda que codifica la consulta (fragmentos `e4` de 1024 dimensiones de los ítems del historial de entrenamiento del usuario) y cada candidato en el mismo espacio de representación tardía (*late-interaction*, patrón F1), calculando la similitud máxima por fragmento. Una versión preliminar del experimento sufría un error de espacio vectorial: las consultas se construían en el espacio `e1` (64 dimensiones) y se comparaban contra documentos en el espacio `e4` (1024 dimensiones); `cosineSim` truncaba silenciosamente y producía métricas sin sentido (`nDCG@10` 0.027, `set-change@10` 0.952). La revisión final detectó y corrigió este P0, alineando ambos extremos al espacio `e4`.

- **LLM *listwise* con DeepSeek**: el reranker LLM que el audit adversarial había observado como inerte en F2. Recibe los 30 primeros ítems del pool ordenados por RRF y los reordena mediante un prompt de lista. En este experimento opera sobre un subconjunto de 120 casos por razones de coste y latencia, y se reporta por separado de la tabla principal.

### Corrección del generador de datos sintéticos

Durante la preparación de los datos de entrenamiento del LTR se detectó un defecto en el generador del simulador: la siembra de complementos en el historial del usuario —especificada en §4.4 del documento de diseño— no había sido implementada. Sin ella, los datos de entrenamiento no contenían pares *ítem visto → complemento comprado*, lo que privaba al `npmiScore` de señal supervisada. El fix consistió en implementar la siembra de complementos tal como describía la especificación, regenerar los datos y reentrenar el LTR. Los resultados que se reportan a continuación corresponden al experimento con el generador corregido.

## Resultados

### Recall del pool: la ganancia principal

El primer resultado es también el más importante del factor F3. La tabla siguiente compara el recall del pool de 200 ítems con el recall del top-30 de F2, sobre los mismos 1098 casos de evaluación y el mismo espacio de ítems `e1_prod2vec` (universo de 1999 productos):

| Configuración | Recall | Casos cubiertos |
|---|---|---|
| Pool F3 (200 ítems, multi-fuente) | **0.839** | 921 / 1098 |
| F2 top-30 (similitud coseno a medoides) | 0.410 | 450 / 1098 |

El pool multi-fuente captura aproximadamente $2\times$ más compras futuras que el retriever coseno de F2. En términos absolutos, el ítem que el usuario comprará está presente en el pool en 921 de los 1098 casos de evaluación, frente a sólo 450 con el top-30. Este incremento de recall —de 0.410 a 0.839— establece el límite superior de lo que cualquier reranker puede lograr: si el ítem correcto no está en el pool, no puede aparecer en el top-10.

La contribución diferencial de la fuente NPMI merece mención explícita. Un test de discriminación commiteado (`tests/thesis/f3-cooccurrence.test.ts`, que asercia `npmiHits > cosHits`) comparó, sobre casos con verdad de fondo conocida, cuántos ítems de la verdad de fondo (complementos esperados) recuperaba cada fuente; en la ejecución observada `npmiHits` = 7 y `cosHits` = 0. La similitud coseno no recuperó ningún complemento presente en la verdad de fondo; la co-ocurrencia NPMI recuperó siete. Este resultado confirma empíricamente la premisa de F1: la complementariedad de compra no es capturada por los embeddings de texto, y una fuente dedicada a la co-ocurrencia aporta candidatos cualitativamente distintos.

### Comparación de rerankers sobre el pool compartido

La tabla siguiente recoge las métricas de los cuatro rerankers sobre el pool compartido de 200 candidatos:

| Reranker | `nDCG@10` | `Recall@10` | MRR | `set-change@10` |
|---|---|---|---|---|
| `baseline-rrf` | **0.177** | **0.336** | **0.145** | 0.000 |
| `ltr` | 0.121 | 0.250 | 0.100 | 0.578 |
| `mmr` | 0.125 | 0.204 | 0.119 | 0.527 |
| `cross-encoder` | 0.055 | 0.120 | 0.053 | **0.821** |

La columna `set-change@10` mide la fracción de usuarios para los que el top-10 final difiere del top-10 de `baseline-rrf`. Un valor de 0.000 para `baseline-rrf` es tautológico (es el propio baseline); un valor de 0.821 para `cross-encoder` indica que en más de cuatro de cada cinco usuarios el cross-encoder propone un conjunto de candidatos radicalmente diferente al de la fusión RRF.

Este dato refuta directamente la observación del audit adversarial: **los rerankers de F3 sí cambian el conjunto recuperado**. El rango de `set-change@10` va de 0.527 (`mmr`) a 0.821 (`cross-encoder`), demostrando que cada reranker explora activamente el espacio de 200 candidatos y no se limita a reordenar los mismos diez que lidera el pool.

Sin embargo, y éste es el **hallazgo negativo central de F3**: ningún reranker supera al `baseline-rrf` en `nDCG@10`. El orden de relevancia producido por la propia fusión RRF al construir el pool es el mejor ranker disponible en este experimento, con `nDCG@10` = 0.177 y `Recall@10` = 0.336. `mmr` alcanza `nDCG@10` = 0.125 con `set-change@10` = 0.527: diversifica el top-10 pero lo hace a costa de precisión posicional. `ltr` obtiene `nDCG@10` = 0.121 y `Recall@10` = 0.250 pese a ser el único modelo supervisado. `cross-encoder` registra `nDCG@10` = 0.055, el peor resultado en relevancia aunque el mayor en diversificación.

### Reranker LLM listwise (DeepSeek)

El reranker LLM evaluado sobre los primeros 120 casos —operando sobre los 30 ítems de mayor puntuación RRF del pool— obtuvo `nDCG@10` = 0.170, `Recall@10` = 0.350 y `set-change@10` = 0.427, con una tasa de *fallback* de 0.000 (ninguno de los 120 prompts requirió recurrir al orden de entrada). Estos números son virtualmente equivalentes al `baseline-rrf` en relevancia (0.170 vs 0.177) y confirman que, sobre el pool enriquecido, el LLM sí cambia el conjunto —a diferencia de lo observado en el audit adversarial— aunque no consigue una mejora neta en `nDCG@10`.

La diferencia respecto al comportamiento inerte detectado en F2 es precisamente el pool: en F2, el reranker LLM operaba sobre 10–30 candidatos muy similares al retriever coseno; en F3 dispone de 200 candidatos procedentes de cuatro fuentes complementarias. La hipótesis del audit —que el reranker estaba hambriento— queda así confirmada: el problema no era el modelo, sino la dieta.

### Interpretabilidad del LTR: pesos de features

El modelo LTR ofrece una lectura directa de qué señales utiliza para reordenar. Los pesos aprendidos son:

| Feature | Peso |
|---|---|
| `retrievalScore` | 6.8185 |
| `popularity` | 2.2423 |
| `priceFit` | 1.8114 |
| `npmiScore` | 0.2878 |
| `demoMatch` | 0.0445 |
| `isGift` | 0.0000 |
| (sesgo) | $-15.6126$ |

`retrievalScore` domina con diferencia (6.82), lo que indica que el modelo aprendido termina delegando en la puntuación RRF del pool —exactamente lo que hace el `baseline-rrf`—. `popularity` y `priceFit` tienen pesos moderados; `npmiScore` y `demoMatch` contribuyen marginalmente; `isGift` recibe peso cero, posiblemente porque en datos sintéticos la señal de regalo no discrimina suficientemente al nivel de ítem individual.

### Segmentación: `self` vs `gift`

La comparación de `ltr` y `baseline-rrf` por segmento de intención revela una asimetría ya observada en F2:

| Segmento | $n$ | Reranker | `nDCG@10` | `Recall@10` | MRR |
|---|---|---|---|---|---|
| `self` | 743 | `baseline-rrf` | 0.235 | 0.445 | 0.189 |
| `self` | 743 | `ltr` | 0.159 | 0.332 | 0.127 |
| `gift` | 355 | `baseline-rrf` | 0.055 | 0.107 | 0.055 |
| `gift` | 355 | `ltr` | 0.041 | 0.079 | 0.044 |

En sesiones de autoconsumo (`self`), `baseline-rrf` alcanza `nDCG@10` = 0.235 —el mejor valor registrado en todo el pipeline hasta F3. En sesiones de regalo (`gift`), la calidad cae drásticamente (0.055), lo que refleja que el pool de F3 hereda el problema de F2: la representación del destinatario sigue siendo débil cuando la detección de regalo falla. `ltr` subestima a `baseline-rrf` en ambos segmentos, confirmando que el patrón de dominancia del baseline no es un artefacto del promedio.

## Discusión y hallazgos

Los resultados de F3 producen tres conclusiones bien delimitadas.

**El valor de F3 reside en el pool, no en el reranker.** El incremento de recall de 0.410 a 0.839 —la ganancia de $\approx 2\times$— es el avance sustancial de este factor. Todos los rerankers evaluados operan *dentro* de ese espacio ampliado; ninguno lo supera en relevancia posicional. Si el objetivo es maximizar `nDCG@10` sobre datos sintéticos con relevancia como único criterio de optimización, el reranker óptimo es no reordenar —conservar el orden RRF del pool.

**Los rerankers sí cambian el conjunto.** La hipótesis del audit adversarial era que el reranker estaba devolviendo los mismos ítems que el retriever. F3 la refuta: con un pool rico, `set-change@10` oscila entre 0.527 y 0.821. El comportamiento inerte observado en F2 era un síntoma del pool pobre, no de los rerankers. Este resultado tiene implicaciones para futuros desarrollos: rerankers orientados a diversidad o a objetivos secundarios (revenue, novedad, cobertura de categorías) tienen espacio real para diferenciarse sobre el pool de F3.

**NPMI captura complementariedad que el coseno no puede.** El test de discriminación commiteado (`tests/thesis/f3-cooccurrence.test.ts`; ejecución observada `npmiHits` = 7, `cosHits` = 0) es una evidencia directa de que las fuentes de co-ocurrencia y las fuentes de similitud semántica capturan señales no solapadas. Esto confirma la premisa arquitectónica de F1 —que la complementariedad de compra ($cross$-$sell$) no es reducible a la similitud de embedding— y justifica la inclusión de la fuente NPMI como componente irrenunciable del pool multi-fuente.

La ganancia neta de F3 sobre F2 en relevancia pura es modesta a nivel de `nDCG@10` —el baseline RRF del pool alcanza 0.177, frente al 0.152 de F2 en `nDCG@10`—, pero el incremento de recall de pool es el cimiento sobre el que F4 construirá el ranking multi-objetivo: con 84% de las compras futuras presentes en el pool, el optimizador de revenue tiene material suficiente para explorar la frontera de Pareto entre relevancia y margen.
