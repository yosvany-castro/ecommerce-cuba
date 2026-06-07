# Discusión

Este capítulo integra los hallazgos de los cuatro factores (F1--F4) del programa
de tesis en una lectura transversal. El objetivo es doble: identificar los
patrones que atraviesan múltiples fases y extraer las lecciones de diseño que
trascienden cada experimento individual. Se dedica una sección prominente a los
hallazgos negativos, que tienen valor epistémico igual o superior a los
positivos. Se cierran con las limitaciones del enfoque y las amenazas a la
validez interna y externa.

## Qué funcionó: convergencia entre fases

### Los embeddings comportamentales son la capa correcta para relevancia

F1 estableció que los embeddings entrenados sobre co-compras superan al texto
puro en recuperación de relevancia, con una ratio de $\approx 2.7\times$ en `nDCG@10`
para `e1_prod2vec` y $\approx 3.3\times$ para la fusión híbrida `e2_hybrid`. La fusión híbrida `e2_hybrid` —que combina el espacio Voyage de
texto (1024 dimensiones) y el espacio Prod2Vec comportamental (64 dimensiones)
mediante fusión de score— demostró que la señal comportamental no sustituye a
la textual sino que la complementa: el híbrido supera a ambos componentes por
separado. Esta complementariedad persiste a lo largo de todo el programa: el
espacio `e1_prod2vec` se convierte en la fuente de relevancia de referencia en
F2, F3 y F4, y sus límites —concretamente, su incapacidad para capturar
complementariedad— motivan directamente la segunda fuente NPMI del pool de F3.

El resultado de F1 responde a una pregunta que el pipeline original no podía
responder: ¿qué tipo de señal captura mejor la preferencia del usuario en un
catálogo de reventa sin historial de búsqueda explícita? La respuesta es
inequívoca: la geometría del espacio de co-compra es más cercana a la
preferencia declarada que la semántica del título del producto.

### La representación multi-vector del usuario, especialmente en el segmento de regalo

F2 mostró que modelar al usuario como distribución de intereses (múltiples
medoides en el espacio `e1_prod2vec`) supera al vector único en todos los
segmentos evaluados. La ganancia global es de aproximadamente el 51\% relativo
en `nDCG@10`. La lección más nítida es la asimetría del efecto según el tipo
de sesión: en autoconsumo con intereses unimodales el beneficio existe pero es
moderado; en sesiones de regalo la diferencia es cualitativa. Con el vector
único de comprador, el `nDCG@10` en el peor segmento de regalo cae a valores
cercanos a cero; el vector efímero de destinatario lo eleva en un factor
de aproximadamente $12\times$.

Esta asimetría tiene una interpretación arquitectónica directa: la
representación multi-vector con modelo de regalo no es una optimización
marginal sobre el vector único, sino una bifurcación de paradigma. El vector
único asume que todos los ítems adquiridos revelan la preferencia futura del
comprador; el modelo de F2 separa las compras de autoconsumo —que deben
alimentar el perfil permanente— de las compras para un tercero, que solo
deberían activarse durante la sesión en curso. La separación entre perfil
del comprador y vector efímero de destinatario es una decisión de diseño
justificada empíricamente, no una complejidad añadida sin respaldo.

### El pool multi-fuente aproximadamente duplica el recall de candidatos

F3 demostró que la ganancia principal del factor reside en el pool de
candidatos, no en el reranker. El paso de un pool de 30 candidatos (top-30
coseno de F2) a un pool multi-fuente de 200 candidatos —construido con cuatro
fuentes fusionadas por RRF— eleva el recall del pool de 0.410 a 0.839: ~2$\times$
más compras futuras cubiertas. La consecuencia práctica es directa: el 84\% de
las compras que el usuario realizará ya están disponibles en el pool para que
el reranker las eleve, frente al 41\% de F2. Este porcentaje es el techo real
de cualquier reranker sobre ese pool; elevar el techo tiene más impacto que
mejorar el reranker dentro del techo existente.

La fuente NPMI mereció atención especial: en un test de discriminación sobre
casos de regalo con verdad de fondo conocida, recuperó siete complementos
que la similitud coseno no encontró en absoluto. Esta evidencia puntual
confirma la premisa arquitectónica establecida en F1: la complementariedad
de compra es una señal ortogonal a la similitud semántica, y las dos fuentes
deben coexistir en el pool.

### La frontera de Pareto hace explícito el trade-off de negocio

