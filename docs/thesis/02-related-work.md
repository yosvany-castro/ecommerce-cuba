# Estado del arte

Este capítulo revisa el estado del arte en las áreas que fundamentan el programa de tesis:
representación del usuario, embeddings de recuperación, fusión y diversidad, complementariedad
cross-sell, reranking con modelos de lenguaje, ranking multi-objetivo y evaluación off-policy.
Para cada área se posiciona la contribución de este trabajo respecto a la literatura existente.

El aporte central de esta tesis es la integración de representación multi-vector del usuario,
co-ocurrencia para cross-sell, reranking sobre un pool amplio de candidatos y ranking
multi-objetivo en un **pipeline único**, evaluado con ground-truth sintético de verdad conocida.
A diferencia de trabajos que optimizan cada componente de forma aislada, aquí se miden las
interacciones entre componentes —incluyendo los hallazgos negativos— como parte explícita de
la contribución.

---

## Representación del usuario

La representación del usuario es la base de cualquier sistema de recomendación personalizado.
PinnerSage [1] propone representar a cada usuario mediante varios vectores (modos de interés)
obtenidos por clustering Ward de su historial, con cada modo caracterizado por su medoide y
su peso relativo; esta arquitectura multi-vector supera a los perfiles de vector único cuando
el usuario tiene intereses genuinamente ortogonales. MIND [2] adopta un enfoque similar basado
en cápsulas de interés dinámicas, demostrando que la diversidad interna del perfil de usuario
mejora la cobertura del recall. Trabajos más recientes de Pinterest [3] extienden esta línea
modelando intereses implícitos y explícitos de forma conjunta, con señales comportamentales de
alta frecuencia. Este trabajo aplica el núcleo de PinnerSage (representación multi-vector
con medoides adaptativos, vía clustering aglomerativo de enlace promedio con distancia coseno) y lo extiende con un **eje destinatario/regalo**: cuando la sesión revela
intención de regalo, el perfil del destinatario reemplaza temporalmente el perfil propio
del comprador, evitando que el historial de regalos contamine los modos permanentes del
usuario. Esta factorización usuario $\times$ destinatario no aparece modelada explícitamente
en la literatura de multi-interés consultada, y constituye una contribución original defendible.

## Embeddings de recuperación

Los modelos two-tower con corrección logQ [4] permiten entrenar embeddings de ítems y usuarios
a partir de feedback implícito con exposición sesgada, corrigiendo la distorsión por
popularidad que introduce el sistema de producción. Item2Vec y Prod2Vec [5] extienden la idea
de Word2Vec al catálogo de productos, aprendiendo representaciones comportamentales desde
co-clics o co-compras sin necesidad de atributos textuales. La familia ColBERT/ColBERTv2
y su extensión multilingüe Jina-ColBERT-v2 [6] adopta la interacción tardía (late interaction)
con puntuación MaxSim por fragmento, logrando la precisión de los cross-encoders con un coste
de inferencia más próximo a los bi-encoders. El modelo `voyage-context-3` [7] produce
embeddings contextualizados por fragmento, útiles cuando el texto del ítem contiene información
en múltiples bloques semánticamente heterogéneos. Este trabajo implementa las cinco estrategias
(texto plano, Prod2Vec, híbrido, two-tower y late-interaction ColBERT) bajo una interfaz
común `Embedder` y las compara de forma controlada sobre el mismo arnés de evaluación,
encontrando que todas capturan relevancia pero ninguna captura complementariedad, lo que
motiva el uso de co-ocurrencia NPMI como fuente separada.

## Fusión y diversidad

Reciprocal Rank Fusion (RRF) [8] propone combinar múltiples listas de resultados ponderando
el rango recíproco de cada ítem en cada lista, sin necesidad de normalizar los scores de
diferentes retrievers. Su sencillez y robustez lo han convertido en el estándar de facto para
la fusión de candidatos multi-fuente. Maximal Marginal Relevance (MMR) [9] introduce un
criterio de selección greedy que balancea relevancia e información marginal, reduciendo la
redundancia en el conjunto final de resultados. Este trabajo utiliza RRF como mecanismo de
fusión del pool multi-fuente en F2 y F3, y adopta una selección estilo MMR para el término
de diversidad marginal en el scorer multi-objetivo de F4. Un hallazgo importante es que RRF
sobre el pool multi-fuente resulta ser un baseline muy competitivo: los rerankers LLM y LTR
consiguen cambiar el conjunto recuperado (set-change@10 medible) pero **no superan a RRF en
nDCG**, lo que constituye un hallazgo negativo honesto de este trabajo.

