# Plan de piloto A/B (diseño, no ejecutado)

> **Nota de alcance.** Este capítulo diseña un experimento controlado para
> validar en producción las contribuciones del programa de tesis F1--F4.
> El piloto **no ha sido ejecutado**: los datos de tráfico real, las tasas de
> conversión y los tamaños de efecto sobre métricas de negocio son,
> a la fecha de este escrito, desconocidos. Lo que sigue es un protocolo
> experimental —hipótesis, diseño de asignación, KPIs, guardrails y fases de
> rollout— cuya ejecución constituye el horizonte natural del trabajo futuro
> descrito en el capítulo anterior.

---

## Justificación: por qué el piloto es la validación que falta

El programa de tesis F1--F4 operó íntegramente sobre un simulador de marketplace
con verdad de fondo conocida y un arnés de evaluación con holdout temporal.
Esta configuración permite controlar variables y aislar efectos con precisión
difícil de alcanzar en sistemas de producción, pero introduce una amenaza de
validez que ningún resultado offline puede disipar: los datos son sintéticos.
Las distribuciones de popularidad, los patrones de compra conjunta y los
perfiles de usuario fueron generados por un modelo probabilístico, no observados
en el comportamiento de compradores reales.

El piloto A/B en producción es, por tanto, la única forma de cerrar este ciclo.
Tres hallazgos del programa offline motivan específicamente el diseño del experimento:

1. **El pool multi-fuente aproximadamente duplica el recall de candidatos**
   (de 0.410 a 0.839) respecto al retriever coseno de F2. Si este efecto se
   replica en producción, las listas de feed serán cualitativamente distintas,
   con mayor presencia de complementos y de ítems de cola larga.

2. **El trade-off de F4 es real y graduable.** El punto knee min-max (`cfg8`,
   $\lambda_{\text{rel}} = 1,\ \lambda_{\text{rev}} = 0.5$) obtiene $+63.3\%$
   de `revenue@10` respecto al baseline RRF con una caída de $-59.8\%$ en
   `nDCG@10` sobre datos sintéticos. El impacto de esa caída de relevancia sobre
   el comportamiento real de compra —¿cuánto engagement pierde el usuario?
   ¿se compensa con el incremento de revenue?— es una pregunta empírica que sólo
   el piloto puede responder.

3. **El detector de regalo es imperfecto** (precisión $\approx 0.43$, F1 $\approx
   0.41$). En producción, la señal demográfica puede complementarse con señales
   de comportamiento en sesión (consultas de búsqueda, hora del día, duración de
   la sesión) que el simulador no genera. El piloto permite observar si la ganancia
   del vector efímero de destinatario —$\approx 5\text{--}12\times$ en `nDCG@10`
   sobre segmentos de regalo en el estudio offline— se transfiere al entorno real
   pese a los errores del detector.

---

## Qué se promueve a producción bajo feature flags

Las cuatro contribuciones del programa de tesis se agrupan en un único tratamiento
para el piloto. Todas ellas viven en `src/sectors/d-personalization/` y se
activarán mediante feature flags independientes, lo que permite tanto el rollout
gradual como la desactivación selectiva ante un guardrail cruzado.

### FF-1: espacio de retrieval `e2_hybrid`

El retrieval coseno en producción usa actualmente `e1_prod2vec` como único espacio.
`e2_hybrid` fusiona las puntuaciones de texto (Voyage AI, 1024 dimensiones) y
comportamental (`e1_prod2vec`, 64 dimensiones), sin reentrenamiento conjunto,
operando sobre puntuaciones normalizadas para evitar que la mayor dimensionalidad
del espacio textual domine la similitud resultante. F1 sitúa `e2_hybrid` como el
espacio con mayor `nDCG@10` y `Recall@10` entre los seis evaluados. Su adopción
amplía la cobertura semántica del retriever al coste de una llamada adicional al
índice de texto.

### FF-2: representación multi-vector del usuario con vector efímero de destinatario

