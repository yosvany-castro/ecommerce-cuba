# Feedback sobre tu diseño de feed personalizado

Lo escribo largo a propósito. La idea no es que te diga "esto está mal" y listo, sino que entiendas **por qué** ciertos diseños fallan y salgas con un plan que puedas defender frente a cualquier senior. Si algo de lo que digo no te cierra, peleémoslo — varias decisiones tienen alternativas válidas, no estoy diciendo que mi versión sea la única.

Antes de entrar a las críticas, primero lo que importa.

---

## Lo que hiciste bien

No es trivial llegar a este nivel de diseño solo. Hay piezas que están correctas y son las que vas a conservar:

- **Normalizar vectores a la esfera unitaria** y reducir cosine a producto interno. Es la decisión correcta y simplifica todo lo que viene después.
- **Decay exponencial con vida media $\tau$ ajustable**. Es el estándar de la industria (Netflix, Spotify lo usan así). La composicionalidad del exponencial — $e^{-(t_2-t_0)/\tau} = e^{-(t_2-t_1)/\tau} \cdot e^{-(t_1-t_0)/\tau}$ — es lo que hace que la actualización incremental funcione, y la dedujiste correctamente.
- **Separar vector de sesión y vector de perfil** con $\alpha$ dinámico. La intuición de que la sesión y el historial tienen escalas temporales distintas es exactamente la correcta. Hay un paper de Hidasi et al. (ICLR 2016) que formaliza esto.
- **Mantener `vector_unnormalized` y `weight_sum` por separado** para la actualización incremental. Es la implementación correcta. La estrategia 1 (recálculo desde cero) que propones como fallback nocturno es buena higiene contra deriva numérica.
- **Reconocer cold start como problema explícito** en lugar de ignorarlo.
- **Distinguir hiperparámetros de constantes** y enumerarlos al final. Ese tipo de claridad la mayoría de los diseños la omite.

Esto es entre 30% y 40% del valor de un sistema que sí funciona. El otro 60–70% es lo que viene a continuación.

---

## Tres ideas que cambian la forma de pensar el problema

Antes de ir a fixes específicos, hay tres conceptos que si no los internalizas vas a seguir cayendo en los mismos diseños. Léelos como cambios de mentalidad, no como features que falten.

### Idea 1 — Un usuario no es un punto, es una distribución

Tu modelo asume implícitamente que cada usuario tiene **un solo gusto** que se puede representar con un punto $\mathbf{u}_j \in \mathbb{R}^d$. Esto es geométricamente equivalente a decir "el usuario tiene una preferencia unimodal, hay un centro, y todo lo demás es ruido".

Esto es falso para casi cualquier humano. La misma persona en una semana real:

- Compra zapatillas para correr (gusto deportivo, para ella).
- Busca un regalo para su mamá (gusto que NO es de ella, intent transaccional).
- Mira camisas formales (gusto laboral).
- Compara auriculares (gusto tecnológico).

Cuando promedias estos cuatro vectores y normalizas, obtienes un punto $\mathbf{u}_j$ que **no está cerca de ninguno de los cuatro**. En la geometría de la esfera unitaria, el promedio de vectores ortogonales cae en una región que es equidistante de todos ellos — y, crítico, **una región donde típicamente no hay productos del catálogo**. Es un fantasma matemático.

Te lo demuestro con un experimento. Simulé un catálogo con dos clusters ortogonales (zapatillas en un lado del espacio, bolsos en el otro), y un usuario con 7 eventos en zapatillas + 3 eventos en bolsos (un usuario realista 70/30):

```
Top-20 con tu vector único:           20 zapatillas,  0 bolsos,  0 ruido
Top-20 con multi-vector (k=2):        10 zapatillas, 10 bolsos,  0 ruido
ángulo(u_único, centro_zapatillas) = 38.4°
ángulo(u_único, centro_bolsos)     = 75.0°
```