## Cross-sell y complementariedad

La asociación de productos complementarios mediante co-ocurrencia ponderada, medida con NPMI
(Normalized Pointwise Mutual Information) [10], captura relaciones de compra conjunta que
**no son de proximidad lingüística** sino de comportamiento comercial: un cable y un cargador
pueden ser complementarios aunque sus textos no sean similares. El NPMI permite distinguir
complementos verdaderos de pares que simplemente co-ocurren por popularidad, dado que normaliza
por las frecuencias marginales. Este trabajo confirma empíricamente, a partir de seis familias
de embeddings, que ningún espacio vectorial basado en texto o comportamiento individual
recupera complementos con complement-recall@10 superior a 0,001. En consecuencia, la
co-ocurrencia NPMI se incorpora como **fuente explícita del pool de candidatos y como feature
del reranker**, no como señal de proximidad vectorial. Este diseño es coherente con la
distinción conceptual entre similitud semántica y asociación estadística de compra.

## Reranking con modelos de lenguaje

RankGPT [11] y su sucesor RankZephyr demuestran que los modelos de lenguaje instrucciones
pueden puntuar o reordenar documentos de forma listwise sin entrenamiento adicional de reranking,
obteniendo ganancias en benchmarks de recuperación de información. LLM4Rerank [12] sistematiza
el paradigma, explorando estrategias de prompting y la interacción entre el tamaño del pool y
la calidad del reranking. REARANK [13] avanza hacia reranking razonado: el modelo genera una
cadena de justificación antes de producir el ranking final. Este trabajo sitúa el reranking
LLM listwise (DeepSeek, sin GPU) como una de las cuatro familias de reranker comparadas en
F3, junto con LTR aprendido, cross-encoder MaxSim (aproximación de E4 sin GPU) y baselines
MMR/RRF. El hallazgo principal es que **el reranker LLM no estaba roto en el sistema
original**, sino hambriento: con un pool de 10 candidatos no había de dónde elegir; con 100–300
candidatos sí cambia el conjunto. Sin embargo, sigue sin superar a RRF en nDCG, sugiriendo que
los gains del reranking LLM en benchmarks de IR pueden no transferirse directamente a catálogos
de e-commerce con distribuciones de popularidad sesgadas.

## Ranking multi-objetivo

El ranking multi-objetivo para sistemas de recomendación ha sido formulado desde la perspectiva
de la optimización de Pareto [14], donde ninguna configuración de pesos domina a todas las
demás en todos los objetivos simultáneamente. Airbnb [15] documenta un caso industrial de MOO
constreñido para balancear satisfacción de huéspedes y salud del inventario, demostrando que
los trade-offs son cuantificables y operacionalizables. MOO-by-distillation [16] propone
aprender directamente un ranker multi-objetivo mediante destilación desde múltiples rankers
especializados. Los bandits de diversidad [17] abordan el problema de forma online, aprendiendo
políticas que intercalan objetivos de relevancia y diversidad a lo largo del tiempo. Este
trabajo adopta el enfoque offline: un scorer lineal $s(p|u) = \sum_k \lambda_k \cdot f_k(p,u)$
con un barrido determinista de $\lambda$ sobre seis features normalizadas (relevancia, margen,
probabilidad de conversión, diversidad marginal, novedad, fairness de vendedores). El resultado
es la **frontera de Pareto** entre relevancia y revenue, con la prueba cuantitativa de que
"subir revenue cuesta X de relevancia". Esto convierte el ranking de un score implícito
$(\lambda_{\text{relevance}} = 1$, todo lo demás 0, que es lo que hace el sistema hasta F3)
en una **decisión de negocio explícita y medible**.

## Evaluación y estimación off-policy

