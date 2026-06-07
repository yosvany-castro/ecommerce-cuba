# Embeddings comerciales (F1)

## Motivación y pregunta de investigación

El primer factor del programa de tesis (F1) se ocupa de la capa más fundamental del pipeline de personalización: la representación vectorial del producto. Antes de aplicar cualquier reranker o función de ranking multi-objetivo, el sistema debe recuperar un conjunto de candidatos prometedores. La calidad de ese conjunto determina el techo práctico de todo lo que viene después.

La pregunta central es triple: ¿qué representación de producto recupera mejor (a) la próxima compra probable del usuario, (b) los complementos funcionales de lo que ya adquirió, y (c) la cola larga del catálogo, aquellos ítems que satisfacen necesidades latentes poco frecuentes? La hipótesis de partida era que los embeddings comportamentales —entrenados directamente sobre co-ocurrencias de compra— superarían a los embeddings de texto en (a) y (b), mientras que los modelos contextualizados podrían aportar en (c). Esta hipótesis se confirmó parcialmente, pero reveló un hallazgo negativo de mayor relevancia para la arquitectura final del sistema.

## Diseño experimental: comparación justa entre espacios vectoriales

Se evaluaron seis estrategias de representación, todas expuestas a través de una interfaz común de recuperación vectorial (`TopK` sobre pgvector):

- **`e0_text`**: embedding de texto puro con Voyage AI (1024 dimensiones), concatenando título, categoría y descripción corta del producto.
- **`e1_prod2vec`**: embedding comportamental entrenado con Prod2Vec sobre el historial de compras (64 dimensiones), análogo al Item2Vec de la literatura de sistemas de recomendación.
- **`e2_hybrid`**: fusión de score entre el espacio de texto (1024-d) y el comportamental (64-d), sin reentrenamiento conjunto.
- **`e3_two_tower`**: two-tower entrenado con muestras in-batch y corrección logQ para descontar la popularidad como sesgo de muestreo (64 dimensiones).
- **`e4_late`**: interacción tardía (late-interaction) con representación chunk-MaxSim; la consulta del usuario se descompone en hasta 24 fragmentos y se agrega por máximo de similitud.
- **`e5_context3`**: Voyage `context-3`, un modelo de embebido contextualizado que incorpora información de sesión (1024 dimensiones).

### Garantías de equidad (correcciones P0)

La comparación justa entre espacios vectoriales exige que la ventaja observada refleje la calidad de la representación y no artefactos del protocolo. Tres problemas de equidad se detectaron y corrigieron mediante revisión adversarial antes de ejecutar el experimento definitivo:

1. **Universo común de candidatos.** Cada espacio vectorial sólo puede representar los productos que ingirió durante su entrenamiento o indexación. Comparar sobre conjuntos de candidatos diferentes introduce sesgo estructural. La solución fue restringir el universo a los **1999 ítems** representables en todos los espacios simultáneamente.

2. **Intersección de complementos.** Los objetivos de `complement-recall@10` se restringieron a productos que pertenecen al mismo universo común y no forman parte del historial de entrenamiento del usuario, asegurando que la métrica mida recuperación real y no cobertura diferencial de los espacios.

3. **Híbrido seguro en dimensión.** La fusión de score en `e2_hybrid` opera sobre las puntuaciones de similitud normalizadas, no sobre concatenación de vectores, evitando que la mayor dimensionalidad del espacio de texto domine artificialmente la similitud resultante.

Con estas correcciones en vigor, los 1098 casos de evaluación y los candidatos son idénticos para los seis espacios; sólo varía el vector que determina el orden.

## Resultados

La tabla siguiente recoge las métricas principales sobre el conjunto de evaluación completo ($n = 1098$ casos):

| Espacio | `nDCG@10` | `Recall@10` | `complement-recall@10` |
|---|---|---|---|
| `e2_hybrid` | 0.124 | 0.252 | 0.000 |
| `e1_prod2vec` | 0.101 | 0.219 | 0.000 |
| `e3_two_tower` | 0.049 | 0.094 | 0.000 |
| `e4_late` | 0.039 | 0.087 | 0.002 |
| `e5_context3` | 0.039 | 0.085 | 0.001 |
| `e0_text` | 0.038 | 0.086 | 0.001 |

## Hallazgos

### Los embeddings comportamentales superan al texto en relevancia

