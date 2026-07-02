# Metodología

Este capítulo describe el aparato experimental que sustenta el programa empírico.
La metodología se articula en cuatro pilares: el simulador de marketplace con
verdad de fondo conocida (ground-truth), el arnés de evaluación que explota esa
verdad para medir con rigor, la disciplina de no-mocks que garantiza la
fidelidad al sistema real, y el diseño de fases F0–F4 como experimentos
sucesivos que se construyen uno sobre el anterior. Todos los detalles de
ingeniería que se mencionan aquí están especificados en los documentos de diseño
citados al pie de cada sección.

---

## El simulador de marketplace con verdad de fondo

### Motivación del enfoque sintético

Evaluar un sistema de personalización con datos puramente observacionales plantea
un problema estructural: no se puede saber si el sistema recomienda lo correcto
porque el usuario realmente lo prefería, o porque el historial de comportamiento
ya estaba sesgado hacia los ítems más visibles. La confusión entre popularidad,
exposición y preferencia real es endémica en los logs de producción. Adicionalmente,
conceptos como la complementariedad comercial (que una funda y un teléfono son
complementos, no porque suenen parecido sino porque se usan juntos) o la intención
de regalo (que el usuario compra para alguien con gustos diferentes a los suyos)
son imposibles de aislar sin etiquetar manualmente a gran escala.

Para evitar estas limitaciones, el programa construye un **simulador de marketplace**
en el que la "verdad" es generada por el propio sistema: se conocen el gusto real
de cada usuario, la intención de cada sesión, las relaciones de complementariedad
entre productos y la siguiente compra que cada usuario realizaría. Esto hace
posible (a) un holdout temporal sin fuga de información y (b) ablations que
atribuyen el lift a cada componente del sistema de forma inequívoca —algo
imposible con datos puramente observacionales.

### Catálogo sintético y taxonomía

El catálogo sintético se genera de forma declarativa a partir de una taxonomía
jerárquica: categoría $\to$ subcategoría $\to$ marca $\to$ atributos (género
objetivo, banda de edad, banda de precio, estilo, color, material). Las
combinaciones de la taxonomía se muestrean para producir aproximadamente 2 000
productos con títulos y descripciones en español, generadas por plantillas
parametrizadas con suficiente variedad para que tanto la búsqueda léxica (BM25)
como los embeddings semánticos tengan señal real y no trivial.

A cada producto le corresponde un vector latente de factores (`factor_vector`),
que codifica sus atributos en el espacio de ground-truth; este vector **no es el
embedding Voyage** sino la representación canónica del producto construida antes
de cualquier proceso de embedding. Los embeddings Voyage se calculan del texto y
se persisten por separado. El `factor_vector` es la fuente de verdad que permite
después evaluar si un método de embedding recupera el gusto latente del usuario.

El catálogo se genera de forma determinista dado un valor de semilla (`--seed`),
garantizando la reproducibilidad de todos los experimentos. Los campos de negocio
necesarios para F4 (`margin_pct`, `stock_health`, `seller_id`,
`seller_age_days`) se añaden al catálogo en esa fase como extensión aditiva,
sin alterar la estructura de datos de fases previas.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`, §4.2.

### Grafo de complementariedad ground-truth

Sobre la taxonomía se define un grafo de complementariedad con reglas semánticas
conocidas: un teléfono complementa a una funda, un cargador y unos auriculares;
un vestido complementa a tacones, cartera y collar; dos productos de la misma
subcategoría pero diferente marca son sustitutos; una variante de gama superior
constituye un upgrade. Este grafo se persiste en la tabla `gt_product_relations`
con los tipos `complement`, `substitute`, `upgrade` y `accessory`, así como un
campo de fuerza de la relación.

La hipótesis central que articula los experimentos de F1 y F3 es que la
complementariedad comercial no es recuperable por similitud de texto (dos
productos pueden ser complementos perfectos sin compartir vocabulario), pero sí
emerge de la co-ocurrencia de comportamiento cuando el generador de sesiones
siembra co-visitas que siguen el grafo. Esta hipótesis es **verificable** porque
el grafo es conocido, lo que convierte su recuperabilidad en un test de
discriminación del arnés.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`, §4.3.

