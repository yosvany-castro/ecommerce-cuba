# Introducción

## Contexto y problema

El e-commerce en Cuba presenta restricciones estructurales que condicionan toda
decisión de ingeniería: acceso limitado a logística propia, infraestructura
de pago fragmentada y un catálogo que debe servirse desde intermediarios externos.
El sistema objeto de este trabajo opera como reseller puro de catálogos de Amazon
y AliExpress: no mantiene stock físico y cada consulta a los agregadores de
producto tiene un costo directo en producción. Esta realidad económica eleva
la minimización de llamadas fallidas al agregador a prioridad arquitectónica de
primer orden, al mismo nivel que la relevancia de los resultados.

Sobre esta base, el pipeline de personalización de partida asignaba a cada ítem
del catálogo una puntuación escalar derivada de un único criterio de relevancia.
Formalmente, el peso del único objetivo era $\lambda_{\text{relevance}}=1$, lo
que equivale a asumir que la relevancia percibida por el usuario agota por
completo los intereses del negocio y que el perfil de intereses del usuario
puede representarse con un solo vector. Ambas asunciones son convenientes pero
cuestionables, y su cuestionamiento sistemático constituye el punto de partida
de este trabajo.

## Crítica de partida

Una auditoría adversarial del pipeline, documentada en
`docs/handoff-audit-reranker-pipeline.md` y en
`docs/superpowers/reports/2026-05-15-fase-3c-audit-razones.md`, identificó tres
debilidades estructurales en el diseño de partida.

La primera era que el reranker LLM no cambiaba el conjunto de ítems recuperados.
Operaba sobre un pool de treinta candidatos generados por MMR y devolvía
prácticamente los mismos diez ítems que el paso previo: reordenaba sin renovar.
La causa era estructural, no de calidad del modelo: un pool tan reducido deja al
reranker sin material diferencial respecto al retriever, de modo que no puede
elevar un ítem correcto que el retriever nunca incluyó.

La segunda debilidad era que el perfil de usuario basado en un único vector
colapsaba ante las sesiones de regalo. Cuando un comprador adquiere artículos para
una persona con gustos radicalmente distintos a los suyos —un hombre adulto
comprando artículos de bebé—, esos eventos se incorporan al perfil permanente y
contaminan las recomendaciones futuras de autoconsumo. Un vector único no tiene
mecanismo para separar el interés efímero del interés permanente.

La tercera debilidad era conceptual: la similitud coseno de embeddings de texto
no captura la complementariedad comercial. Un ratón inalámbrico y su alfombrilla,
una funda y el teléfono que protege, pueden estar en categorías léxicamente
distantes y, sin embargo, comprarse juntos de forma consistente. La distancia
coseno en el espacio de embeddings de texto no puede recuperar esa relación
funcional porque no fue entrenada sobre señal de compra conjunta.

El veredicto cualitativo de la auditoría fue más profundo que la lista de fallos
técnicos: planteó la hipótesis de que un "e-commerce normal bien hecho" —catálogo
ordenado por popularidad, búsqueda léxica y filtros de categoría— ya capturaba
la mayor parte del valor para el usuario final, de modo que cualquier capa de
personalización profunda debía justificarse con evidencia empírica rigurosa, y no
asumirse como mejora por su mera existencia. Esta es la pregunta motivacional que
el programa de tesis se propuso responder: ¿cuándo y cuánto ayuda la
personalización, y dónde no ayuda?

## Contribuciones

El programa de tesis se articula en cuatro fases de experimentación (F1–F4),
precedidas por la construcción de la infraestructura de evaluación (F0). Cada
fase prueba una idea empíricamente, mide su lift y reporta sus límites con la
misma honestidad que sus victorias. Las tres ideas que guiaron el programa son
las siguientes.

**Primera contribución: el usuario como distribución multi-modo con modelo
explícito de regalo.** Se abandona la representación de usuario como punto único
en el espacio de embeddings y se adopta un modelo de distribución de intereses
inspirado en PinnerSage: los intereses del usuario forman clústeres, cada uno
representado por su medoide, y durante la recuperación cada modo emite candidatos
de forma proporcional a su peso relativo. Sobre esta base se añade un eje
ortogonal al modelado de intereses: la detección de intención de regalo y la
construcción de un vector de destinatario efímero, que sustituye temporalmente
al perfil del comprador durante la sesión sin alterar su historial permanente.
Esta factorización comprador $\times$ destinatario no está modelada explícitamente
en la literatura de multi-interés consultada y constituye una contribución
original.