La representación de usuario se eleva de un vector único a una distribución de
medoides (clustering aglomerativo coseno sobre el historial, con el número de
modos emergiendo de los datos). Para sesiones detectadas como regalo, el sistema
construye un vector efímero de destinatario —calculado únicamente a partir de
los ítems de la sesión corriente en curso y desechado al concluirla— sin alterar
el perfil permanente del comprador. Ante baja confianza en la detección de regalo
(score heurístico inferior a un umbral configurable), el sistema degrada
graciosamente a modo de autoconsumo (`self-mode`), evitando que los errores de
clasificación contaminen el feed.

### FF-3: pool de candidatos multi-fuente vía RRF

El pool de candidatos se amplía de los 30 ítems top-coseno actuales a un pool
de 200 ítems producido por la fusión RRF de cuatro fuentes:

- Retrieval por similitud coseno en `e2_hybrid` (80 candidatos).
- Co-ocurrencia NPMI del último ítem observado (complementos de compra conjunta).
- Popularidad por cohorte demográfica (red de seguridad para historiales cortos).
- Exploración aleatoria sembrada (diversidad y cobertura de cola larga).

La fusión RRF garantiza que ninguna fuente domine completamente la composición
del pool. El coste adicional de recuperación por las fuentes NPMI y de popularidad
es local (tablas en base de datos, sin llamadas externas al agregador), por lo
que no incrementa el costo por solicitud de los aggregadores de catálogo.

### FF-4: reranking en el punto knee de la frontera multi-objetivo

El reranker multi-objetivo opera con la configuración `cfg8` del barrido de F4:
$\lambda_{\text{rel}} = 1,\ \lambda_{\text{rev}} = 0.5,\ \lambda_{\text{div}} = 0$.
Este punto knee min-max fue seleccionado como el compromiso más equilibrado entre
relevancia y revenue esperado disponible en el espacio explorado por el barrido.
Se elige deliberadamente el knee y **no** el extremo de revenue máximo (`cfg18`,
$\lambda_{\text{rev}} = 1$): el trade-off de F4 muestra que maximizar revenue
en el estudio offline sacrifica el $72.4\%$ de la relevancia del baseline,
una magnitud que, trasladada a producción, previsiblemente dañaría el engagement
y la retención del usuario a medio plazo.

La estrategia de producción es conservadora por diseño: **empezar en el knee y
moverse sobre la frontera de Pareto únicamente si el engagement de largo plazo
aguanta**. Si el piloto muestra que el engagement (profundidad de sesión, CTR)
se mantiene estable o mejora, el ajuste posterior del peso $\lambda_{\text{rev}}$
puede delegarse a un bandit contextual (línea de trabajo futuro descrita en el
capítulo anterior), sin necesidad de reentrenamiento global del sistema.

---

## Diseño experimental

### Condiciones del experimento

El piloto compara dos condiciones:

- **Condición A (control):** el pipeline actual en producción. Retrieval coseno
  sobre `e1_prod2vec`, representación de usuario con vector único, pool de 30
  candidatos, ranking por relevancia/RRF sin ponderación de objetivos de negocio.

- **Condición B (tratamiento):** el pipeline completo de las contribuciones F1--F4,
  activado mediante los cuatro feature flags descritos en la sección anterior.
  Espacio `e2_hybrid`, representación multi-vector con vector efímero de destinatario
  (con degradación graceful ante baja confianza), pool multi-fuente de 200 ítems
  vía RRF, y reranking en el punto knee ($\lambda_{\text{rel}} = 1,\
  \lambda_{\text{rev}} = 0.5$).

### Unidad de asignación y estratificación

La unidad de asignación es el **usuario** (no la sesión ni la solicitud). La
asignación a control o tratamiento se realiza mediante **hash determinista**
del identificador de usuario, lo que garantiza que:

(a) un mismo usuario ve siempre la misma condición durante toda la duración del
piloto, evitando la contaminación por exposición cruzada;

(b) la asignación es reproducible y auditable sin almacenar estado de
experimento por solicitud;

(c) la fracción de usuarios en cada condición es estable y no depende del orden
de llegada.