### Generador de comportamiento con estado latente conocido

El generador de comportamiento produce sesiones de usuario a partir de un modelo
generativo parametrizado. Cada usuario simulado (`sim_users`) posee un estado
latente que incluye: una mezcla de $K \in [1, 3]$ clusters de gusto definidos en
el espacio de factores, una sensibilidad al precio (`price_sensitivity`), una
propensión a comprar para otros (`p_gift`), y entre cero y tres destinatarios
(`sim_user_recipients`) con relación, género y banda de edad conocidos.

Al generar cada sesión, el modelo decide con probabilidad `p_gift` si se trata de
una sesión de regalo o de compra propia; registra la intención real (`intent`) en
`sim_sessions` junto con el identificador del destinatario cuando corresponde. El
modelo de click y compra sigue una cadena view $\to$ cart $\to$ purchase con
probabilidades de embudo configurables; la probabilidad de ver un ítem es
proporcional a su similitud con la intención latente de la sesión, penalizada por
la desviación del precio respecto al presupuesto del usuario y bonificada por la
log-popularidad. La co-ocurrencia intra-sesión se **siembra** desde el grafo de
complementariedad ground-truth: los complementos del ítem de anclaje aparecen
con mayor frecuencia en la misma sesión, generando la señal de co-compra que el
algoritmo NPMI explotará en F3.