nDCG (Normalized Discounted Cumulative Gain) es la métrica estándar para evaluar calidad de
ranking; trabajos recientes [18] discuten su uso como métrica off-policy cuando los logs del
sistema de producción no son exploratorios, destacando el sesgo de exposición que introduce
el sistema de producción en las estimaciones. La estimación off-policy de generadores de
candidatos [19] proporciona marcos formales para estimar el valor de una política nueva a
partir de logs históricos sin desplegar el sistema. AlignUSER [20] propone world models
impulsados por LLM para simular el comportamiento del usuario y evaluar sistemas de
recomendación antes del despliegue en producción. Este trabajo aborda las limitaciones de la
evaluación off-policy con datos de producción mediante el uso de un **simulador con ground-truth
conocido**: al generar usuarios sintéticos con estado latente conocido (gustos multimodales,
destinatarios, sensibilidad al precio, grafo de complementariedad) y comportamiento generativo
calibrado, las métricas de evaluación offline son comparables entre familias de métodos sin el
sesgo de exposición del sistema real. El simulador no reemplaza la evaluación online, pero
permite falsificar hipótesis de forma controlada y es coherente con las tendencias de simulación
descritas en la literatura de world models para recomendación.

---

## Síntesis

Ninguno de los trabajos revisados combina simultáneamente los cuatro componentes del pipeline
de esta tesis: representación multi-vector con eje destinatario/regalo, co-ocurrencia NPMI
como fuente de candidatos cross-sell, reranking sobre un pool amplio comparando cuatro
familias, y ranking multi-objetivo con frontera de Pareto explícita entre relevancia y revenue.
Más importante: ninguno los evalúa en un sistema real con restricciones de coste (sin GPU,
sin créditos ilimitados de LLM) y reporta los hallazgos negativos —que los embeddings no
capturan complementariedad, que el reranker LLM no supera al RRF— con la misma honestidad
que los positivos. Esos hallazgos negativos son parte de la contribución.

---

## Referencias

[1] Pal, A. et al. "PinnerSage: Multi-Modal User Embedding Framework for Recommendations at
Pinterest." *KDD*, 2020.

[2] Li, C. et al. "Multi-Interest Network with Dynamic Routing for Recommendation at Tmall
(MIND)." *CIKM*, 2019.

[3] Pinterest Engineering. "Modeling Implicit and Explicit User Interests at Pinterest."
*KDD*, 2025.

[4] Yi, X. et al. "Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations
(two-tower con corrección logQ)." *RecSys*, 2019.

[5] Barkan, O. and Koenigstein, N. "Item2Vec: Neural Item Embedding for Collaborative
Filtering (Prod2Vec)." *MLSP*, 2016.

[6] Santhanam, K. et al. "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late
Interaction." *NAACL*, 2022. Incluye extensión multilingüe Jina-ColBERT-v2.

[7] Voyage AI. "`voyage-context-3`: Contextualized chunk embeddings." Documentación técnica,
2024.

[8] Cormack, G. V., Clarke, C. L. A. and Buettcher, S. "Reciprocal Rank Fusion Outperforms
Condorcet and Individual Rank Learning Methods." *SIGIR*, 2009.

[9] Carbonell, J. and Goldstein, J. "The Use of MMR, Diversity-Based Reranking for Reordering
Documents and Producing Summaries." *SIGIR*, 1998.

[10] Church, K. W. and Hanks, P. "Word Association Norms, Mutual Information, and Lexicography."
*Computational Linguistics*, 1990. Fundamento estadístico del NPMI aplicado a co-ocurrencia
de productos.

[11] Sun, W. et al. "Is ChatGPT Good at Search? Investigating Large Language Models as
Re-Ranking Agents (RankGPT)." *EMNLP*, 2023.

[12] "LLM4Rerank: Large Language Models as Rerankers." *WWW*, 2025.

[13] "REARANK: Reasoning-Enhanced Listwise Reranking." Preprint, 2025.

[14] Ehrgott, M. *Multicriteria Optimization*. Springer, 2005. Marco teórico de la frontera
de Pareto aplicado a ranking multi-objetivo.

[15] Airbnb Engineering. "Constrained Multi-Objective Optimization for Ranking."
Blog técnico / conferencia, 2024.

[16] "Multi-Objective Ranking via Distillation from Specialized Rankers (MOO-by-distillation)."
Preprint, 2024.

[17] Yue, Y. and Joachims, T. "Interactively Optimizing Information Retrieval Systems as a
Dueling Bandits Problem." *ICML*, 2009. Base teórica para bandits de diversidad en
recomendación.

[18] Saito, Y. "nDCG as an Off-Policy Evaluation Metric." *RecSys*, 2023.

[19] "Off-Policy Evaluation of Candidate Generators in Recommender Systems." *RecSys*, 2025.

[20] "AlignUSER: World Models with LLM for User Simulation in Recommendation." Preprint, 2026.