Los usuarios se estratifican por el segmento de modo de sesión —autoconsumo
(`self`) vs regalo (`gift`, según el detector con degradación graceful)— antes
de la asignación, de forma que ambas condiciones reciben proporciones equivalentes
de cada segmento. Esto es especialmente importante dado que F2 muestra efectos
cualitativamente distintos en los dos segmentos: ignorar la estratificación
podría enmascarar una ganancia real en sesiones de regalo o una regresión en
sesiones de autoconsumo.

### Métrica primaria y KPIs secundarios

La **métrica primaria** del piloto es el **revenue o GMV por sesión**: el valor
monetario bruto de las compras realizadas durante la sesión, normalizado por el
número de sesiones activas de cada condición. Esta métrica captura directamente
el objetivo de negocio del sistema: en un e-commerce reseller sin stock físico,
cada compra completada es el evento de valor real para el operador.

Los KPIs secundarios son:

- **CTR del feed** (tasa de clic sobre los ítems mostrados en la lista
  personalizada): mide si el tratamiento produce un feed que atrae la atención
  del usuario. Un CTR degradado es señal temprana de pérdida de relevancia
  percibida.

- **CVR (tasa de conversión):** fracción de sesiones con al menos una compra
  completada. Complementa el revenue por sesión: un aumento de revenue por sesión
  puede originarse en un aumento de CVR, en un aumento del ticket medio, o en
  ambos; distinguirlos orienta la interpretación.

- **Profundidad de sesión** (número de páginas de feed vistas por sesión): proxy
  de engagement. Una caída de profundidad en el tratamiento indicaría que el
  usuario encuentra lo que busca más rápido (señal positiva) o que abandona el
  feed antes de convertir (señal negativa); debe leerse junto con el CTR y el CVR.

- **Tasa de uso del fallback del reranker LLM:** fracción de solicitudes en que el
  reranker LLM no puede completar el reranking y recurre al orden de entrada como
  fallback. Un incremento de esta tasa en el tratamiento señala degradación de
  disponibilidad del reranker o prompts que superan el límite de contexto,
  y activa la revisión del módulo antes de escalar.

El análisis de KPIs se desagregará por segmento `self` vs `gift` para detectar
si el tratamiento beneficia a un segmento a expensas del otro.

### Cálculo del tamaño muestral

No disponemos, a la fecha de este diseño, de estimaciones de tráfico real para
el sistema en producción. Por tanto, no se especifican números concretos de
usuarios o semanas. En su lugar, se describe el **procedimiento de cálculo**
que deberá ejecutarse con los datos de tráfico reales antes de iniciar el piloto:

1. **Definir el MDE (Minimum Detectable Effect).** El equipo debe acordar el
   efecto mínimo en revenue por sesión que justifica adoptar el tratamiento —por
   ejemplo, un incremento relativo de $X\%$ sobre la media de control. El MDE
   debe ser clínicamente relevante para el negocio, no arbitrariamente pequeño.

2. **Estimar la varianza de la métrica primaria.** Con datos históricos de
   revenue por sesión en producción, calcular la desviación estándar $\sigma$
   de la distribución. El revenue por sesión en e-commerce tiene típicamente
   una distribución de cola pesada (muchas sesiones sin compra, pocas con compras
   de alto valor); puede ser necesario aplicar una transformación logarítmica o
   usar un test no paramétrico.

3. **Aplicar la fórmula estándar de potencia.** Para un test bilateral con
   nivel de significación $\alpha = 0.05$ y potencia $1 - \beta = 0.80$, el
   tamaño muestral por condición es aproximadamente:

   $$n \approx \frac{2\,(z_{1-\alpha/2} + z_{1-\beta})^2 \cdot \sigma^2}{\delta^2}$$

   donde $z_{1-\alpha/2} \approx 1.96$, $z_{1-\beta} \approx 0.84$, y $\delta$
   es el MDE en unidades absolutas de revenue por sesión.