**Segunda contribución: la relación comercial no es proximidad lingüística.**
La complementariedad entre productos —la relación que hace que una funda sea el
complemento natural de un teléfono— no es recuperable por similitud coseno en
el espacio de texto. Este trabajo modela la complementariedad con co-ocurrencia
de compra ponderada por *Normalized Pointwise Mutual Information* (NPMI), y
la integra como fuente independiente en un pool multi-fuente de candidatos que
se fusiona mediante *Reciprocal Rank Fusion* (RRF). El resultado es que ítems
complementarios que ningún retriever semántico hubiera incluido entran al pool
y son accesibles al reranker.

**Tercera contribución: el ranking como negociación multi-objetivo.** El score
de relevancia pura es un caso particular de una familia más general de funciones
de ranking donde distintos objetivos del negocio coexisten bajo pesos ajustables.
El trabajo implementa una combinación lineal convexa con cuatro objetivos
—relevancia, revenue esperado, margen bruto y diversidad de vendedor— y estudia
la frontera de Pareto entre relevancia y revenue. La principal lección es que
esta frontera existe y no es trivial: el operador puede mover explícitamente el
punto de operación a lo largo de ella sin necesidad de reentrenamiento.

Como contribución habilitadora se estudia también empíricamente la elección de
embedding comercial (F1): seis familias de representación de producto —texto
puro, Prod2Vec comportamental, modelo híbrido, two-tower con corrección logQ,
late-interaction y modelo contextualizado— se evalúan sobre los mismos 1 999
ítems y bajo el mismo arnés de evaluación, revelando que ningún embedding
recupera complementos por similitud coseno, lo que motiva directamente la
contribución de co-ocurrencia.

## Enfoque metodológico

La atribución rigurosa del lift a cada componente requiere conocer la verdad.
Con datos observacionales de producción, la preferencia real del usuario se
confunde con la exposición y la popularidad. Este trabajo construye un simulador
de marketplace con verdad de fondo conocida: los gustos latentes del usuario, las
relaciones de complementariedad y la siguiente compra que realizaría son generados
por el sistema y conocidos de antemano. Sobre ese suelo firme se construye un
arnés de evaluación con holdout temporal que permite atribuir el lift de cada
componente de forma inequívoca y reportar honestamente dónde un método no ayuda.
En una frase: el simulador con ground-truth más el arnés de evaluación riguroso
permiten separar lo que funciona de lo que meramente parece funcionar.

## Estructura del documento

El documento sigue la secuencia lógica del programa de tesis:

- **Estado del arte** (`02-related-work.md`): revisión de la literatura sobre
  representación multi-vector del usuario, embeddings de recuperación,
  complementariedad cross-sell, reranking con modelos de lenguaje, ranking
  multi-objetivo y evaluación off-policy. Se posiciona cada contribución
  respecto a la literatura.

- **Metodología** (`03-metodologia.md`): descripción del simulador de marketplace,
  el arnés de evaluación, la disciplina de no-mocks y el diseño de fases como
  experimentos acumulativos.

- **F1 — Embeddings comerciales** (`04-f1-embeddings.md`): comparación de seis
  familias de representación de producto; hallazgo de que los embeddings no
  recuperan complementos por similitud coseno.

- **F2 — Usuario multi-vector y modelo de regalo** (`05-f2-multivector.md`):
  modelo de distribución de intereses con medoides adaptativos y vector efímero
  de destinatario para sesiones de regalo.

- **F3 — Pool multi-fuente y reranking** (`06-f3-rerank.md`): diseño del pool
  de candidatos de cuatro fuentes, evaluación de cuatro familias de reranker y
  hallazgo de que ningún reranker supera a la fusión RRF en relevancia pura.

- **F4 — Ranking multi-objetivo** (`07-f4-multiobjetivo.md`): implementación de
  la combinación lineal convexa de objetivos, estudio de la frontera de Pareto
  entre relevancia y revenue, y limitaciones de la aproximación a la
  probabilidad de compra.

- **Discusión** (`08-discusion.md`): integración de los hallazgos de F1–F4,
  limitaciones del enfoque sintético y consideraciones de transferibilidad a
  datos reales de producción.

- **Conclusión y trabajo futuro** (`09-conclusion-trabajo-futuro.md`): síntesis
  de contribuciones, hallazgos negativos que merecen atención y líneas abiertas.

- **Plan de piloto A/B** (`10-plan-piloto.md`): diseño sin ejecutar de un
  experimento controlado en producción para validar el lift observado offline
  con tráfico real.
