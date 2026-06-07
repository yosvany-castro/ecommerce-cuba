# Ranking multi-objetivo (F4)

## Motivación: del ranking de relevancia a la negociación de objetivos

El pipeline que F3 construyó es eficaz para maximizar relevancia percibida,
medida por `nDCG@10`. Sin embargo, un e-commerce reseller no maximiza relevancia
en abstracto: maximiza revenue, custodia la diversidad de su catálogo, cuida la
equidad entre vendedores y gestiona la novedad para evitar que el usuario vea
siempre los mismos ítems. Estos objetivos no son idénticos y con frecuencia
compiten: elevar un ítem de alto precio y margen puede desplazar a un ítem más
pertinente para el historial de compra del usuario.

F4 responde a esta tensión con un modelo de ranking multi-objetivo: el score
final de cada ítem $p$ para el usuario $u$ es una combinación lineal convexa de
funciones de objetivo,

$$s(p \mid u) = \sum_{k} \lambda_k \cdot f_k(p, u),$$

donde cada $f_k$ representa un objetivo distinto y cada $\lambda_k$ un peso que
el operador puede ajustar. Las funciones de objetivo implementadas son:

- **Relevancia** ($f_{\text{rel}}$): similitud coseno del vector del ítem a los
  modos del usuario en el espacio `e1\_prod2vec`, la misma señal que el reranker
  de F3.
- **Revenue esperado** ($f_{\text{rev}}$): el producto
  $P(\text{compra}) \cdot \text{precio} \cdot \text{margen}$, donde la
  probabilidad de compra se aproxima por la popularidad del ítem en la cohorte
  demográfica del usuario.
- **Margen bruto** ($f_{\text{mar}}$): margen unitario del ítem, desacoplado del
  precio para penalizar ítems de bajo margen independientemente de su precio.
- **Diversidad intra-lista** ($f_{\text{div}}$): penalización de similitud media
  al conjunto ya seleccionado, que promueve cobertura de categorías.
- **Equidad de vendedores** ($f_{\text{fair}}$): señal inversa al índice de Gini
  de vendedores en la lista emergente, que redistribuye exposición.

La búsqueda de la configuración óptima de $\lambda$ se realiza mediante un barrido
de grilla ($\lambda_{\text{rel}} = 1$ fijo; $\lambda_{\text{rev}} \in \{0,\,0.5,\,1\}$;
$\lambda_{\text{mar}} \in \{0,\,0.5\}$; $\lambda_{\text{div}} \in \{0,\,0.5\}$;
$\lambda_{\text{fair}} \in \{0,\,0.5\}$) que genera 24 configuraciones
distintas. Sobre las métricas resultantes se construye la frontera de Pareto y se
elige un punto de operación.

## Diseño experimental

### Universo de evaluación y pool compartido

El experimento opera sobre el mismo universo que F3: 1 998 ítems candidatos,
1 107 casos de evaluación, pool de 200 candidatos por usuario producido por la
fusión de cuatro fuentes via RRF. Todos los 24 configuraciones de $\lambda$
reordenan **el mismo pool**, lo que garantiza que las diferencias de métrica sean
atribuibles exclusivamente a la política de ponderación y no a diferencias en el
conjunto de candidatos disponibles.

La compra holdout sirve únicamente como verdad de fondo para medir
`nDCG@10` y revenue esperado; no es feature de ningún modelo.
El experimento es completamente determinista (semilla 42).

### Baseline F3-RRF

El punto de referencia es el orden producido por la propia fusión RRF del pool
de F3, sin ninguna re-ponderación de objetivos. Sus métricas sobre el conjunto de
evaluación son:

| Métrica | Valor |
|---|---|
| `nDCG@10` (relevancia) | 0.202 |
| `revenue@10` | 29\,702.21 |
| diversidad intra-lista@10 | 0.132 |
| `sellerGini`@10 | 0.103 |

Este baseline representa el máximo de relevancia observado en el estudio: ninguna
configuración multi-objetivo lo supera en `nDCG@10`.

### Incidencias durante el desarrollo (P0 corregidos)

Tres problemas de primer orden fueron detectados por las revisiones adversariales
del arnés y se corrigieron antes de cerrar los resultados:

1. **Conflicto entre margen y revenue.** En el diseño original, el objetivo
   $f_{\text{mar}}$ (margen unitario) peleaba de forma contradictoria contra
   $f_{\text{rev}}$ (revenue esperado = precio $\times$ margen): elevar el margen
   unitario a precio bajo reducía el revenue esperado. La solución fue añadir un
   objetivo $f_{\text{rev}}$ explícito que captura el producto conjunto
   precio-margen-probabilidad de compra, dejando $f_{\text{mar}}$ como señal
   auxiliar opcional.