El 30% del usuario desapareció completamente del feed. Y nota que el ángulo de 38° contra el centro dominante tampoco es bueno: si el catálogo tuviera zapatillas a $<10°$ del centro, tu vector está fuera de su cluster denso. **Tu top-20 no es ni representativo del 70% ni del 30% — es un compromiso vacío.**

La solución estándar se llama **multi-vector user representation**. La idea: clusterizas el historial del usuario en $k = 3$ a $5$ centroides (con k-means online, o medoid clustering), guardas un vector por modo, y haces retrieval **por cada modo** con cuotas proporcionales al peso del modo. El paper de referencia es PinnerSage (Pal et al., KDD 2020, Pinterest). MIND (Li et al., CIKM 2019, Alibaba) es otra versión.

> En el resto del documento, cuando hable del "vector del usuario", asumí que en la versión final son varios vectores. Por simplicidad sigo escribiendo $\mathbf{u}_j$ como si fuera uno.

### Idea 2 — Similitud semántica no es lo mismo que relación comercial

Esta es la idea más importante de todo el documento. Tomate cinco minutos con ella.

Tu sistema vive enteramente dentro de un espacio donde las distancias miden **proximidad lingüística entre descripciones de productos**. Eso es lo que hace `text-embedding-3-small`: tomó miles de millones de pares de textos similares y los acercó en el espacio.

Pero las relaciones que importan en e-commerce son **comerciales**, no lingüísticas. Tabla:

| Relación | ¿Texto cercano? | ¿Cosine alto? | Lo que en realidad necesitas |
|---|---|---|---|
| Mismo producto otro color | Sí | Sí | Filtro de variante / SKU agrupado |
| Upgrade (iPhone 14 → 15 Pro) | Sí | Alto | Señal de jerarquía + precio |
| Downgrade (versión más barata) | Sí | Alto | Señal de precio inversa |
| Cross-sell (iPhone → funda) | **No** | **Bajo** | **Grafo de co-compra** |
| Complementario (cámara → SD card) | **No** | **Bajo** | **Grafo de co-compra** |
| Alternativa de marca (Nike → Adidas) | Medio | Medio | Categoría + price band + co-vista |
| "El siguiente nivel" (suscripción premium) | No | Bajo | Reglas de negocio + intent |

Mira los renglones marcados. Esos son precisamente los que tu sistema **no puede recuperar** con cosine. La razón es estructural: la descripción de un iPhone y la de una funda para iPhone tienen muy poco vocabulario en común. La funda dice "silicona, transparente, antishock, compatible con". El iPhone dice "A17 chip, 6.1 pulgadas, ProMotion". Sus embeddings están lejos.

La señal que sí captura cross-sell se llama **co-occurrence** y vive en un grafo, no en un espacio métrico:

$$G = (V, E), \quad V = \text{productos}, \quad w(p_i, p_j) = \text{frecuencia de co-compra (o co-vista)}$$

Para cuantificar la fuerza de la asociación entre dos productos, se usa **Pointwise Mutual Information** o su versión normalizada (NPMI):

$$\text{NPMI}(p_i, p_j) = \frac{\log\frac{P(p_i, p_j)}{P(p_i)\,P(p_j)}}{-\log P(p_i, p_j)} \in [-1, 1]$$

NPMI alto significa "estos dos productos aparecen juntos mucho más de lo que el azar predeciría". Eso es cross-sell. No requiere modelo de ML, no requiere embeddings, no requiere GPU — es una matriz dispersa que actualizas incrementalmente con cada compra/sesión.

**Implicación para tu diseño:** vas a necesitar **dos espacios** que coexistan:

1. **Espacio semántico** (lo que ya tienes): para discovery, búsqueda libre, descubrir cosas nuevas que no comprastes nunca.
2. **Grafo de co-compra/co-vista** (lo que te falta): para cross-sell, "frequently bought together", carrusel "people who looked at X also looked at Y".

Cuando el usuario está mirando un producto $p$, la pregunta "¿qué le muestro al lado?" no se responde con $\arg\text{topK}\,\text{sim}(\mathbf{p}, \mathbf{p}')$. Se responde con $\arg\text{topK}\,\text{NPMI}(p, p')$. Son dos sistemas distintos viviendo en la misma página.

