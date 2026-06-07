# Usuario multi-vector y modelo de regalo (F2)

## Motivación y pregunta de investigación

El segundo factor del programa de tesis (F2) parte de una crítica conceptual al modelo de usuario heredado de F1: representar al comprador como un único vector de perfil equivale a afirmar que sus intereses son unimodales y estables. Esta asunción falla en al menos dos regímenes frecuentes en e-commerce: el usuario que alterna entre categorías heterogéneas según el momento de vida (e.g., artículos de trabajo y artículos de ocio en la misma semana), y el usuario que compra para un tercero —una situación que denominamos *sesión de regalo* y que contamina el perfil propio si se registra de la misma forma que una compra de autoconsumo.

La pregunta de investigación es doble. Primera: ¿produce un sistema de recuperación multi-vector —donde el perfil del usuario es una *distribución* de intereses en lugar de un punto único— mejores listas de candidatos que el vector único de F1, y el beneficio es consistente en todos los segmentos de usuario? Segunda: ¿puede el sistema reconocer automáticamente una sesión de regalo y construir, para esa sesión y sólo para ella, un vector efímero de destinatario que apunte a los intereses del receptor sin alterar el perfil del comprador?

## Diseño: un usuario como distribución de intereses

### Representación multi-vector

La inspiración directa es PinnerSage [@pal2020pinnersage], el sistema de Pinterest que modela cada usuario como una mezcla de medoides, cada uno representando un clúster de intereses distinto. La implementación de este trabajo sigue el mismo espíritu con tres decisiones de diseño:

1. **Clustering aglomerativo coseno.** A partir del historial de interacciones del usuario expresado en el espacio `e1_prod2vec` (64 dimensiones), se aplica clustering aglomerativo de enlace promedio con distancia coseno. El número de modos emerje de los datos: un usuario con historial estrecho produce un único clúster; un usuario con intereses dispersos puede producir dos o tres.

2. **Medoides como representantes.** Cada clúster queda representado por su medoide —el ítem real más cercano al centroide empírico—, lo que garantiza que el vector de consulta pertenece al espacio de productos reales y no a un punto interpolado sin referente semántico.

3. **Invarianza al orden.** La asignación de clústeres es independiente del orden cronológico de las interacciones, característica heredada del diseño de PinnerSage y que hace el sistema robusto frente a diferentes secuencias de observación.

Durante la recuperación, cada modo emite una cuota proporcional de candidatos y los resultados se fusionan mediante *Reciprocal Rank Fusion* (RRF), asegurando que ningún interés minoritario quede excluido por la dominancia numérica del modo principal.

### Modelo de regalo: vector efímero de destinatario

Una sesión de regalo presenta una distribución de compra radicalmente diferente a la compra de autoconsumo: los ítems observados reflejan el gusto del *destinatario*, no del comprador. Si ese historial se incorpora directamente al perfil permanente del comprador, introduce ruido que degrada las recomendaciones futuras de autoconsumo.

La solución adoptada es la detección heurística de sesiones de regalo seguida de la construcción de un **vector de destinatario efímero**: un vector de perfil calculado únicamente a partir de los ítems de la sesión corriente, utilizado sólo durante esa sesión y desechado al concluirla. El perfil permanente del comprador no se modifica.

La detección utiliza coherencia demográfica entre los ítems observados en la sesión y la cohorte del comprador, cruzando señales de género y edad. Cuando la sesión resulta incoherente con el perfil demográfico del comprador —por ejemplo, un hombre adulto añadiendo artículos de bebé de género femenino—, el sistema clasifica la sesión como regalo y activa el vector efímero.

## Resultados

### nDCG@10 segmentado: F1 vs F2

El espacio de ítems utilizado es `e1_prod2vec`, con universo común de 1999 productos y 1098 casos de evaluación —los mismos que en F1, para garantizar comparabilidad directa. La tabla siguiente reproduce los resultados exactos del estudio:

| Segmento | $n$ | F1-single | F2-multivec |
|---|---|---|---|
| overall | 1098 | 0.101 | 0.152 |
| `self\|1mode` | 598 | 0.151 | 0.200 |
| `self\|2-3modes` | 151 | 0.109 | 0.163 |
| `gift\|1mode` | 287 | 0.013 | 0.063 |
| `gift\|2-3modes` | 62 | 0.006 | 0.072 |

F2 supera a F1-single en todos los segmentos sin excepción. La ganancia global es de 0.101 a 0.152, una mejora relativa del 51%. En los segmentos de autoconsumo, donde el vector único ya ofrecía rendimiento razonable (`self|1mode` 0.151), F2 lo eleva a 0.200, confirmando que la multi-modalidad aporta incluso cuando el usuario es relativamente unifocal.