El generador es completamente determinista dado su valor de semilla. La
"próxima compra" reservada para evaluación se persiste en la tabla `holdout`.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`, §4.4.

### Esquema de base de datos dedicado

Todos los datos del programa se alojan en el esquema Postgres `thesis`, paralelo
al esquema de producción (`public`) y al de pruebas (`test_schema`). El esquema
replica las tablas que el pipeline de producción consume (`products`, `events`,
`user_profiles`, `session_vectors`, `co_occurrence`, `co_occurrence_top`,
`cohort_centroids`, etc.) y añade las tablas de ground-truth: `gt_product_factors`,
`gt_product_relations`, `sim_users`, `sim_user_recipients`, `sim_sessions` y
`holdout`. Este aislamiento garantiza que los experimentos de tesis no afectan
los datos de producción en ningún caso.

---

## Por qué el ground-truth es imprescindible

La ventaja fundamental del simulador sobre un dataset observacional es que
permite **preguntas contrafácticas** con respuesta conocida. Conocer el gusto
latente del usuario (los clusters del estado latente) permite evaluar si el
sistema recupera ítems del gusto correcto, no solo ítems populares. Conocer la
intención por sesión (propia vs. regalo) permite segmentar el holdout sin
etiquetar manualmente. Conocer el grafo de complementos permite medir si el
sistema entiende la relación comercial entre productos y no solo la lingüística.
Y conocer la próxima compra efectuada permite construir un holdout temporal
estricto con **sin fuga de información** hacia el pasado.

Esta arquitectura experimental sigue el espíritu de los bancos de pruebas
sintéticos usados en sistemas de recomendación de investigación (world models,
AlignUSER), pero está diseñada en función de las preguntas comerciales concretas
del negocio: recuperación del gusto personal, cross-sell de complementos,
personalización de regalos y optimización multi-objetivo del feed.

El holdout temporal se construye con un split leave-one-out por usuario: la
última sesión de compra pasa a test; el resto permanece en train. Esto simula
la condición de producción (predecir la siguiente compra dado el historial
pasado) y previene el look-ahead bias que afecta a los splits aleatorios.

---

## El arnés de evaluación

### Arquitectura de interfaces

El arnés de evaluación se articula alrededor de dos interfaces abstractas. La
interfaz `Ranker` recibe un contexto de usuario y un conjunto candidato y devuelve
una lista de identificadores de producto ordenados. La interfaz `Embedder` produce
vectores a partir de productos o consultas de usuario y computa scores. Todos los
métodos estudiados en el programa —baselines, estrategias de embedding de F1,
representación multi-vector de F2, rerankers de F3 y el scorer multi-objetivo de
F4— implementan la interfaz `Ranker`, lo que garantiza la comparabilidad uniforme
en todas las ablations.

### Suite de métricas

La suite de métricas cubre tres dimensiones:

**Métricas de accuracy.** Recall@k mide la fracción de usuarios para los que el
ítem holdout aparece en los primeros $k$ resultados. nDCG@k (Normalized Discounted
Cumulative Gain) pondera la posición del ítem relevante de forma logarítmica.
MRR (Mean Reciprocal Rank) captura la posición media del primer ítem relevante.
MAP (Mean Average Precision) integra la precisión a lo largo del ranking completo.
HitRate@k es un indicador binario de presencia en el top-k.

**Métricas beyond-accuracy.** La diversidad intra-lista se mide como
$1 - \overline{\text{coseno por pares}}$ entre los ítems del top-k. La novedad
se mide como $-\log$ de la popularidad del ítem. El Gini de exposición de
vendedores cuantifica la concentración del tráfico entre los vendedores del
catálogo: un Gini cercano a cero indica exposición equitativa, mientras que un
Gini elevado señala hiperconcentración.

**Métricas comerciales y de tarea.** `complement-recall@k` mide la fracción de
complementos ground-truth del último ítem visto que aparecen en los primeros k
resultados —es el indicador central de cross-sell recuperado por el sistema—.
`recipient-fit@k`, introducida en F2, mide en sesiones de regalo la fracción del
top-k cuyo género objetivo y banda de edad caen dentro del perfil del destinatario
real registrado en `sim_user_recipients`. `set-change@10`, introducida en F3,
cuantifica la fracción del top-10 de un reranker que difiere del top-10 del orden
de base del pool, distinguiendo el reordenamiento puro de la verdadera selección.
`revenue@k`, introducida en F4, estima el ingreso esperado del feed como la suma
del revenue esperado de los k primeros ítems, siendo el revenue de cada ítem el
producto de la probabilidad de compra, el precio y el margen.

### Baselines

Cuatro baselines establecen los pisos de referencia: (a) random, que ordena el
catálogo sin señal; (b) popular-global, que ordena por popularidad absoluta sin
personalización; (c) popular-cohort, que ordena por popularidad dentro del cohort
demográfico del usuario; y (d) cosine-single-vector, que corresponde al sistema
actual de producción —un vector de perfil único por usuario comparado por coseno
con los embeddings de texto Voyage. La progresión de baselines permite aislar la
contribución de cada componente.

### Estimadores off-policy (OPE)

Para conectar las métricas offline con el impacto esperado en producción, el arnés
implementa tres estimadores de evaluación off-policy (OPE): IPS (Inverse Propensity
Scoring), SNIPS (Self-Normalized IPS) y el estimador doblemente robusto (DR). La
ventaja del entorno sintético es que las propensidades (probabilidades de que el
sistema logged presentara cada ítem) son conocidas por diseño —son parámetros del
generador—, lo que permite validar los estimadores OPE contra la verdad y medir
su varianza sin las aproximaciones que exigen los logs de producción reales.

### Ablation runner y reproducibilidad

El ablation runner recorre el producto cartesiano de configuraciones
(embedder $\times$ baseline $\times$ parámetros) y agrega las métricas en tablas
Markdown y JSON listos para incluir en los capítulos de resultados. Todo el arnés
es determinista bajo una semilla fija: la misma semilla produce los mismos datos,
los mismos splits, las mismas métricas, garantizando la reproducibilidad plena
de todos los experimentos de la tesis.

---

## Disciplina de datos reales: sin mocks

Una restricción de diseño central del programa es que **ningún estudio se ejecuta
contra mocks de base de datos, de embeddings ni de LLMs**. Todos los experimentos
corren contra Postgres real (con la extensión `pgvector`) y contra la API Voyage
real para los embeddings. Los estudios de F3 que involucran reranking con LLM
utilizan DeepSeek a través del proveedor configurado (`defaultProvider`), sin
intercepción simulada.

Esta restricción se **hace cumplir automáticamente** mediante un verificador AST
integrado en el repositorio que detecta cualquier patrón de mock en el código de
los estudios (`pnpm test:quality`). El objetivo no es solo el rigor académico:
en producción, cada llamada al agregador de precios tiene costo real y latencia
real. Un sistema evaluado íntegramente sobre mocks puede mostrar métricas
excelentes que se degradan significativamente en producción porque las llamadas
reales tienen distribuciones de latencia, fallos parciales y costos que los mocks
no reproducen. La evaluación debe reflejar el sistema real para que las
conclusiones sean transferibles.

Este principio se extiende también a los costos: los embeddings Voyage tienen un
precio por token, y el arnés los calcula una sola vez y los persiste en la base
de datos por hash de texto (caché), de modo que los re-runs de experimentos no
incurren en costos adicionales. El LLM reranker de F3 opera sobre ventanas de
30 candidatos por consulta para mantener el costo controlado, y el runner
registra la tasa de fallback del LLM (el porcentaje de veces que el modelo no
devuelve un resultado válido y se activa el orden determinista de respaldo); el
fallback rate es una métrica reportada explícitamente para la familia LLM.

---

## Diseño de las fases experimentales

El programa se organiza en cinco fases. Las cuatro primeras (F0–F4) son
experimentales y corresponden a contribuciones empíricas diferenciadas; F5
corresponde a la escritura y el piloto de producción. Cada fase construye sobre
la anterior: reutiliza el mismo dataset, el mismo arnés y el mismo esquema de
base de datos, extendiendo el aparato en lugar de reemplazarlo.

### F0: Fundación de datos y arnés de evaluación

F0 establece los cimientos: genera el catálogo sintético, el grafo de
complementariedad y el comportamiento de usuarios; construye el arnés de
evaluación con su suite de métricas y baselines; y ejecuta una primera corrida
de validación del arnés (test de discriminación: el grafo ground-truth es
recuperable por co-ocurrencia pero no por coseno de texto). F0 no reporta
resultados de ningún método de personalización; su criterio de aceptación es
que el arnés distingue correctamente el método que debería ganar.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`.

