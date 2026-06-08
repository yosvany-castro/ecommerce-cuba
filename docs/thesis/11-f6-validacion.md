# Validación holística y stress-testing (F6)

## Motivación: la comparación que faltaba

Las fases F0–F4 evaluaron cada contribución de forma aislada, y por una razón
metodológica sus cifras **no son directamente comparables entre sí**: cada estudio
construyó su propio conjunto de casos sobre un universo de candidatos distinto
(catálogo completo con vectores-factor en F0; intersección de espacios en F1; pool de
200 en F3/F4). En consecuencia, una pregunta central nunca se respondió de forma justa:
**¿el sistema completo, ensamblado de punta a punta, le gana a un e-commerce normal
sobre exactamente los mismos casos?**

El rival natural es `popular-cohort` —ordenar por popularidad dentro de la subcategoría
del ítem—, que es precisamente lo que un e-commerce sin personalización ya implementa.
A escala n=2000, `popular-cohort` alcanzaba `nDCG@10` 0.486 en F0, una cifra que
*aplastaba* a todo el pipeline (F3-RRF 0.177, F4 0.202); pero esa comparación confundía
peras con manzanas, pues se medía sobre casos y candidatos diferentes. F6 elimina ese
confound.

## El arnés head-to-head unificado

F6 introduce un **cargador canónico de casos** (`unified-cases.ts`) que produce, una
sola vez, un conjunto de casos de evaluación con candidatos idénticos para todos los
rankers, y un **ranker ensamblado** (`assembled.ts`) que encadena F1→F2→F3→F4 como un
único `Ranker`. Sobre estos casos se comparan, en igualdad estricta de condiciones,
desde los baselines ingenuos (`random`, `popular-global`, `popular-cohort`) hasta el
pipeline completo, en dos marcos:

- **Marco *full*** (feed de producción): los candidatos son el catálogo menos el
  historial de entrenamiento del usuario. Responde la pregunta titular.
- **Marco *pool*** (diagnóstico): los candidatos son el pool de 200; aísla el valor del
  reordenado *dado* el retrieval.

El pipeline no es un único ranker sino una **familia de configuraciones**: la
configuración relevancia-óptima (`f3-rrf`, el pool fusionado por RRF) y la
revenue-óptima (`f4-revenue`) difieren, de modo que el reporte honesto compara el
campeón *por objetivo*, no una sola variante.

## ¿Le gana el pipeline al baseline ingenuo?

A n=2000 (marco *full*, 1107 casos), la configuración relevancia-óptima del pipeline
obtiene `nDCG@10` **0.200 frente a 0.177** de `popular-cohort` (**+13.0 %**), y a la vez
`revenue@10` +162 %. La configuración revenue-óptima eleva `revenue@10` +363 % a costa
de −67 % de relevancia: la palanca multi-objetivo hecha decisión explícita.

Un matiz obligatorio: **ningún reranker aprendido bate al RRF** en relevancia pura
(consistente con el hallazgo honesto de F3). El mérito no está en el reordenado final
sino en **cómo se arma el surtido**: el pool multi-fuente. En el marco *pool*,
`popular-cohort` sigue ganando en relevancia dentro del pool (−36 % para `f3-rrf`), lo
que confirma que la ventaja del pipeline proviene del *retrieval sobre el catálogo
completo*, no del reordenado de un pool ya bueno.

## Validez a escala: el límite declarado #1

La tesis declaraba la escala (n=2000) como su limitación principal. F6 regeneró el
mercado a n=5000 y n=10000 (con usuarios y eventos proporcionales) y re-midió el
head-to-head. El resultado es inequívoco:

| $n$ | `popular-cohort` | `f3-rrf` | ventaja | `revenue` (f3-rrf) |
|---|---|---|---|---|
| 2.000 | 0.177 | 0.200 | +13.0 % | +162 % |
| 5.000 | 0.092 | 0.149 | +62.6 % | +185 % |
| 10.000 | 0.065 | 0.111 | +71.4 % | +226 % |

`popular-cohort` **decae monótonamente** al crecer el catálogo: la señal
cohorte=subcategoría se diluye cuando hay miles de ítems por subcategoría. El pipeline
se sostiene mucho mejor, de modo que **su ventaja relativa crece de +13 % a +71 %**.
Este es exactamente el régimen de un revendedor que opera sobre el catálogo de
Amazon/AliExpress: cuanto más grande el catálogo, más se despega el sistema
inteligente. La limitación de escala no solo se resuelve: se resuelve *a favor* de la
tesis. (Las corridas a n=10000 emplean una submuestra de 2000 casos por costo de
memoria —O(casos×catálogo)—; la señal de escala proviene del tamaño del universo de
candidatos, no del conteo de casos.)

## Robustez por semilla