4. **Ajustar por estratificación y CUPED.** Si se aplica la técnica CUPED
   (*Controlled-experiment Using Pre-Experiment Data*) para reducir la varianza
   usando el revenue por sesión previo al experimento como covariable, el tamaño
   muestral efectivo requerido se reduce proporcionalmente a $1 - \rho^2$, donde
   $\rho$ es la correlación entre la covariable pre-experimento y la métrica de
   experimento.

5. **Calcular la duración.** Dividir el tamaño muestral total ($2n$) entre el
   número de usuarios activos por semana para obtener la duración mínima del
   piloto. Se recomienda una duración de al menos dos semanas para capturar
   la variabilidad de días de la semana y amortiguar los efectos de novedad.

---

## Guardrails y rollback automático

Los guardrails son condiciones de parada que, si se cruzan, desencadenan el
rollback automático del tratamiento y la restauración de la condición de control
para todos los usuarios del experimento. La lógica de monitorización debe ejecutarse
con cadencia diaria durante las primeras fases del rollout y en tiempo cuasi-real
durante la fase de mayor exposición.

### Guardrail 1: caída de CTR del feed más allá de umbral

Si el CTR del feed en el tratamiento cae más de un $\Delta_{\text{CTR}}$ relativo
respecto al control (umbral a calibrar con datos de tráfico real, típicamente en
el rango del $10\text{--}15\%$ relativo), el rollback se activa. Una caída de
CTR de esta magnitud indica que el feed del tratamiento es percibido como menos
relevante por el usuario, lo que —en el contexto del trade-off de F4— sugiere
que la ponderación $\lambda_{\text{rev}} = 0.5$ es excesiva para la sensibilidad
de este segmento de usuarios. La acción de mitigación es retrogradar a
$\lambda_{\text{rev}} = 0$ (relevancia pura) antes de considerar cualquier
reexposición.

### Guardrail 2: concentración de exposición de vendedores (índice de Gini)

Si el índice de Gini de exposición de vendedores en el feed del tratamiento supera
un techo $G_{\max}$ (a establecer con datos de producción), el rollback se activa.
Este guardrail protege la equidad de exposición: el ranking multi-objetivo,
al ponderar revenue esperado, puede favorecer sistemáticamente a vendedores de
ítems de mayor margen, concentrando la exposición y degradando la diversidad del
catálogo percibida por el usuario. El objetivo $f_{\text{fair}}$ del modelo F4
actúa como mitigación dentro del scorer, pero su efectividad real en producción
debe verificarse.

### Guardrail 3: latencia `p99` del feed por encima del SLA

Si la latencia de extremo a extremo del feed en el percentil 99 supera el SLA
acordado (referenciado en el sistema como `p99`), el rollback se activa. El pool
de 200 candidatos y el reranker multi-objetivo aumentan el trabajo computacional
por solicitud respecto al pipeline actual. El diseño de las cuatro fuentes del
pool está optimizado para evitar llamadas adicionales al agregador externo
(operan sobre tablas locales), pero la latencia total depende también del
hardware de despliegue y de la carga concurrente. Si `p99` supera el SLA, el
sistema degrada a la condición de control antes de comprometer la experiencia
de usuario con tiempos de respuesta inaceptables.

### Guardrail 4: tasa de fallback del reranker LLM por encima de umbral

Si la fracción de solicitudes que activan el fallback del reranker LLM (descrito
en los KPIs secundarios) supera un umbral $\tau_{\text{fallback}}$ —indicativo de
que el modelo no puede completar el reranking para un porcentaje inaceptable de
usuarios—, el rollback se activa. Este guardrail protege tanto la experiencia de
usuario (el fallback produce un feed de menor calidad) como el costo operativo
(un reranker que falla repetidamente e intenta reenvíos incrementa el consumo de
tokens del modelo de lenguaje).

### Guardrail 5: costo del agregador por compra fuera de presupuesto