El efecto más pronunciado aparece en las sesiones de regalo. El vector único **colapsa** en `gift|2-3modes` hasta un `nDCG@10` de 0.006 —prácticamente aleatorio—, mientras que F2 alcanza 0.072, una mejora de aproximadamente $12\times$. En `gift|1mode` la ganancia es de 0.013 a 0.063 ($\approx 5\times$). Este contraste no es sorprendente: el vector único del comprador, calibrado sobre intereses de autoconsumo, señala en dirección opuesta a lo que el destinatario desea.

### Recipient-fit@10: ¿apunta el feed al destinatario?

Para las sesiones clasificadas como regalo ($n = 349$), se calculó una métrica adicional denominada `recipient-fit@10`: la fracción de los 10 candidatos recuperados que pertenecen a las categorías demográficas del destinatario inferido. Esta métrica captura si el feed resultante *apunta al receptor correcto*, independientemente de si los ítems exactos son los adquiridos.

Los resultados son:

- **F1-single:** `recipient-fit@10` = 0.285
- **F2-multivec:** `recipient-fit@10` = 0.476

El feed de regalo de F2 apunta al destinatario aproximadamente 1.7 veces mejor que el vector único. Expresado en términos absolutos, casi la mitad de los candidatos en el top-10 son relevantes para el receptor ($\approx 47.6\%$), frente a poco más de una cuarta parte con F1-single ($28.5\%$).

### Calidad de la detección de regalo

La detección heurística de sesiones de regalo es, como cualquier heurística, imperfecta. La evaluación contra la verdad de fondo disponible ($n = 1098$ sesiones totales) arroja los siguientes resultados:

| Métrica | Valor |
|---|---|
| Precisión | 0.430 |
| Recall | 0.387 |
| F1 | 0.407 |

La matriz de confusión desagregada muestra: TP = 135, FP = 179, FN = 214, TN = 570.

Estas cifras deben leerse con honestidad: el detector comete aproximadamente un error por cada 1.7 detecciones positivas (FP = 179 frente a TP = 135), y deja escapar el 61% de las sesiones de regalo verdaderas (FN = 214 de 349). La consecuencia práctica es que F2 activa el vector efímero en muchas sesiones que no son de regalo —introduciendo ruido en lugar de señal—, y no lo activa en la mayoría de las que sí lo son.

Este es el **límite más importante del diseño F2**: la ganancia medida sobre `nDCG@10` y `recipient-fit@10` combina el efecto de la representación multi-vector (beneficio real) con los errores del detector (atenuación). El beneficio real de la multi-vectorialidad es posiblemente mayor de lo que los números indican; el modelo de regalo podría extraer más valor con un detector de mayor calidad —por ejemplo, con señales explícitas del usuario o inferencia demográfica supervisada.

En el estado actual, la precisión de detección de $\approx 0.43$ se reporta explícitamente como restricción del sistema, no se oculta. Los resultados de F2 son válidos como medida del pipeline completo, incluyendo sus errores de clasificación.

## Discusión y hallazgos

Dos tesis quedan empíricamente respaldadas por este estudio:

**Tesis 1 — El usuario es una distribución, no un punto.** La representación multi-vector produce listas de candidatos superiores en todos los segmentos evaluados. La multi-modalidad aporta incluso a usuarios unimodales (`self|1mode`: +32% relativo), y es especialmente crítica cuando los intereses del usuario son dispersos o cuando la sesión corriente refleja intereses ajenos. El paradigma del vector único es un caso degeneral del modelo multi-vector que sólo es óptimo bajo el supuesto —raramente satisfecho— de que todos los intereses del usuario son representables por un único punto del espacio vectorial.

**Tesis 2 — El regalo requiere representación propia.** Tratar una sesión de regalo como compra de autoconsumo destruye la calidad de recuperación: `nDCG@10` cae a valores cercanos a cero (0.006 en `gift|2-3modes` con F1-single). El vector efímero de destinatario, aun construido con un detector imperfecto, multiplica por $\approx 12$ la métrica de relevancia en el peor segmento y eleva el `recipient-fit@10` de 0.285 a 0.476. La separación arquitectónica entre perfil del comprador y señal del destinatario es, por tanto, una decisión de diseño justificada empíricamente, no una complejidad gratuita.

La ganancia global de F2 sobre F1 —de `nDCG@10` 0.101 a 0.152— establece el nuevo techo del retriever sobre el que operarán el reranker (F3) y el ranking multi-objetivo (F4).