### Idea 3 — El ranking final no es un score, es una negociación entre objetivos

Tu sistema tiene un score implícito: similitud coseno (con remix de slot allocation). Eso es lo que decide qué aparece arriba.

Pero un e-commerce real tiene **muchos objetivos compitiendo**:

- Relevancia (que el usuario haga click).
- Conversión (que compre).
- Margen (que la compra deje plata).
- Inventario (vaciar stock próximo a vencerse).
- Diversidad (que no se aburra del feed).
- Fairness (no enterrar a vendedores nuevos).
- Novedad (sacar productos que el usuario no ha visto).

Lo que se hace en producción se llama **multi-objective ranking**. El score final típicamente es:

$$s(p \mid u) = \sum_k \lambda_k \cdot f_k(p, u)$$

donde cada $f_k$ es una señal calibrada (relevancia, margen normalizado, stock health, etc.) y los $\lambda_k$ se aprenden o se ajustan vía bandits según el KPI del negocio (revenue por sesión, retention, etc.).

Tu sistema actual está optimizando $\lambda_{\text{relevance}} = 1$ y todos los demás $\lambda = 0$. Eso es un punto de partida válido, pero hay que ser explícito que es una decisión, no una verdad. El día que quieras "promover los productos con mejor margen" o "darle aire a vendedores nuevos", la arquitectura tiene que aceptar señales adicionales sin reescribirse.

---

## Fixes específicos a tu plan actual

Hasta acá las ideas grandes. Ahora los problemas concretos del documento, con qué hacer en cada uno.

### Fix 1 — Pesos negativos: cambiarlos por filtros

Esta es la falla más fácil de demostrar y la más clara de arreglar.

Tu propuesta: si el usuario hace `dismiss` (peso $-3$), restas el vector del producto del vector del usuario. La intuición es "alejarte" de productos rechazados.

El problema: en alta dimensión, restar un vector NO te aleja de él en el sentido que imaginas. Te aleja **a él y a todos sus vecinos comerciales**. Lo demostré así: un usuario con $\text{sim}(\mathbf{u}, \mathbf{p}) = 0.7$ (le gustan cosas como $\mathbf{p}$), con un vecino comercial $\mathbf{p}_{\text{vec}}$ tal que $\text{sim}(\mathbf{p}, \mathbf{p}_{\text{vec}}) = 0.85$ (mismo modelo otro color). Cuando aplicás $\mathbf{u} \leftarrow \mathcal{N}(\mathbf{u} - 3\mathbf{p})$:

```
sim(u, p_vec) ANTES:     0.5950
sim(u, p_vec) DESPUÉS:  -0.8118
Casos donde p_vec cruzó a sim<0:   2000/2000  (100%)
```

Si el usuario rechazó "iPhone 15 negro", tu sistema lo aleja también de "iPhone 15 azul" y de la funda compatible. **No es lo que el usuario pidió.**

**Fix correcto:** la operación "rechazar" es semántica de **filtro**, no de **gradiente**. El producto rechazado entra a una lista de exclusión con un TTL (digamos 14 días), y se filtra en el `WHERE` del SQL antes del retrieval. Sin tocar vectores. Si más adelante quieres una versión más sofisticada que actualice el modelo, mira Rocchio relevance feedback (1971) con clipping por similitud previa — pero realmente, en MVP, el filtro post-retrieval cubre el 95% del valor con 0% del riesgo.

### Fix 2 — La mezcla del feed: por bandit, no por decreto

Tu 60/30/10 viene de la nada. No hay justificación cuantitativa. Para usuarios distintos la mezcla óptima es distinta — el usuario casual que entra a explorar se beneficia de más popularidad, el usuario con historial profundo se beneficia de más personalización.

Compare en simulación (con un usuario nicho cuya popularidad universal está débilmente anti-correlacionada con sus preferencias):