En el e-commerce reseller objeto de estudio, cada llamada al agregador de catálogo
(Amazon/AliExpress) tiene costo real. Si el costo agregado por compra completada
en el tratamiento supera el presupuesto operativo acordado —ya sea por un aumento
en el número de solicitudes de detalle de producto o por una reducción en la
tasa de conversión que eleva el costo por compra—, el rollback se activa. Este
guardrail es específico del modelo de negocio reseller y no tiene análogo directo
en sistemas de recomendación de catálogo propio.

---

## Riesgos y mitigaciones

### R1: el trade-off de F4 daña el engagement a medio plazo

**Riesgo.** El estudio offline muestra que el punto knee (`cfg8`) obtiene
$+63.3\%$ de `revenue@10` a costa de $-59.8\%$ en `nDCG@10` respecto al baseline
RRF. Si esta caída de relevancia se traduce en un deterioro del engagement sostenido
—menor CTR, menor profundidad de sesión, menor retención de usuarios a semanas
vista—, el incremento de revenue a corto plazo puede revertirse a medio plazo por
la pérdida de base de usuarios activos.

**Mitigación.** La estrategia de producción es conservadora por diseño: comenzar
en el knee ($\lambda_{\text{rev}} = 0.5$) y monitorizar el engagement semana
a semana durante el piloto. El ajuste hacia revenue mayor se realiza sólo si
los indicadores de engagement (CTR, profundidad de sesión, tasa de retorno de
usuarios) se mantienen estables o mejoran. Si el piloto confirma que el engagement
aguanta, el ajuste posterior de $\lambda$ puede delegarse a un bandit contextual
que optimice por usuario, personalizando el trade-off en lugar de aplicar un
peso uniforme a toda la base. En ningún caso se debe mover $\lambda$ hacia el
extremo de revenue máximo (`cfg18`) sin evidencia explícita de que el engagement
no se degrada.

### R2: el detector de regalo introduce ruido en producción

**Riesgo.** El detector heurístico de sesiones de regalo alcanza una precisión
de $\approx 0.43$ en el estudio offline, lo que significa que activa el vector
efímero de destinatario en aproximadamente el doble de sesiones que lo necesitan
realmente. En producción, las sesiones de autoconsumo erróneamente clasificadas
como regalo recibirán un feed orientado a un destinatario inexistente, con
potencial daño en el CTR y la conversión de ese segmento.

**Mitigación.** El sistema implementa degradación graceful: ante un score de
confianza de detección inferior a un umbral configurable, el pipeline opera en
modo `self` en lugar de activar el vector efímero. El umbral se inicializa de
forma conservadora (alta precisión, menor recall) y puede relajarse a medida que
el piloto proporciona datos de calibración real. El guardrail de CTR del feed
actuará como señal temprana si el detector introduce suficiente ruido como para
dañar el engagement.

### R3: validez externa limitada — sintético $\neq$ real

**Riesgo.** Los resultados cuantitativos del programa offline (tasas de recall,
valores de `nDCG@10`, incrementos de `revenue@10`) fueron medidos sobre datos
sintéticos con distribuciones de popularidad y patrones de co-ocurrencia
controlados. Las distribuciones reales de comportamiento de usuario pueden
diferir cualitativamente: la cola larga puede ser más larga, los patrones de
regalo pueden ser estacionales, y la distribución de revenue por sesión puede
tener una asimetría más severa que la simulada.

**Mitigación.** El piloto A/B es precisamente la validación externa que falta.
Los resultados offline se utilizan únicamente para motivar el diseño
experimental y calibrar el MDE, no para predecir resultados en producción.
Las conclusiones cualitativas del programa —la multi-vectorialidad ayuda en
sesiones de regalo, el pool multi-fuente amplía el recall, el trade-off
relevancia-revenue es real y graduable— son las hipótesis que el piloto pone
a prueba; sus valores cuantitativos específicos no se asumen como predicción.

---

## Rollout por fases

El despliegue del tratamiento se realiza en cuatro fases secuenciales. El avance
entre fases requiere la verificación explícita de que ningún guardrail ha sido
cruzado durante la fase anterior.

### Fase 0: modo sombra (*shadow mode*)