F4 demostró que el ranking multi-objetivo, formulado como combinación lineal
convexa $s(p \mid u) = \sum_k \lambda_k \cdot f_k(p, u)$, permite al operador
navegar explícitamente la tensión entre relevancia y revenue. La frontera de
Pareto sobre las 24 configuraciones evaluadas es genuina: 23/24 son no
dominadas cuando se consideran los cuatro objetivos simultáneamente, lo que
indica que no existe una configuración que gane en todo. El dial $\lambda$
funciona: incrementar $\lambda_{\text{rev}}$ de 0 a 0.5 y de 0.5 a 1 produce
incrementos sistemáticos en `revenue@10` a costa de decrementos sistemáticos
en `nDCG@10`.

El valor de este hallazgo no está en los números absolutos —que dependen de
los precios y márgenes sintéticos del simulador— sino en la lección
arquitectónica: la frontera de Pareto convierte una decisión implícita (el
pipeline de relevancia pura ya toma una posición tácita de
$\lambda_{\text{rev}} = 0$) en una decisión explícita y ajustable por el
operador sin reentrenamiento. Esta es la contribución de F4 a la práctica
del sistema.

---

## Los hallazgos negativos como contribución científica

Los resultados negativos de este programa son, en conjunto, tan informativos
como los positivos. Cada uno de ellos delimita el alcance de una técnica y
señala dónde debe invertirse el esfuerzo en lugar de dónde ya se invirtió.
Esta sección los recoge sin atenuación, argumentando por qué merecen
protagonismo propio.

### Los embeddings no recuperan complementos (F1)

La columna `complement-recall@10` del experimento F1 es prácticamente cero
para los seis espacios vectoriales evaluados, incluyendo los comportamentales.
Un ítem complementario —la alfombrilla del ratón, la funda del teléfono, la
pila del mando— no aparece en el top-10 de ningún retriever de similitud
vectorial, independientemente de si ese retriever fue entrenado sobre texto o
sobre co-compras.

Este resultado negativo delimitó la arquitectura de todo lo que siguió. Si
el coseno no captura complementariedad, la solución no es mejorar el embedding
sino introducir una fuente de señal diferente: la co-ocurrencia de compra
cuantificada por NPMI. El hallazgo negativo de F1 es la justificación directa
de la segunda fuente del pool de F3, que recuperó siete complementos donde la
similitud coseno recuperó cero. Sin ese resultado negativo honestamente
reportado, la arquitectura multi-fuente carecería de motivación empírica y
habría que aceptarla por argumento de autoridad.

La lección general es que los embeddings son la herramienta correcta para
relevancia y descubrimiento, pero no para cross-sell. El cross-sell vive en
el grafo de co-ocurrencia o en puntuaciones NPMI sobre pares de productos, no
en el espacio vectorial de similitud. La claridad de esta separación
arquitectónica es consecuencia directa del hallazgo negativo.

### Ningún reranker supera a la fusión RRF en relevancia pura (F3)

El hallazgo negativo central de F3 es que el orden de relevancia producido
por la propia fusión RRF —el mecanismo que construye el pool— es el mejor
ranker disponible en el experimento, con `nDCG@10` = 0.177. Todos los
rerankers evaluados (LTR, MMR, cross-encoder MaxSim y LLM listwise con
DeepSeek) quedan por debajo de ese umbral. El LLM listwise alcanza `nDCG@10`
= 0.170, virtualmente idéntico al baseline RRF, pero sin mejora neta.

Este hallazgo es contraintuitivo: la intuición general en la literatura de
recuperación es que un reranker más sofisticado produce resultados superiores.
La explicación en este caso particular es que el pool de candidatos ya integra
señales de cuatro fuentes complementarias, y el orden RRF resultante agrega
esa información de forma que los rerankers evaluados no pueden mejorar. El
`retrievalScore` domina los pesos del modelo LTR (peso 6.82 frente a 0.29 de
`npmiScore`), lo que indica que el modelo aprendido delega en la puntuación RRF
del pool, replicando aproximadamente al baseline.

La implicación para el diseño futuro es que el esfuerzo no debe dirigirse a
rerankers de relevancia más sofisticados —el techo del pool ya es alto— sino
a rerankers orientados a objetivos secundarios: diversidad, revenue, novedad,
equidad de vendedores. En ese dominio, los rerankers sí tienen espacio para
diferenciarse, como demuestra el `set-change@10` de 0.821 del cross-encoder:
los ítems que propone son cualitativamente distintos a los del baseline RRF,
aunque su relevancia posicional sea inferior.

### El guardrail de relevancia de F4 es infactible: 0/24 configuraciones

El protocolo experimental de F4 definía un guardrail de relevancia:
$\text{nDCG@10} \geq 0.7 \times \text{base} = 0.141$, pensado para garantizar
que ningún punto de operación sacrificara más del 30\% de la relevancia del
baseline. El guardrail resultó infactible: ninguna de las 24 configuraciones
del barrido de $\lambda$ lo satisface. La mejor configuración en relevancia pura
(`cfg0`, $\lambda_{\text{rev}} = 0$) obtiene `nDCG@10` = 0.107, por debajo del
umbral de 0.141.