```
Pure top-10 de Lista 1 (sin mezcla):   relevancia 7.07
Slot allocation 60/30/10 (tu propuesta): 5.31  (-25%)
```

Con un usuario nicho, regalar 30% de los slots a popularidad cuesta 25% de relevancia personal. Para un usuario más mainstream, podría estar bien. La cuestión es que **no podés saber a priori cuál es cuál**.

**Fix correcto:** transformá los porcentajes 60/30/10 en variables de un **contextual bandit** (LinUCB o Thompson sampling). Cada vez que se sirve un feed, registras qué mezcla usaste y qué CTR/CVR obtuviste. El bandit aprende qué mezcla funciona para qué tipo de usuario (joven/viejo, sesión corta/larga, etc.).

Si querés simplificar para MVP: arrancá con 100% Lista 1 (puro retrieval personalizado). Mediralo durante 2 semanas. Después introducí 10% de exploración y mediralo otras 2 semanas. Si el engagement de largo plazo mejora con exploración, dejala. Si no, sacala. **Nunca mezcles por intuición sin medir el costo de oportunidad.**

Sobre las escalas: tu Lista 2 usa $\log(1 + \text{views}) + 2\log(1 + \text{adds}) + 3\log(1 + \text{purch})$ que va sin techo, y Lista 1 usa cosine que va en $[-1, 1]$. Aunque el slot allocation evita el problema directo, internamente cuando compares "el slot 5 de Lista 1 ¿es mejor que el slot 1 de Lista 2 si necesito un fallback?", no hay base. La forma correcta de fusionar listas con escalas distintas es **Reciprocal Rank Fusion** (Cormack et al., 2009):

$$\text{RRF}(d) = \sum_{r \in \text{rankings}} \frac{1}{k_0 + \text{rank}_r(d)}, \quad k_0 = 60$$

RRF es score-free, opera sobre rangos. Robusto contra calibración mala. **Default seguro cuando combines listas de orígenes distintos.**

### Fix 3 — El threshold del cache semántico: calibrarlo, no decretarlo

Vos fijás $\theta = 0.92$. La pregunta que todo senior te va a hacer es "¿0.92 según qué baseline?".

La distribución de cosine entre pares de queries no relacionadas no es 0. Depende de la **isotropía** del modelo. Bajo dos modelos sintéticos:

```
Modelo                       cosine de pares aleatorios
Isotrópico (ideal)            mean = -0.0003
Anisotrópico (BERT crudo)     mean =  0.5000
```

En un modelo anisotrópico, dos queries que no tienen nada que ver tienen cosine $\approx 0.5$ por defecto. OpenAI v3 está bien entrenado contrastivamente y es bastante isotrópico, así que $\theta = 0.92$ no va a explotar — pero seguís sin saber qué FPR (false positive rate) estás aceptando.

**Fix correcto:**

1. Loguea 10.000 queries reales de tus usuarios (las primeras semanas).
2. Calcula la distribución empírica de $\text{sim}(q_i, q_j)$ para pares aleatorios.
3. Calcula la distribución para pares manualmente etiquetados como "deberían cachearse" (paráfrasis, queries equivalentes).
4. Elegí $\theta$ como el threshold que separa esas dos distribuciones con FPR $\leq 0.1\%$ sobre la primera.

Esto te da $\theta$ en función de TU modelo y TUS queries, no en función de un número que sonó razonable.

### Fix 4 — Métrica de validación: cambiar Jaccard por Recall@k y nDCG@k

Tu propuesta:

> $\mathbb{E}[\text{Jaccard}(T_{j_1}, T_{j_2})] < 0.3$ entre usuarios distintos
> $\mathbb{E}[\text{Jaccard}(T_j^t, T_j^{t+1})] > 0.6$ para el mismo usuario en sesiones consecutivas

Esto **mide diversidad y estabilidad, no calidad**. Un sistema que devuelve feeds aleatorios cumple el primer criterio trivialmente (Jaccard $\approx 0$) sin recomendar nada útil. Un sistema que devuelve siempre los mismos productos top-100 cumple el segundo trivialmente sin personalizar nada.