El pipeline de tratamiento se despliega en paralelo al de control, computando
las listas de candidatos, el pool multi-fuente y el reranking multi-objetivo para
todos los usuarios, pero **sin servir los resultados al usuario final**. Los
resultados del tratamiento se registran en un log de sombra para análisis offline.

El objetivo de esta fase es verificar:

- Que el pipeline completo (FF-1 a FF-4 activados) se ejecuta sin errores de
  producción en todos los segmentos de usuario.
- Que la latencia `p99` del tratamiento se mantiene dentro del SLA antes de
  exponer al usuario real.
- Que la tasa de fallback del reranker LLM es inferior al umbral $\tau_{\text{fallback}}$.
- Que el costo de las fuentes adicionales del pool (NPMI, popularidad por cohorte)
  no genera llamadas no previstas al agregador externo.

La fase sombra no requiere usuarios de tratamiento y puede ejecutarse sobre el
100\% del tráfico existente. Su duración mínima es de 48 horas en condiciones
de tráfico representativas.

### Fase 1: exposición al 5\% de usuarios

Los feature flags se activan para el $5\%$ de la base de usuarios, asignados
por hash determinista. El restante $95\%$ permanece en control.

En esta fase se verifican los guardrails de CTR, Gini y `p99` con mayor sensibilidad
(umbral de rollback más conservador) para detectar problemas sistémicos con
mínima exposición. La duración mínima es de una semana para capturar la
variabilidad de días laborables vs fin de semana. Al final de la semana, se
realiza una revisión de los cinco guardrails antes de proceder a la siguiente
fase.

### Fase 2: exposición al 25\% de usuarios

Si la fase 1 concluye sin guardrails cruzados, la exposición se eleva al $25\%$
de usuarios. En esta fase el tamaño muestral comienza a ser suficiente para
detectar efectos de magnitud moderada en la métrica primaria de revenue por
sesión, lo que permite una primera evaluación estadística provisional.

La duración mínima es de dos semanas. Al final de esta fase se realiza el cálculo
de potencia retrospectivo: si el efecto observado ya supera el MDE definido con
potencia $1 - \beta \geq 0.80$, el equipo puede decidir acelerar el rollout;
si el efecto es negativo y estadísticamente significativo, el rollback se activa.

### Fase 3: rollout al 100\% de usuarios

Si la fase 2 concluye sin guardrails cruzados y con un efecto no negativo en
la métrica primaria, el tratamiento se despliega al $100\%$ de la base de usuarios.
En este punto los feature flags dejan de ser flags de experimento y pasan a ser
la configuración de producción por defecto.

El período de observación post-rollout completo tiene una duración mínima de
dos semanas adicionales para verificar la estabilidad de los indicadores a medida
que el volumen de tráfico en el tratamiento alcanza su máximo. La infraestructura
de guardrails permanece activa durante todo este período.

---

## Resumen del protocolo

La tabla siguiente recoge los elementos esenciales del diseño del piloto en
formato compacto para referencia rápida.

| Elemento | Valor o criterio |
|---|---|
| Unidad de asignación | Usuario (hash determinista) |
| Condición de control | Pipeline actual (single-vector, top-30, RRF-only) |
| Condición de tratamiento | F1--F4: `e2_hybrid` + multi-vector + pool-200 + knee $\lambda$ |
| Métrica primaria | Revenue / GMV por sesión |
| Nivel de significación | $\alpha = 0.05$ (bilateral) |
| Potencia objetivo | $1 - \beta = 0.80$ |
| Estratificación | `self` vs `gift` (pre-asignación) |
| Duración mínima por fase | 48 h (sombra), 1 semana (5\%), 2 semanas (25\%) |
| Guardrails de rollback | CTR, Gini vendedores, `p99` latencia, fallback LLM, costo por compra |
| Punto de operación F4 | knee min-max `cfg8` ($\lambda_{\text{rel}} = 1,\ \lambda_{\text{rev}} = 0.5$) |
| Ajuste posterior de $\lambda$ | Bandit contextual, sólo si engagement aguanta |