2. **Runner $O(\text{pool}^2)$.** El scorer original iteraba sobre todos los
   candidatos para cada ítem al calcular la penalización de diversidad intra-lista,
   produciendo complejidad cuadrática que bloqueaba el runner con pools grandes.
   Se introdujo un `limit` de salida anticipada que acota el coste de diversidad
   a los primeros $k$ ítems ya seleccionados.

3. **Reporte falso de guardrail cumplido.** Un borrador previo describía
   incorrectamente el punto KPI seleccionado como si satisficiera el guardrail de
   relevancia $\geq 0.7 \cdot \text{base}$. La revisión final detectó que
   ninguna de las 24 configuraciones cumple ese umbral (véase la sección
   de honestidad metodológica) y corrigió el reporte para declararlo infactible.

## Frontera de Pareto y barrido de $\lambda$

De las 24 configuraciones evaluadas, **23/24 pertenecen a la frontera de
Pareto** cuando se consideran los cuatro objetivos simultáneamente (relevancia,
revenue, diversidad, equidad de vendedores). Este resultado confirma que
prácticamente toda la grilla de $\lambda$ genera puntos no dominados: no existe
una única configuración que supere a todas las demás en todos los objetivos
al mismo tiempo.

La tabla siguiente resume los dos puntos de operación considerados junto con el
baseline F3-RRF:

| Punto | $\lambda$ (rel, rev, div) | Relevancia (`nDCG@10`) | $\Delta$ rel | `revenue@10` | $\Delta$ rev |
|---|---|---|---|---|---|
| baseline (RRF) | --- | 0.202 | --- | 29\,702 | --- |
| knee (min-max) `cfg8` | rel=1, rev=0.5, div=0 | 0.081 | $-59.8\%$ | 48\,498 | $+63.3\%$ |
| revenue-max `cfg18` | rel=1, rev=1, div=0.5 | 0.056 | $-72.4\%$ | 52\,524 | $+76.8\%$ |

La selección del **punto knee** (`cfg8`) se realiza mediante normalización
min-max sobre las 24 configuraciones: $\text{relN} = (\text{rel} -
\text{minRel}) / (\text{maxRel} - \text{minRel})$ e ídem para revenue.
El knee maximiza $\min(\text{relN},\, \text{revN})$, criterio que es libre de
escala y no está dominado por la magnitud bruta del revenue (${\approx}30\,000$
versus relevancia ${\approx}0.1$). Para `cfg8` se obtiene relN = 0.529 y
revN = 0.842.

## Hallazgo central: el trade-off es real y ajustable

El experimento confirma que el trade-off relevancia $\leftrightarrow$ revenue
es **real y graduable** (*dial-able*): incrementar $\lambda_{\text{rev}}$ de 0
a 0.5 y de 0.5 a 1 produce incrementos sistemáticos en `revenue@10` a costa de
decrementos sistemáticos en `nDCG@10`. El operador puede elegir dónde operar
sobre esa curva de intercambio.

El punto knee min-max (`cfg8`) es el compromiso más defendible: conserva el
52.9\% del rango de relevancia y el 84.2\% del rango de revenue, situándose
lejos del extremo degenerado de revenue máximo. En términos absolutos,
`cfg8` obtiene $+63.3\%$ de `revenue@10` respecto al baseline RRF
(48\,498 vs 29\,702) con una caída de $-59.8\%$ en `nDCG@10` (0.081 vs 0.202).

Un hallazgo adicional relevante: **toda configuración rerankeada queda por debajo
del baseline RRF en relevancia**. La mejor configuración en relevancia pura
(`cfg0`, rel = 1, todo lo demás = 0) obtiene `nDCG@10` = 0.107, todavía un
$-47.1\%$ respecto al baseline 0.202. En este pool sintético, el orden RRF es
un óptimo local de relevancia fuerte: cualquier ponderación de objetivos
secundarios cuesta relevancia.

## Honestidad metodológica: límites del punto de operación

Esta sección recoge dos advertencias que el lector debe retener al interpretar
los resultados anteriores. Son las limitaciones más importantes del capítulo y
se exponen sin atenuación.

### Guardrail de relevancia infactible: 0/24 configuraciones lo cumplen

El protocolo experimental definía un guardrail de relevancia:
$\text{nDCG@10} \geq 0.7 \cdot \text{base} = 0.7 \times 0.202 = 0.141$.
Este umbral garantizaría que ningún punto de operación sacrifica más del 30\%
de la relevancia del baseline.