**Fix correcto:**

Construí un **eval set** de pares (usuario, producto que compró) con holdout temporal. Es decir: tomas tu data, la cortas en una fecha $t^*$, y para cada usuario que compró algo después de $t^*$, te preguntás:

> Si yo no supiera nada de lo que pasó después de $t^*$, ¿mi sistema le habría mostrado en el top-k el producto que efectivamente compró?

Eso te da:

- **Recall@k**: fracción de "compras del futuro" capturadas en el top-k del feed.
- **nDCG@k**: lo mismo pero ponderado por la posición (un hit en posición 1 vale más que en posición 10).
- **MRR** (Mean Reciprocal Rank): $\mathbb{E}[1/\text{rank}_{\text{primer hit}}]$.
- **Hit Rate@k**: fracción de sesiones donde el producto comprado estaba en el feed.

Estas son las métricas estándar de la industria. Jaccard puede sobrevivir como **guardrail** secundario (si baja a 0 hay un bug, si sube a 1 también), pero no como métrica primaria.

### Fix 5 — Cold start: prior por cohorte, no "esperar 5 eventos"

> Una vez que el usuario tiene $n \geq 5$ eventos, se empieza a calcular su vector

Esto deja al usuario en limbo durante sus primeras 5 interacciones, justo cuando es más probable que se vaya. Es una decisión de 2010.

**Fix correcto** (Bayesian cold start):

1. Durante onboarding, capturás 3 a 5 categorías/marcas/estilos que le interesan al usuario (formulario simple).
2. El vector inicial es el centroide de la cohorte:
   $$\mathbf{u}^{(0)}_j = \mathcal{N}\left(\sum_{c \in \text{cohorte}(j)} \pi_c \cdot \mathbf{c}_c\right)$$
   donde $\mathbf{c}_c$ es el centroide de los productos de la categoría $c$.
3. Cada evento mueve el vector desde el prior con shrinkage proporcional al número de eventos:
   $$\mathbf{u}_j^{(n+1)} = \mathcal{N}\left(\frac{n}{n+\kappa} \cdot \mathbf{u}_j^{(n)} + \frac{\kappa}{n+\kappa} \cdot \mathbf{u}^{(0)}_j + w_e \cdot \mathbf{p}_e\right)$$
   con $\kappa$ controlando cuánto pesa el prior. Para $n \to \infty$, el prior desaparece. Para $n = 0$, sólo está el prior.

**Personalizás desde el primer evento.** Cuando llegue el evento #5, ya tenés un vector decente.

---

## Plan v1 reescrito (MVP que sí funciona)

Acá el plan concreto que recomiendo construir, en el orden en que lo construirías. Cada fase es ejecutable en 1–2 sprints.

### Fase A — Catálogo enriquecido y embeddings (1 sprint)

- Generar embeddings de productos con `text-embedding-3-small` (o Voyage si necesitás multilingüe). Concatenar título + descripción + categoría + atributos clave.
- Persistir en `pgvector` con índice HNSW (`ef_construction = 200`, `m = 16` como punto de partida).
- **Decisión nueva:** generar también embeddings del catálogo en chunks (título solo, descripción sola) si el presupuesto lo permite. Eso te da reranking más fino más adelante. Si no, uno solo concatenado está bien.

### Fase B — Grafo de co-ocurrencia (1 sprint, en paralelo con A)

- Cada vez que un usuario ve/agrega/compra un par de productos en una ventana temporal (digamos 30 minutos), incrementás un contador en una tabla `(p_i, p_j, count, last_seen)`.
- Calculás NPMI nocturno y persistís el top-50 por producto en una tabla `co_occurrence_top`.
- **Esto te da cross-sell sin entrenar nada.**

### Fase C — Vector de usuario (multi-modo desde el día 1)