El resultado más nítido es la brecha entre los espacios comportamentales y el texto puro. `e2_hybrid` obtiene un `nDCG@10` de 0.124 y un `Recall@10` de 0.252, frente a 0.038 y 0.086 del embedding de texto `e0_text`. La ratio es aproximadamente $3.3\times$ en `nDCG@10` y $2.9\times$ en `Recall@10`. `e1_prod2vec`, sin ninguna componente textual, ya supera al texto en ambas métricas (0.101 vs. 0.038 en `nDCG@10`, una ratio de $\approx 2.7\times$; 0.219 vs. 0.086 en `Recall@10`).

Esta superioridad confirma la intuición de base: en un catálogo de reventa donde los usuarios compran ítems relacionados con su contexto de vida (no con las palabras del título), la geometría del espacio comportamental —aprendida directamente de co-compras— captura la relevancia percibida mejor que la semántica lexical.

El modelo `e3_two_tower`, pese a incorporar señal comportamental, queda considerablemente por debajo de `e1_prod2vec` (0.049 vs. 0.101 en `nDCG@10`). Una hipótesis es que el conjunto de entrenamiento disponible es insuficiente para que el two-tower generalice bien en un catálogo de cola larga; Prod2Vec, al ser más simple, sufre menos de sobreajuste ante datos escasos.

Los modelos de interacción tardía y contextualizado (`e4_late`, `e5_context3`) se agrupan junto con `e0_text` en la banda baja (0.038–0.039 en `nDCG@10`), sin ventaja apreciable sobre el texto puro bajo las condiciones de este experimento.

### Hallazgo negativo: los embeddings no recuperan complementos

El resultado más importante de F1 —y el menos esperado— es que la columna `complement-recall@10` es prácticamente cero para los seis espacios: los valores oscilan entre 0.000 y 0.002. Dicho de otro modo, en un universo de 1999 candidatos rankeados por similitud vectorial al perfil del usuario, los complementos funcionales del producto adquirido no aparecen en los primeros diez puestos de ningún espacio, ni siquiera en los comportamentales.

Este hallazgo se reporta con honestidad plena porque constituye una contribución de diseño, no un fracaso a ocultar. Su implicación arquitectónica es directa: **el coseno en el espacio de embedding no es la herramienta adecuada para el cross-sell**. La complementariedad funcional —"quien compra X también necesita Y"— es una relación asimétrica y específica que los embeddings capturan sólo marginalmente; lo que sí capturan es similitud semántica o co-preferencia, que predice la próxima compra pero no el ítem complementario.

La conclusión de programa es que el cross-sell debe resolverse en el grafo de co-ocurrencia o mediante puntuaciones NPMI (Normalized Pointwise Mutual Information) sobre pares de productos, no mediante recuperación por coseno. Los embeddings son la herramienta correcta para relevancia y descubrimiento; el grafo de co-compra es la herramienta correcta para complementariedad. Ambas fuentes deben coexistir en el pool de candidatos de la etapa de fusión (F3), cada una aportando una señal ortogonal a la otra.

### Recomendación de producción

El análisis de utilidad normaliza la calidad frente al costo de indexación y consulta. Con la función $\text{utility} = \text{quality} - 0.5 \cdot \text{normalizedCost}$, `e2_hybrid` obtiene el mayor valor de calidad (0.074) y la mayor utilidad relativa entre las opciones evaluadas.

La recomendación de producción es desplegar **`e2_hybrid`**: un vector denso construido por fusión de score entre el espacio de texto Voyage y el espacio Prod2Vec, sin reentrenamiento conjunto. La ventaja operativa es que es un vector denso compatible con pgvector sin modificaciones de esquema, la inferencia en línea combina dos llamadas ligeras, y la calidad de recuperación es $3.3\times$ superior al embedding de texto puro que tendría el sistema sin señal comportamental.

## Síntesis del capítulo

F1 establece que la representación vectorial comportamental es imprescindible para la calidad de recuperación en este dominio. La fusión híbrida texto-comportamiento (`e2_hybrid`) ofrece el mejor balance calidad-costo y es la base sobre la que se construye el pool de candidatos en etapas posteriores del programa. El hallazgo negativo sobre complementariedad delimita el alcance arquitectónico de los embeddings y motiva el diseño del componente de cross-sell basado en grafo, que se desarrolla en la etapa de fusión de candidatos (F3).