Este resultado tiene dos capas que deben distinguirse para leerlo correctamente.

La primera capa es el hallazgo genuino sobre el trade-off: el mecanismo de
ponderación $\lambda$ es eficaz para aumentar revenue pero no puede hacerlo sin
coste de relevancia, y el coste es alto dentro del espacio de búsqueda
explorado. Este es un hallazgo real y útil: cualquier despliegue en producción
debe asumir que mover el dial hacia revenue tiene consecuencias apreciables en
la calidad de las listas.

La segunda capa es el caveat de atribución. La caída de relevancia observada
entre el baseline RRF (0.202) y la mejor configuración en relevancia pura
(`cfg0`, 0.107) —una brecha del $-47.1\%$— no es atribuible al objetivo revenue
sino a un desajuste de baseline: el baseline F3-RRF fusiona cuatro fuentes de
señal, mientras que el feature de relevancia del scorer multi-objetivo
($f_{\text{rel}}$) usa únicamente similitud coseno en el espacio `e1_prod2vec`,
aproximadamente equivalente a una sola fuente. El scorer mono-señal ya cede
relevancia al baseline multi-señal antes de incorporar revenue.

Este conflato entre trade-off real y desajuste de baseline no invalida el
hallazgo central —el dial de revenue funciona y la frontera de Pareto es
genuina— pero sí sobreestima el coste del trade-off. Una medición más honesta
requeriría que $f_{\text{rel}}$ integrara las mismas señales que el baseline
RRF (NPMI, popularidad por cohorte), de modo que la comparación sea entre
configuraciones equivalentes en información disponible. Esa corrección queda
como trabajo futuro.

El hallazgo negativo aquí no es un fracaso técnico sino una advertencia
metodológica: el diseño del baseline de comparación determina la magnitud
atribuida al trade-off, y la comparación solo es justa cuando ambos extremos
usan la misma información de base.

### Por qué los negativos son tan valiosos como los positivos

Estos tres hallazgos negativos —`complement-recall@10` $\approx$ 0 en todos los
espacios, ningún reranker supera a RRF en relevancia, guardrail infactible con
caveat de atribución— tienen en común que redirigen el esfuerzo de ingeniería
hacia donde sí existe potencial de mejora. La complementariedad de compra
exige co-ocurrencia o NPMI, no embeddings más potentes. El techo de relevancia
del pool exige ampliar el pool o mejorar las fuentes, no añadir rerankers más
complejos. La subestimación del feature de relevancia en F4 exige incorporar
señales multi-fuente al scorer antes de interpretar la magnitud del trade-off
como un hecho definitivo.

Sin estos hallazgos negativos, los recursos de desarrollo tenderían
erróneamente hacia embeddings con mayor dimensionalidad, rerankers LLM más
caros o guardrails con umbrales más permisivos. Con ellos, el diseño puede
tomar decisiones informadas: invertir en NPMI para cross-sell, ampliar el
pool para relevancia, y enriquecer el feature de relevancia para una
evaluación justa del trade-off en F4.

---

## Limitaciones del enfoque

### Dataset sintético: validez externa pendiente

Todos los experimentos operan sobre un simulador de marketplace con verdad de
fondo conocida. La ventaja es metodológica: las preferencias latentes del
usuario, las relaciones de complementariedad y la compra holdout son generadas
por el sistema y conocidas de antemano, lo que permite medir el lift de cada
componente sin confusión con sesgos de exposición o popularidad. La desventaja
es la misma: los resultados son válidos para el simulador, y su transferibilidad
a tráfico de producción real es una hipótesis no validada.

En particular, el simulador podría asignar señales más limpias a los
complementos NPMI y a las sesiones de regalo que las que existirían en un
dataset de sesiones reales, donde la intención del usuario es ruidosa y los
patrones de co-compra son más dispersos. El cross-check sobre un dataset
público de sesiones reales (`thesis:public`) está diseñado pero no ejecutado:
es el siguiente paso natural para evaluar la robustez de los hallazgos.

### El detector de regalo es heurístico con precisión imperfecta

La detección de sesiones de regalo en F2 es heurística: utiliza coherencia
demográfica entre los ítems de la sesión corriente y la cohorte del comprador,
sin señal explícita del usuario. Su precisión es ~0.43, con recall de 0.387
y F1 de 0.407. Esto significa que aproximadamente el 57\% de las activaciones
del vector efímero corresponden a sesiones que no son de regalo (falsos
positivos), y el detector no detecta el 61\% de las sesiones que sí lo son
(falsos negativos).