### F1: Estudio comparativo de embeddings

F1 estudia seis estrategias de embedding bajo una interfaz común `Embedder`:
E0 (texto, Voyage, línea base actual), E1 (Prod2Vec, skip-gram sobre secuencias
de sesión), E2 (híbrido con gate adaptativo según número de interacciones), E3
(two-tower con corrección logQ del sesgo de muestreo, según Yi et al.,
RecSys'19), E4 (late-interaction MaxSim aproximado sobre chunks sin GPU) y E5
(`voyage-context-3`, candidato realista de serving). La comparación se realiza
sobre tres preguntas comerciales que el coseno de texto no resuelve bien:
recuperación del gusto personal (próxima compra), recuperación de complementos
(cross-sell) y recuperación de cola larga. Todas las estrategias se evalúan
con el arnés F0 sobre el mismo holdout.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`, §4.7.

### F2: Representación multi-vector del usuario y modelo de regalo

F2 ataca dos limitaciones del vector único que F1 puso de manifiesto: el usuario
de intereses múltiples y ortogonales queda representado por un vector promedio que
no refleja ninguno de sus gustos, y el usuario que compra regalos contamina su
perfil con las preferencias ajenas. F2 implementa la representación multi-vector
PinnerSage (Pal et al., KDD'20): clustering aglomerativo de enlace promedio con
distancia coseno sobre el historial en el espacio E1, con un número de modos adaptativo por usuario y cada modo representado
por su medoide (ítem real, interpretable). La detección de intención de regalo se
realiza a nivel de sesión mediante señales de desviación cross-cohort (la sesión
apunta a una demografía alejada del perfil propio) sin acceder al ground-truth
de intención en inferencia. El vector de destinatario es efímero: se construye a
partir de los ítems de la sesión de regalo y no contamina los modos permanentes del
usuario. El retrieval multi-modo asigna cuotas proporcionales al peso de cada modo
y fusiona las listas con RRF. La evaluación es segmentada por intención real
(self/gift) y nivel de multimodalidad del usuario.

*Diseño de referencia:* `docs/superpowers/specs/2026-05-29-thesis-f2-multivector-recipient-gift-design.md`.

### F3: Pool de candidatos multi-fuente y comparación de rerankers

F3 parte de un hallazgo del audit conductual previo al programa: el reranker LLM
del sistema anterior "no cambiaba el conjunto, solo reordenaba". La hipótesis de
F3 es que el problema era el pool de entrada, no el reranker. Con un pool grande
(100–300 candidatos) generado por cuatro fuentes complementarias —retrieval F2
multi-modo, vecinos NPMI de co-compra del último ítem visto, popularidad por
cohort/destinatario, y cuota de exploración/novedad—, un reranker con acceso a
features que el retrieval no ve (score de co-compra NPMI, ajuste de precio,
señal de regalo de F2, recencia, fuente del candidato) sí puede seleccionar y
reordenar con lift medible. F3 compara cuatro familias de reranker sobre el mismo
pool: LTR aprendido (regresión logística con SGD, entrenada solo sobre el split
train), LLM listwise (DeepSeek, ventana de 30 candidatos), cross-encoder MaxSim
(aproximación late-interaction sin GPU, reutilizando E4 de F1) y baselines (MMR
y orden RRF del pool). La métrica `set-change@10` evalúa directamente si el
reranker cambia el conjunto recuperado o solo lo reordena, distinguiendo cambio
de ruido.

El grafo NPMI se construye sobre los eventos del simulador mediante backfill en
el esquema `thesis`, con la misma función `recomputeNPMI` usada en producción pero
operando sobre el search path `thesis`. Los vecinos NPMI de cada producto deben
recuperar los complementos del grafo ground-truth de F0 mucho mejor que el coseno,
lo que se verifica con el mismo test de discriminación del arnés.

*Diseño de referencia:* `docs/superpowers/specs/2026-06-07-thesis-f3-candidate-generation-rerank-study-design.md`.

### F4: Ranking multi-objetivo

F4 cierra el arco del programa. El resultado honesto de F3 es que los rerankers
con features no superan al RRF del pool en relevancia pura porque el ranking
estaba optimizando un solo objetivo. F4 demuestra que el reranking sí aporta
cuando se negocian objetivos competidores: `s(p|u) = \sum_k \lambda_k \cdot f_k(p,u)`.
Las features objetivo son: relevancia (coseno a los modos F2 del usuario),
margen del producto, probabilidad de conversión (derivada del mismo modelo de
afinidad latente del generador, para consistencia), novedad, diversidad marginal
(estilo MMR greedy) y fairness de vendedores (boost a vendedores con poca
exposición).

Un elemento de diseño clave para que exista una negociación real es la
**anti-correlación intencional** entre margen y popularidad/precio en el
catálogo: los productos más relevantes y visibles tienden a tener menor margen,
mientras que la cola larga tiende a mayor margen. Sin esta anti-correlación, el
ítem más relevante sería también el más rentable y no habría trade-off que
demostrar. La anti-correlación está sembrada en el generador y es verificable.

El modelo de outcome `expectedRevenue = P(\text{compra}|u,p) \cdot \text{precio} \cdot \text{margen}$
se usa tanto como feature estimable en inferencia (`convProb`) como para medir
el revenue del feed (`revenue@k`); la probabilidad de compra estimable y la
compra holdout son señales distintas, lo que evita el leakage del split de test.

El sweep de la grilla de $\lambda$ es determinista y produce un vector de métricas
para cada configuración; de esas configuraciones se extrae la **frontera de
Pareto** (el conjunto no-dominado) y se selecciona el **punto KPI**: la
configuración que maximiza `revenue@10` sujeta a guardrails de relevancia mínima
y fairness mínima. Este punto es la respuesta del programa a la pregunta del
negocio: cómo convertir el ranking de una decisión implícita (relevancia pura)
en una decisión de negocio explícita y medible.

*Diseño de referencia:* `docs/superpowers/specs/2026-06-07-thesis-f4-multi-objective-ranking-design.md`.

---

## Advertencia de escala y validez externa

### Escalas de datos y separación de tablas de resultados

El programa opera con dos escalas de dataset que no son comparables directamente.
La evaluación inicial del arnés (F0) se ejecutó sobre un catálogo de
aproximadamente $n = 400$ productos, suficiente para validar la corrección del
arnés pero insuficiente para resultados representativos. Los estudios comparativos
de F1 a F4 corren sobre el catálogo regenerado a $n = 2\,000$ productos, con el
grafo de complementariedad completo y los campos de negocio de F4. Las cifras
de ambas escalas **no se mezclan en ninguna tabla de resultados**: cada tabla
indica explícitamente la escala del dataset sobre la que fue producida.

### Validez externa: dataset sintético y cross-check público

El dataset es enteramente sintético. Las conclusiones sobre qué métodos son
superiores se obtienen bajo las condiciones de un marketplace simulado, con
distribuciones de comportamiento y complementariedad generadas por reglas
conocidas. Esta es la fortaleza metodológica que permite los ablations rigurosos,
pero es también una limitación de validez externa.

Para mitigar esta limitación, el diseño de F0 contempla un adaptador de dataset
público (`scripts/thesis/data/public-adapter.ts`) que carga un dataset abierto
de e-commerce y lo mapea al esquema `thesis`, permitiendo un cross-check de las
conclusiones principales sobre comportamiento real. Este adaptador está
implementado en el repositorio con la anotación `scope:'thesis'` y el marcador
`source='public'`, y está listo para recibir un dataset real (candidatos:
Amazon Reviews 2023 en categorías de moda/electrónica, o datasets de sesiones
tipo RetailRocket/Yoochoose según licencia). La ejecución de ese cross-check
queda como trabajo futuro inmediato: el único bloqueante es la elección y carga
del dataset real, no el código del adaptador ni del arnés.

Toda afirmación sobre ventajas de un método sobre otro en este trabajo debe
leerse con esta acotación: los resultados son válidos internamente bajo las
condiciones del simulador, y la validez externa está pendiente de confirmación
empírica sobre datos reales.

---

## Reproducibilidad y separación de código

Todo el código experimental del programa reside bajo `src/thesis/` (librería
pura) y `scripts/thesis/` (CLIs de generación, entrenamiento y ejecución de
estudios), aislado del código de producción (`src/sectors/d-personalization/`).
Los experimentos no modifican las tablas del esquema de producción bajo ninguna
circunstancia. Los estudios importan funciones de producción cuando corresponde
(por ejemplo, `rrfFuse`, `mmrSelect`, `recomputeNPMI`), pero las invocan a través
del cliente de base de datos con `scope:"thesis"` para que operen sobre el
search path del esquema experimental.

La reproducibilidad está garantizada por tres mecanismos: (1) toda generación de
datos y toda corrida de evaluación acepta un parámetro de semilla explícito que
determina completamente el resultado; (2) los embeddings calculados con la API
Voyage se persisten por hash de texto en la base de datos, de modo que re-runs
no incurren en variabilidad ni en costo adicional; y (3) el verificador AST
integrado rechaza cualquier patrón de mock, asegurando que los artefactos
presentados en la tesis son reproducibles desde el mismo entorno real.