Para descartar que las conclusiones sean un artefacto de la semilla 42, se replicó el
experimento a n=5000 con semillas distintas. La ventaja del pipeline y la señal de NPMI
se mantienen en dirección y magnitud:

| semilla | `popular-cohort` | `f3-rrf` | ventaja | caída de recall sin NPMI |
|---|---|---|---|---|
| 42 | 0.092 | 0.149 | +62.6 % | −0.341 |
| 7 | 0.096 | 0.149 | +55.3 % | −0.336 |
| 123 | 0.088 | 0.154 | +74.7 % | −0.331 |

Las tres semillas coinciden en dirección y magnitud (ventaja +55 % a +75 %; caída de
recall sin NPMI −0.33 a −0.34): las conclusiones son robustas y no dependen de la
semilla.

## Stress-tests dirigidos

- **Cierre del caveat de atribución de F4.** F4 había advertido que su feature de
  relevancia era una sola señal (coseno a modos), no la fusión de cuatro fuentes del
  baseline, de modo que el −% de relevancia conflaba el trade-off real con un desajuste
  de baseline. Implementando una **relevancia multi-señal** (retrieval+NPMI+popularidad)
  se observa que esta cierra entre 84 % y 102 % de la brecha single→fusión a lo largo de
  las escalas. El trade-off *verdadero*, medido en igualdad, es $\approx$ **+46.8 % de revenue
  por −36.9 % de relevancia**, sustancialmente más suave que el +62 %/−52 % reportado en
  F4 con la señal única. La principal deuda metodológica de la tesis queda saldada.

- **Reranker entrenado sobre el outcome de negocio.** Un LTR cuyo objetivo es el revenue
  esperado (en lugar de la compra binaria) *falla* el guardrail de relevancia a n=2000 y
  n=5000, pero **lo supera a n=10000**: bate al RRF en `revenue@10` manteniendo
  `nDCG@10` $\geq$ 0.7·RRF. Es un resultado nuevo que *emerge* a escala.

- **Latencia.** La latencia end-to-end del ranking (retrieval→pool→reordenado→scorer) sin
  el LLM tiene `p99` $\approx$ 26 ms, muy por debajo de la compuerta de 1.5 s. La etapa dominante
  y sensible a la escala es el retrieval ($O(N\cdot d)$).

- **Perfiles adversariales.** Sobre perfiles extremos construidos a mano (regalo puro,
  multi-modal ortogonal, precio-extremo, sesión ambigua), el detector de regalo dispara
  en 2 de 3 perfiles de regalo; cuando falla, el pipeline degrada con gracia al modo
  *self*; y en todos los perfiles extrae más revenue que `popular-cohort`.

- **Ablations del pool.** Removiendo una fuente a la vez, **NPMI es la más cargante para
  el recall**: quitarla cuesta entre −0.27 y −0.38 de pool-recall según la escala, y
  entre el 28 % y el 37 % de las compras retenidas son alcanzables vía NPMI pero **no**
  por el retrieval coseno —exactamente los complementos que la similitud lingüística no
  recupera. La señal de co-ocurrencia es ortogonal, y su importancia **crece** con la
  escala.

## Un hallazgo metodológico

El stress-test del detector de regalo reveló un defecto de fidelidad en el propio arnés:
inicialmente el detector se ejecutaba sobre el *historial de entrenamiento* del usuario,
cuyo demográfico modal coincide por construcción con el del comprador, haciendo
estructuralmente imposible la señal *cross-cohort* y desactivando el mecanismo de regalo
en todas las evaluaciones. Corregido para ejecutarse sobre la **sesión real** del ítem
de test (excluyéndolo, sin fuga de información) y midiendo el recipient-fit contra el
destinatario de verdad, el recipient-fit del pipeline en el segmento de regalo pasó de
0.29 a 0.52. El episodio ilustra el valor del stress-testing: encontrar y corregir un
defecto real antes de fijar conclusiones.

## Veredicto y limitaciones

F6 confirma las contribuciones centrales del programa y, en el caso de la escala, las
*refuerza*: el valor del pipeline está en el pool multi-fuente, la complementariedad
vive en la co-ocurrencia y no en el coseno, el ranking multi-objetivo es una palanca
real cuyo trade-off es más benigno de lo reportado, y la ventaja sobre el baseline
ingenuo **crece con el tamaño del catálogo** y es robusta entre semillas. Persisten las
limitaciones honestas: los datos son sintéticos —la validación definitiva sería el
piloto A/B con clientes reales, diseñado pero no ejecutado—, el detector de regalo es
débil (F1 $\approx$ 0.44) y sin mejora fácil libre de fuga, y las cifras a n=10000 se miden
sobre una submuestra de casos. El resumen ejecutivo no técnico de esta validación se
encuentra en `RESUMEN-EJECUTIVO.md`.