Las consecuencias son asimétricas: los falsos positivos introducen ruido en
sesiones de autoconsumo —activando el vector efímero cuando no debería— y los
falsos negativos degradan la calidad de las sesiones de regalo al no activarlo
cuando sí debería. La ganancia medida en F2 sobre `nDCG@10` y `recipient-fit@10`
es el efecto neto del modelo completo incluyendo sus errores de clasificación.
El beneficio de la representación multi-vector es posiblemente mayor de lo que
los números indican; el modelo de regalo podría extraer más valor con un
detector más preciso, por ejemplo entrenado sobre señales explícitas del usuario
o con inferencia demográfica supervisada.

### El baseline de relevancia de F4 usa una única señal

El feature de relevancia del scorer multi-objetivo en F4 ($f_{\text{rel}}$)
es la similitud coseno al espacio `e1_prod2vec`, equivalente a una sola fuente
de las cuatro que componen el baseline RRF. Esta asimetría introduce un
desajuste estructural: el baseline tiene acceso a más información de
relevancia que el scorer, lo que hace que la caída de `nDCG@10` observada al
introducir objetivos de revenue esté parcialmente inflada por ese desajuste y
no sea íntegramente atribuible al trade-off. La magnitud real del trade-off
relevancia $\leftrightarrow$ revenue requiere una medición con baseline y scorer
equivalentes en información, lo que no está implementado en este estudio.

### Costo y latencia del reranker LLM listwise

El reranker LLM listwise (DeepSeek) operó sobre un subconjunto de 120 casos
por razones de costo y latencia. La evaluación limitada introduce incertidumbre
estadística sobre sus resultados, aunque los hallazgos cualitativos son
consistentes con los del resto de rerankers. La escalabilidad del reranker LLM
a la totalidad del catálogo (1998 ítems, pool de 200) en tiempo de respuesta
compatible con producción no ha sido medida. Su costo por consulta en producción
real dependería de la disponibilidad y precio del proveedor LLM, una variable
económica externa al diseño del sistema.

### Escala del estudio

El universo del estudio es de aproximadamente 2000 productos y 1100 casos de
evaluación. Esta escala es suficiente para detectar diferencias de calidad
estadísticamente robustas entre métodos, pero es pequeña respecto a catálogos
de producción reales que pueden contener cientos de miles de ítems. Los efectos
de escala —costos de indexación, latencia de retrieval, dispersión de
co-ocurrencias NPMI en catálogos grandes— no han sido evaluados y constituyen
una incertidumbre de transferibilidad.

---

## Amenazas a la validez y mitigaciones

### Amenaza 1: el ground-truth sintético podría favorecer ciertos métodos

El simulador genera las preferencias latentes del usuario y las relaciones de
complementariedad. Si las reglas de generación son consistentes con los
supuestos de los métodos evaluados —por ejemplo, si la co-ocurrencia NPMI
del simulador está diseñada para ser recuperable por el grafo de co-compra—
el experimento podría sobreestimar la ventaja de los métodos que usan NPMI
respecto a métodos alternativos que no dispusieran de esa señal.

Las mitigaciones adoptadas son: las reglas del simulador fueron definidas
antes de medir cualquier resultado (protocolo de pre-registro implícito);
las comparaciones se realizan mediante ablations controladas donde todos los
métodos comparten el mismo universo de ítems y los mismos casos de evaluación;
y el cross-check sobre un dataset público de sesiones reales (`thesis:public`)
está previsto como test de robustez externo. Hasta que ese cross-check no se
ejecute, la amenaza permanece abierta.

### Amenaza 2: mezcla de escalas entre fases

F0 operó sobre aproximadamente 400 usuarios; F1--F4 operan sobre el universo
de 1999 ítems con 1098--1107 casos de evaluación. Mezclar estas escalas en una
tabla comparativa produciría comparaciones sin sentido. La mitigación fue no
hacerlo: cada fase se compara internamente, y cuando se hace referencia a fases
anteriores se indica explícitamente la escala y el espacio de ítems
correspondiente.

### Amenaza 3: variabilidad por semilla

Los experimentos deterministas (semilla 42 en F4, siembra del simulador
en todas las fases) garantizan reproducibilidad exacta de los resultados, pero
una única semilla no permite cuantificar la varianza de las métricas bajo
distintas realizaciones del generador. La variabilidad real de los resultados
ante distintas configuraciones del simulador es una incertidumbre no resuelta.
Su mitigación parcial es que las conclusiones cualitativas son robustas a
pequeñas variaciones en las métricas; las conclusiones cuantitativas exactas
deben leerse con la reserva de que corresponden a una única realización.