**El guardrail es infactible: ninguna de las 24 configuraciones del barrido
lo satisface.** La mejor configuración en relevancia pura (`cfg0`) obtiene
`nDCG@10` = 0.107 $<$ 0.141. La función `pickByKpi` —que selecciona el punto
KPI maximizando revenue sujeto al guardrail— no encuentra ningún candidato
admisible y **recurre al máximo global de revenue como solución de
*fallback***: `cfg18` ($\text{nDCG@10} = 0.056$, $\text{revenue@10} = 52\,524$).

El punto KPI reportado (`cfg18`) **NO satisface el guardrail de relevancia**.
Es el máximo de revenue observado en el barrido, elegido por defecto ante la
ausencia de candidatos factibles. Por tanto, no debe interpretarse como un punto
de operación de producción deseable: sacrifica el $72.4\%$ de la relevancia del
baseline, lo que degradaría gravemente la experiencia de usuario.

El punto de operación recomendado para producción —si se decide desplegar F4—
es el knee min-max (`cfg8`), que representa el compromiso más equilibrado
disponible en el espacio explorado, con plena conciencia de que tampoco cumple
el guardrail.

### Caveat de atribución: el $-72.4\%$ conflaciona dos efectos distintos

La caída de relevancia del $-72.4\%$ entre el baseline RRF y el punto revenue-max
(`cfg18`) no debe leerse íntegramente como el "coste" del objetivo revenue.
Ese porcentaje **conflaciona dos efectos separados**:

**Efecto 1 — Desajuste de baseline (señal única vs fusión de cuatro fuentes).**
El baseline F3-RRF fusiona cuatro fuentes de candidatos (retrieval coseno,
co-ocurrencia NPMI, popularidad por cohorte, exploración aleatoria) mediante
RRF. El orden resultante integra señales de relevancia de las cuatro familias.
En contraste, el feature de relevancia del scorer multi-objetivo
($f_{\text{rel}}$) es **una sola señal**: la similitud coseno del ítem a los
modos del usuario en el espacio `e1\_prod2vec` —aproximadamente equivalente a la
fuente retrieval únicamente.

La configuración relevancia-pura (`cfg0`, $\lambda_{\text{rev}} = 0$, todo lo
demás = 0) ya obtiene `nDCG@10` = 0.107 frente al baseline 0.202: una brecha del
$-47.1\%$ **sin ponderar revenue en absoluto**. Esta brecha mide el desajuste
entre el scorer mono-señal y la fusión RRF, no el trade-off con revenue.

**Efecto 2 — Trade-off real relevancia $\leftrightarrow$ revenue.**
La caída adicional desde `cfg0` (0.107) hasta `cfg18` (0.056) —unos 0.051
puntos de `nDCG@10`— sí es atribuible al peso del objetivo revenue. Este es el
coste verdadero del trade-off.

En consecuencia, el $-72.4\%$ **sobreestima el coste atribuible al objetivo
revenue**. Una estimación más honesta del trade-off real tomaría `cfg0` como
baseline del scorer en lugar del baseline RRF, o bien incorporaría las señales
NPMI y popularidad como features adicionales de $f_{\text{rel}}$, de modo que
ambos extremos de la comparación utilizaran el mismo conjunto de información.
Esta corrección queda como trabajo futuro.

El hallazgo cualitativo —que el trade-off es real y graduable— **no cambia** con
esta corrección: existe una familia de configuraciones que aumenta revenue a
costa de relevancia, y la frontera de Pareto es genuina. Lo que cambia es la
magnitud del intercambio, que el experimento actual exagera.

## Síntesis

F4 demuestra que el ranking multi-objetivo, con la formulación
$s(p \mid u) = \sum_k \lambda_k \cdot f_k$, permite al operador navegar
explícitamente el espacio de trade-offs entre relevancia y revenue. La
frontera de Pareto (23/24 configuraciones) es real: el dial existe y funciona.
El punto de operación recomendado es el knee min-max (`cfg8`,
$\lambda_{\text{rel}} = 1,\, \lambda_{\text{rev}} = 0.5$), que obtiene
$+63.3\%$ de `revenue@10` respecto al baseline RRF con una caída de $-59.8\%$
en `nDCG@10`.

Las dos advertencias metodológicas —guardrail infactible y atribución
parcialmente errónea— limitan la transferibilidad directa a producción pero
no invalidan el hallazgo central: el mecanismo de ponderación $\lambda$ es el
instrumento correcto para negociar objetivos de negocio en un sistema de
ranking personalizado, y su calibración requiere un piloto A/B con métricas de
conversión reales antes de cualquier despliegue.
