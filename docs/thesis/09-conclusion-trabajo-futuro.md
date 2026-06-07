# Conclusión y trabajo futuro

## Conclusión

El programa de tesis F1--F4 partió de una pregunta motivacional honesta: ¿cuándo
y cuánto ayuda la personalización profunda en un e-commerce reseller, y dónde no
ayuda? La respuesta que surge del arco experimental es matizada y, precisamente
por ello, más útil para el diseño del sistema.

### Lo que el arco experimental demostró

**La representación importa, y su elección no es obvia.** F1 estableció que los
embeddings comportamentales superan al texto puro en recuperación de relevancia,
con una ratio de aproximadamente $2.7\times$ para `e1_prod2vec` y $3.3\times$ para
la fusión `e2_hybrid` en `nDCG@10`. Pero el mismo
experimento demostró que esos embeddings no recuperan complementos: la columna
`complement-recall@10` es prácticamente cero en todos los espacios evaluados.
La conclusión arquitectónica —que la relevancia y el cross-sell requieren
señales fundamentalmente distintas— no habría sido alcanzable sin medir ambas
con la misma rigurosidad.

**El usuario como distribución, no como punto, se justifica empíricamente.**
F2 demostró que el modelo multi-vector con detección de regalo supera al vector
único en todos los segmentos evaluados. La ganancia más pronunciada aparece
exactamente donde la teoría predice que debería aparecer: en las sesiones de
regalo, donde el vector único de comprador colapsa a valores de `nDCG@10`
cercanos a cero, mientras que el vector efímero de destinatario eleva la métrica
en un factor de aproximadamente $12\times$ en el peor segmento. Esta
consistencia entre predicción teórica y resultado empírico da confianza en el
diseño del modelo, a pesar de las imperfecciones del detector heurístico.

**El cross-sell vive en la co-ocurrencia, no en el coseno.** F3 confirmó que la
fuente NPMI recupera complementos que la similitud vectorial no puede recuperar.
El pool multi-fuente aproximadamente duplica el recall de candidatos respecto al
retriever coseno de F2, y esa ampliación de recall es el avance principal de F3.
La lección de diseño es que el esfuerzo de ingeniería en la etapa de retrieval
debe distribuirse entre fuentes de señal ortogonales, no concentrarse en
embeddings más potentes dentro de una única señal.

**El ranking negocia múltiples objetivos, y la frontera de Pareto es el
instrumento correcto para esa negociación.** F4 demostró que la combinación
lineal convexa con pesos $\lambda$ ajustables convierte una decisión implícita
—el pipeline de relevancia pura ya elige tácitamente $\lambda_{\text{rev}} = 0$—
en una decisión explícita y controlable por el operador. La frontera de Pareto
(23/24 configuraciones no dominadas) es genuina: el dial existe y funciona, y
su calibración final requiere un piloto A/B con métricas de conversión reales.

**Los hallazgos negativos son contribuciones de primera clase.** El `complement-recall@10`
$\approx$ 0 de F1, la inferioridad de todos los rerankers frente al baseline RRF en F3,
y la infactibilidad del guardrail en F4 —con el correspondiente caveat de
atribución sobre la señal única de relevancia— no son fracasos a minimizar en
las conclusiones. Son los resultados que delimitan el espacio de soluciones
eficaces, señalan dónde poner el esfuerzo en lugar de dónde ya se puso, y
constituyen evidencia reproducible sobre las fronteras de lo que los embeddings
y los rerankers de relevancia pueden y no pueden hacer en este dominio.

### La tesis en una frase

La personalización profunda se justifica cuando (a) la representación del
usuario captura la multimodalidad real de sus intereses y la naturaleza efímera
de las sesiones de regalo, (b) el cross-sell se modela donde vive —en la
co-ocurrencia de compra, no en la similitud coseno de embeddings— y (c) el
ranking negocia explícitamente múltiples objetivos del negocio mediante una
frontera de Pareto ajustable sin reentrenamiento; todo ello medido con rigor
sobre un arnés con holdout temporal y reportando los límites con la misma
honestidad que las victorias.

---

## Trabajo futuro

Los hallazgos del programa de tesis sugieren seis líneas de trabajo futuro,
ordenadas por prioridad metodológica.

### Cross-check sobre dataset público de sesiones (validez externa)