- Onboarding declarativo: 3–5 categorías/marcas → vector prior.
- Vector de sesión (decay $\tau = 30$ min) y vector de perfil (decay $\tau = 60$ días). Mantenelos como propusiste.
- **Diferencia con tu plan:** el vector de perfil no es uno sino **hasta 3 vectores** (clusters del historial). Implementación MVP:
  - Si el usuario tiene $< 20$ eventos: 1 vector (no hay suficiente data para clusterizar).
  - Si tiene 20 a 100 eventos: 2 vectores (k-means k=2, pesando por $w \cdot \delta$).
  - Si tiene $> 100$ eventos: 3 vectores.
- Recálculo de los clusters semanal en batch. Durante la semana, el evento nuevo se asigna al cluster más cercano y se actualiza incrementalmente.

### Fase D — Retrieval (3 fuentes, fusión por RRF)

Cuando el usuario abre el home, generás candidatos de tres fuentes:

1. **Personalización semántica.** Para cada vector del usuario, hacés `pgvector` top-50. Unís los resultados.
2. **Co-ocurrencia con el último producto visto.** Top-30 por NPMI con el último ítem que el usuario miró en la sesión actual. Esto captura cross-sell e intent inmediato.
3. **Popularidad calibrada.** Top-20 por popularidad ponderada por la cohorte demográfica del usuario, no popularidad global.

Fusionás las 3 listas con **RRF** ($k_0 = 60$). Eso te da un ranking inicial sin tener que normalizar scores.

### Fase E — Diversificación con MMR

Sobre los top-100 del RRF, aplicás **Maximal Marginal Relevance** (Carbonell & Goldstein, 1998):

$$\text{MMR}(p) = \lambda \cdot s(p) - (1 - \lambda) \cdot \max_{p' \in S} \text{sim}(p, p')$$

con $\lambda = 0.7$. Esto evita que el top-N sea 10 zapatillas casi idénticas. **MMR es lo que tu slot allocation intenta hacer pero hecho bien.**

### Fase F — Reranker contextual con LLM (top-30 → top-10)

Esto es lo nuevo y lo más diferenciador para un MVP en 2026. Sobre los top-30 del MMR:

- Le pasás al LLM (Claude Haiku o GPT-4o-mini, baratos) el contexto: hora del día, último producto visto, query reciente si la hubo, vector de perfil resumido en texto ("usuario con interés en X, Y, Z"), y los 30 candidatos.
- El LLM te devuelve un re-ranking de 10 con justificación textual.

Esto captura cosas que el cosine no captura: "este usuario probablemente está buscando regalo" (intent), "es lunes a las 9am, mostralo cosas para la oficina" (contexto), "el usuario está browseando sin foco, mostrale variedad" (modo).

Costo: ~$0.001 por feed. Latencia: 200–500ms con Haiku. Es viable.

### Fase G — Búsqueda

Para queries libres, tu diseño actual es razonable: embeddes la query, hacés retrieval por similitud, reranqueás con perfil. Cambios:

- $\beta = 0.7$ (relevancia query vs perfil) está bien como default.
- Agregá BM25 (sparse) en paralelo al cosine (denso) y fusionalos por RRF. Esto se llama **hybrid search**. La razón: cosine es malo con nombres propios, SKUs, talles exactos ("zapatillas Nike Air Max 270 talle 42"). BM25 brilla ahí. Las dos juntas son mucho más robustas que cualquiera sola.
- Cache semántico: $\theta$ calibrado empíricamente como expliqué.

### Fase H — Evaluación

Antes de poner en producción:

- Eval offline: Recall@10 y nDCG@10 sobre holdout temporal de tu data histórica. Si no tenés data histórica, hacé un piloto interno con 100 usuarios de testing.
- Online: A/B test contra una baseline simple (ej: top-popular sin personalización). KPIs: CTR del feed, CVR, revenue per session, sesión depth.
- Guardrails: Jaccard inter-usuario en $[0.05, 0.40]$ (si está fuera hay un bug). nDCG vs perfil estable día a día.

### Roadmap v2 (cuando tengas tracción)