La amenaza más importante sobre los resultados actuales es que todo el programa
opera sobre datos sintéticos. El cross-check sobre un dataset público de sesiones
reales de e-commerce, para el que el adaptador `thesis:public` ya está
implementado, es el siguiente paso inmediato. El objetivo es verificar que las
conclusiones cualitativas —ventaja de embeddings comportamentales sobre texto,
beneficio de multi-vector en sesiones de regalo, contribución ortogonal de
co-ocurrencia NPMI— se replican en datos con ruido real, distribuciones de
popularidad no sintéticas y patrones de compra conjunta emergentes en lugar de
simulados. Los resultados cuantitativos exactos cambiarán; lo que se quiere
verificar es si el orden cualitativo entre métodos se preserva.

### Item2Vec y two-tower entrenados con clics y compras reales

El embedding `e3_two_tower` quedó considerablemente por debajo de `e1_prod2vec`
en F1, posiblemente por insuficiencia de datos de entrenamiento en el simulador.
En producción, el pipeline dispone o dispondrá de señal real de clics y compras,
que es precisamente la señal que item2vec y los modelos two-tower necesitan para
generalizar en catálogos de cola larga. El fine-tuning de un two-tower con
eventos de compra reales y muestreo negativo in-batch —con corrección logQ para
descontar el sesgo de popularidad— es la vía más directa para superar las
limitaciones del Prod2Vec entrenado sobre historial limitado. La evaluación
debe reproducir el mismo protocolo de holdout temporal para mantener la
comparabilidad con los resultados de F1.

### ColBERT real vía API multilingüe

El reranker cross-encoder MaxSim de F3 implementó una aproximación a late
interaction con embeddings estáticos, que obtuvo el peor resultado en `nDCG@10`
aunque el mayor en `set-change@10`. Un ColBERT real con codificación
token-a-token en un modelo multilingüe —relevante para un catálogo con títulos
en inglés, español y chino— podría capturar relevancia contextual que el MaxSim
estático no puede. La API multilingüe de Voyage ya está disponible en el
entorno; la integración de ColBERT real requiere adaptar el esquema de pool
para almacenar representaciones multi-token por ítem, lo que tiene implicaciones
de latencia y costo que deben medirse antes de cualquier decisión de despliegue.

### Bandit contextual para ajustar $\lambda$ por usuario

F4 establece la frontera de Pareto y propone un punto de operación fijo (el
knee min-max `cfg8`) para todos los usuarios. Esta elección es una aproximación
razonable pero subóptima: usuarios con alta propensión a compra de artículos
de alto valor podrían tolerar —o incluso preferir— una configuración más
orientada a revenue; usuarios exploradores podrían beneficiarse de más
diversidad. Un bandit contextual que ajuste $\lambda$ por usuario en función
de señales de contexto (historial de compra, cohorte demográfica, momento
de sesión) convertiría el peso único del sistema en un peso personalizado sin
necesidad de reentrenamiento global. La implementación puede reutilizar el
mismo scorer multi-objetivo de F4; lo que varía es el mecanismo que elige
$\lambda$ para cada solicitud.

### Features de relevancia multi-señal para un baseline justo en F4

El caveat de atribución identificado en F4 —que el scorer mono-señal
($f_{\text{rel}}$ = similitud coseno a `e1_prod2vec`) ya cede el $-47.1\%$
de relevancia frente al baseline RRF antes de incorporar revenue— no invalida
el hallazgo central, pero sí impide medir con precisión cuánta relevancia cuesta
realmente el trade-off. La corrección directa es enriquecer $f_{\text{rel}}$
con las mismas señales que componen el baseline RRF: puntuación NPMI de
co-ocurrencia, popularidad por cohorte, y eventualmente la señal aleatoria
de exploración. Con un scorer que integre las cuatro fuentes, la diferencia
entre `cfg0` (relevancia pura) y el baseline RRF desaparecería, y la caída
atribuible a $\lambda_{\text{rev}}$ mediaría únicamente el trade-off real.
Esta corrección cierra el único caveat de atribución abierto del programa.

### Ejecución del piloto A/B en producción

El capítulo siguiente (`10-plan-piloto.md`) diseña sin ejecutar un experimento
controlado en producción. La ejecución de ese piloto es el horizonte natural
del programa de tesis: convertir los hallazgos offline en evidencia de impacto
en métricas de negocio reales (tasa de conversión, revenue por sesión, retención
de usuarios). El piloto está diseñado para validar separadamente la ganancia de
F2 (multi-vector con regalo) y la configuración knee de F4 ($\lambda_{\text{rel}}
= 1, \lambda_{\text{rev}} = 0.5$), con poder estadístico suficiente para detectar
efectos de la magnitud observada en el simulador. Su ejecución requiere
instrumentación de clics y compras en producción, que es la señal que
retroalimentará también el fine-tuning del two-tower mencionado anteriormente.