- **Two-tower fine-tuned** con tus clicks/compras (DPR, Karpukhin et al., 2020). Reemplaza el embedding genérico por uno que sabe qué dimensiones convierten en TU catálogo.
- **Item2vec** (Barkan & Koenigstein, 2016): un embedding de productos entrenado en sesiones de compra, no en descripciones. Vive en un espacio que sí codifica relaciones comerciales.
- **Cross-encoder reranker** (BGE-reranker-v2-m3) sustituyendo el LLM rerank cuando latencia importe.
- **Multi-objective ranking** explícito con $\lambda$ aprendidos por bandit.

---

## Resumen ejecutivo en una tabla

| Componente | Tu diseño | Recomendado MVP |
|---|---|---|
| Vector de usuario | 1 vector con decay | 1 a 3 vectores según historial; prior por cohorte desde día 1 |
| Cross-sell | No existe | Grafo de co-compra con NPMI |
| Retrieval | Cosine vs vector único | Cosine multi-modo + co-ocurrencia + popularidad cohort, fusionados por RRF |
| Diversidad | Slot allocation 60/30/10 | MMR ($\lambda = 0.7$) sobre el resultado fusionado |
| Reranking | Ninguno | Top-30 → LLM rerank con contexto |
| Búsqueda | Cosine + filtros | BM25 + cosine fusionados por RRF + LLM intent |
| Pesos negativos | $w \in \{-3, -2\}$ | Filtro post-retrieval con TTL (sin aritmética vectorial) |
| Cold start | Esperar 5 eventos | Prior por cohorte + Bayesian update desde evento 1 |
| Cache search | $\theta = 0.92$ fijo | $\theta$ calibrado al p99.9 de pares aleatorios reales |
| Validación | Jaccard inter-usuario | Recall@k, nDCG@k, MRR sobre holdout temporal + A/B test online |
| Mezcla del feed | 60/30/10 decretado | Bandit contextual (o 100/0/0 al inicio + tests incrementales) |

---

## Lecturas que vale la pena que hagas

En orden de utilidad para vos, ahora:

1. **Karpukhin et al., *Dense Passage Retrieval*, EMNLP 2020.** El paper canónico de retrieval moderno. Explica two-tower, in-batch negatives, hard negatives. Léelo dos veces.
2. **Pal et al., *PinnerSage*, KDD 2020.** El paper que formaliza multi-vector user representation. Es exactamente lo que te falta entender.
3. **Carbonell & Goldstein, *MMR*, SIGIR 1998.** Clásico, corto, leíble. Diversidad sin renunciar a relevancia.
4. **Cormack et al., *Reciprocal Rank Fusion*, SIGIR 2009.** 2 páginas. Cambia la forma en que pensás la fusión de rankings.
5. **Barkan & Koenigstein, *Item2Vec*, 2016.** Adaptación directa de word2vec a recsys. Lo vas a necesitar para v2.
6. **Yi et al., *Sampling-Bias-Corrected Neural Modeling*, RecSys 2019 (Google).** El paper de producción de YouTube/Google, te muestra qué se hace en escala real.

Si tenés que leer solo dos, son el (1) y el (2). El resto cuando los necesites.

---

## Una última cosa

El instinto que tuviste con el doble vector (sesión + perfil) y con el decay exponencial muestra que entendés la mecánica del problema. Lo que te falta es **escalar la representación**: pasar de pensar en un usuario como un punto a pensar en un usuario como una distribución multimodal con varios modos activos a la vez. Una vez que internalices eso, todo lo demás (multi-objective ranking, hybrid retrieval, MMR, RRF) cae naturalmente como consecuencia.

El diseño que hiciste no es malo — es la versión 2018 honesta del problema. La versión 2026 honesta requiere las tres ideas que arriba: usuario multi-modo, dos espacios separados (semántico + co-compra), ranking multi-objetivo. Reescribilo con esas tres ideas como columna vertebral y vuelvelo a presentar. Cuando lo hagas, la mitad de las preguntas duras que ibas a recibir desaparecen solas.

Cualquier cosa que no te cierre, peleémoslo.