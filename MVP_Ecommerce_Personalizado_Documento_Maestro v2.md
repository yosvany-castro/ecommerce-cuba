# MVP Funcional: E-commerce Reseller con Personalización Adaptativa

## Documento maestro de arquitectura, lógica y roadmap

> **Versión 1.2** — Reescritura del motor de recomendación tras revisión técnica externa. Documento de **lógica**, no de implementación. No contiene código.

### Cambios respecto a v1.1

Tras revisión técnica externa (especialista en sistemas de recomendación), el motor de personalización fue rediseñado en partes estructurales. Lo que cambia:

- **Usuario multi-modo:** se reemplaza el "vector único" por una representación multi-vector (1 a 3 modos según historial).
- **Dos espacios coexistentes:** se introduce un grafo de co-ocurrencia (NPMI) para cross-sell, en paralelo al espacio semántico.
- **Pipeline del feed reescrito:** múltiples fuentes de candidatos fusionadas por Reciprocal Rank Fusion (RRF), diversificación con MMR, y un reranker LLM contextual al final.
- **Hybrid search:** búsqueda BM25 + cosine en paralelo, fusionados por RRF.
- **Pesos negativos eliminados:** rechazo de productos se modela como filtro con TTL, no como aritmética vectorial.
- **Cold start bayesiano:** prior por cohorte desde el primer evento, en lugar de "esperar 5 eventos".
- **Métricas de validación:** Recall@k, nDCG@k, MRR como primarias. Jaccard se mantiene solo como guardrail secundario.
- **Cache semántico calibrado empíricamente** en lugar de umbral arbitrario.

Lo que se mantiene del diseño original (validado en la revisión): normalización a esfera unitaria, decay exponencial con τ ajustable, separación de vector de sesión y vector de perfil con α dinámico, actualización incremental con `vector_unnormalized` + `weight_sum`, recálculo nocturno como higiene contra deriva, distinción entre hiperparámetros y constantes, modelo pagador-receptor.

### Alcance crítico — leer antes que cualquier otra cosa

Este NO es un prototipo desechable ni una versión simplificada. Es el **sistema real de producción** con un único componente simulado: la fuente de productos (la API agregadora estilo Rainforest), porque sus peticiones cuestan dinero y no tiene sentido quemar presupuesto antes de validar el motor.

**Lo único mock:** la API agregadora que devuelve productos de Amazon/Shein/AliExpress.

**Todo lo demás es producción real, sin atajos:** Postgres con `pgvector`, embeddings reales, LLM real, vectores con decay y multi-modo reales, búsqueda semántica + BM25 reales, RRF y MMR reales, LLM reranker real, tracking real, fusión de identidades real, motor de personalización completo, cron real, admin completo, modelo pagador-receptor estructural, flujo de orden con estados.

Cuando llegue producción, **lo único que se reemplaza es el módulo del mock**. El resto del sistema queda intacto.

---

## Tabla de contenidos

1. Cómo usar este documento
2. Hipótesis a validar
3. Alcance: real vs mock vs fuera de scope
4. **Principios de diseño** (nuevo en v1.2)
5. Stack y decisiones de infraestructura
6. Arquitectura general — los 5 sectores
7. Sector A · Captura de datos
8. Sector B · Catálogo dinámico con mock + grafo de co-ocurrencia
9. Sector C · Búsqueda inteligente híbrida
10. Sector D · Personalización (reescrito)
11. Sector E · Admin y operación
12. El mock de la API agregadora
13. Modelo de datos
14. Roadmap por fases
15. Métricas de éxito y validación
16. Trampas comunes
17. Glosario
18. Referencias

---

## 1. Cómo usar este documento

Documento de **lógica**, no de código. Cada sección explica qué se construye, por qué, cómo se valida, y qué trampas evitar. El roadmap (sección 14) es el orden recomendado: cada fase tiene un criterio de aceptación explícito. Si ese criterio no se cumple, no se avanza.

Asume que la implementación la hará otro agente leyendo este documento como única fuente de verdad. Por eso es deliberadamente extenso en explicar el "por qué" de cada decisión.

---

## 2. Hipótesis a validar

El sistema existe para responder una pregunta principal:

> ¿Es viable un e-commerce que se adapta dinámicamente al comportamiento de cada usuario, alimentado por un catálogo que se autoabastece desde una API externa, con una IA que normaliza intenciones de búsqueda y un motor de recomendación que combina señales semánticas y comerciales?

Cuatro preguntas secundarias:

**P1.** ¿La personalización produce feeds visiblemente distintos entre usuarios con comportamientos distintos, medidos con métricas estándar de la industria (Recall@k, nDCG@k)?

**P2.** ¿La búsqueda híbrida (BM25 + semántica + LLM) supera la búsqueda puramente textual?

**P3.** ¿La economía del modelo (cron + búsqueda bajo demanda + cache calibrado) puede sostener un catálogo vivo sin gastar en exceso?

**P4.** ¿El sistema funciona desde el primer evento (cold start con `anonymous_id` y prior bayesiano) o requiere mucho historial para ser útil?

Si las cuatro se responden con "sí", el sistema validó el concepto y se justifica avanzar a producción real.

---

## 3. Alcance: real vs mock vs fuera de scope

### Lo que se construye REAL (calidad de producción)

- Catálogo en Postgres con `pgvector`, productos con embeddings reales
- **Grafo de co-ocurrencia** entre productos con counts incrementales y NPMI calculado
- Cron real que dispara periódicamente
- Búsqueda **híbrida real** (BM25 sparse + cosine denso fusionados por RRF) con LLM normalizando queries
- Cache de queries con umbral calibrado empíricamente
- Tracking de eventos desde primera visita con `anonymous_id`
- Schema fijo de eventos con índices reales
- **Vector de usuario multi-modo real** (1 a 3 vectores según historial), con doble representación sesión/perfil, pesos por evento y decay temporal
- **Prior por cohorte y shrinkage bayesiano** para cold start
- Fusión real de identidad anónima ↔ usuario registrado
- **Motor de retrieval por múltiples fuentes**: semántica multi-modo, co-ocurrencia, popularidad por cohorte
- **Fusión por Reciprocal Rank Fusion (RRF)**
- **Diversificación con Maximal Marginal Relevance (MMR)**
- **LLM reranker contextual** sobre top-30 → top-10 con justificación textual
- **Lista de exclusión con TTL** para productos rechazados (en lugar de aritmética vectorial)
- Etiquetas de "razón" en cada tarjeta (generadas por el reranker)
- Modelo pagador-receptor estructural en BD, con vectores por destinatario
- Flujo de orden con todos los estados + estados de excepción
- Admin completo

### Lo único que se simula (mock)

La API agregadora de productos. Detalle en sección 12.

### Fuera de scope (deferred)

- Pasarela de pago real (la lógica de saldo sí es real)
- Logística física real (el admin avanza estados manualmente)
- App móvil
- Notificaciones (email/push)
- A/B testing infra (para v2 — bandit contextual)
- Two-tower fine-tuned (DPR), Item2vec, cross-encoder neural reranker → todos a v2
- Multi-objective ranking con λ aprendidos por bandit → v2
- Multi-idioma
- Detección de fraude

La regla: ¿es parte del motor de recomendación o de la fuente de datos? Si es parte del motor, se construye real. Si es feature externa (pago, logística), se difiere.

---

## 4. Principios de diseño

Tres ideas estructurales que justifican todas las decisiones técnicas del documento. Si no se entienden estas tres ideas, las decisiones de las siguientes secciones parecerán arbitrarias.

### Principio 1 — Un usuario es una distribución, no un punto

El error más común en sistemas de recomendación pequeños es asumir que cada usuario tiene **un solo gusto** representable por un punto $\mathbf{u}_j \in \mathbb{R}^d$.

Esto es falso para casi cualquier humano real. La misma persona en una semana:
- Compra zapatillas para correr (interés deportivo, para ella)
- Busca un regalo para su mamá (interés que no es de ella)
- Mira camisas formales (interés laboral)
- Compara auriculares (interés tecnológico)

Cuando se promedian estos cuatro vectores, el resultado **no está cerca de ninguno**. En la geometría de la esfera unitaria, el promedio de vectores en direcciones distintas cae en una región equidistante de todos ellos — y, crucialmente, una región donde típicamente no hay productos del catálogo.

**Consecuencia:** el usuario se modela como **distribución multimodal** con 1 a 3 modos activos (centroides), recuperándose candidatos desde cada modo en proporción a su peso. Implementación detallada en Sector D.

En el contexto de este negocio (Cuba, pagador-receptor), el multi-modo aparece a doble nivel:
- **Por destinatario explícito:** un pagador con 3 destinatarios tiene 3 vectores raíz distintos.
- **Por modo dentro de cada destinatario:** una misma persona puede tener gustos en clusters distintos (formal + casual + deportivo, por ejemplo).

### Principio 2 — Existen dos espacios, no uno

Los embeddings textuales miden **proximidad lingüística entre descripciones**. Pero las relaciones que importan en e-commerce son **comerciales**, y muchas no se reflejan en el lenguaje:

| Relación | ¿Texto cercano? | ¿Cosine alto? | Lo que se necesita |
|---|---|---|---|
| Mismo producto otro color | Sí | Sí | Filtro de variante / SKU agrupado |
| Upgrade (iPhone 14 → 15 Pro) | Sí | Alto | Señal de jerarquía + precio |
| Cross-sell (iPhone → funda) | **No** | **Bajo** | **Grafo de co-compra** |
| Complementario (cámara → SD card) | **No** | **Bajo** | **Grafo de co-compra** |
| Alternativa de marca (Nike → Adidas) | Medio | Medio | Categoría + price band + co-vista |

Las descripciones de un iPhone y una funda comparten poco vocabulario: el iPhone habla de chips y pantalla, la funda de silicona y compatibilidad. Sus embeddings están lejos. Cosine no resuelve cross-sell.

**Consecuencia:** el sistema mantiene **dos espacios coexistentes**:
1. **Espacio semántico** (`pgvector`): para discovery, búsqueda libre, descubrir cosas nuevas.
2. **Grafo de co-ocurrencia** (matriz dispersa con NPMI): para cross-sell, "frequently bought together", "people who looked at X also looked at Y".

Cuando el usuario está mirando un producto $p$, la pregunta "¿qué le muestro al lado?" no se responde con `argTopK sim(p, p')`. Se responde con `argTopK NPMI(p, p')`. Detalle en Sector B.

### Principio 3 — El ranking final es una negociación, no un score

Un e-commerce real tiene múltiples objetivos compitiendo: relevancia, conversión, margen, rotación de inventario, diversidad, fairness con vendedores nuevos, novedad para el usuario.

La forma estándar de manejarlo en producción es **multi-objective ranking**:

$$s(p \mid u) = \sum_k \lambda_k \cdot f_k(p, u)$$

donde cada $f_k$ es una señal calibrada y los $\lambda_k$ se ajustan según el KPI del negocio.

**Consecuencia para el MVP:** la arquitectura del ranking se diseña como suma ponderada con $\lambda_k$, aunque inicialmente sólo $\lambda_{\text{relevance}} > 0$. Cuando llegue el día de "promover productos con mejor margen" o "darle aire a vendedores nuevos", se agrega una señal sin reescribir el sistema.

---

## 5. Stack y decisiones de infraestructura

Propiedades requeridas:
- Framework full-stack moderno
- BD relacional con soporte vectorial Y full-text search (BM25)
- Capacidad de cron jobs
- Acceso a APIs de LLM y embeddings

Recomendación:
- **Framework:** Next.js con App Router
- **BD:** PostgreSQL con `pgvector` + extensión nativa `tsvector` para BM25 (alternativa: ParadeDB que da BM25 más serio)
- **Auth:** la opción más rápida (Auth.js, Clerk, Supabase Auth)
- **LLM:** API directa de Anthropic (Claude Haiku para reranker, Sonnet para normalización de queries) u OpenAI (GPT-4o-mini)
- **Embeddings:** `text-embedding-3-small` de OpenAI o Voyage AI
- **Cron:** del SO o librería simple del framework
- **Hosting:** local en desarrollo. Para mostrar, opcionalmente Vercel + Postgres gestionado

Lo que NO debe meterse: Redis, Kafka, ClickHouse, microservicios separados, Docker compose con múltiples servicios, BD analítica separada. Postgres aguanta todo.

---

## 6. Arquitectura general — los 5 sectores

**Sector A · Captura de datos.** Sistema nervioso. Registra cada acción desde la primera visita.

**Sector B · Catálogo dinámico + grafo de co-ocurrencia.** Llena la BD sin intervención manual y mantiene el grafo NPMI actualizado con la actividad real de los usuarios.

**Sector C · Búsqueda inteligente híbrida.** LLM normaliza la query. BM25 + cosine corren en paralelo. RRF fusiona. Reranking con perfil del usuario.

**Sector D · Personalización.** Multi-vector usuario, retrieval multi-fuente, RRF, MMR, LLM reranker. El corazón del sistema.

**Sector E · Admin y operación.** Vistas de gestión + paneles para auditar la lógica.

Conexiones: A produce eventos → B mantiene el grafo y D consume para construir vectores → C y D usan B → E permite operar sobre todo.

---

## 7. Sector A · Captura de datos

### Qué hace

Captura cada acción relevante del usuario desde la primera visita y la guarda en una tabla `events` que es el log inmutable del sistema.

### Lógica de identidad

Tres estados:

- **Anónimo nuevo:** se genera UUID v4, se guarda en cookie con expiración larga.
- **Anónimo recurrente:** ya tiene cookie, su perfil se construye sin registro.
- **Registrado:** al hacer login, se ejecuta **fusión de identidades**: todos los eventos del `anonymous_id` se asocian al `user_id`, los vectores se recalculan combinando ambos historiales, y a partir de ahí los eventos llevan ambos IDs.

### Sesiones

Una sesión se identifica con `session_id` y se cierra después de N minutos (sugerencia: 30) de inactividad. Permite analizar comportamiento intra-visita distinto del agregado del usuario.

### Eventos a capturar

**Alta señal:** `product_view`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `purchase`, `search` (texto crudo + JSON normalizado + número de resultados + hit/miss en cache), `dismiss` (rechazo explícito).

**Media señal:** `product_dwell` (>30s), `category_click`, `filter_applied`.

**Baja señal:** `page_view`, `session_start`, `session_end`.

**Eventos dobles** (importantes para el grafo de co-ocurrencia, sección 8): se registra cuando dos productos aparecen juntos en la misma sesión dentro de una ventana temporal (30 min) — ya sea por co-vista o co-compra.

### Esquema de la tabla events

`id`, `anonymous_id`, `user_id` (nullable), `session_id`, `event_type`, `occurred_at`, `payload` (JSONB), `source`. Índices por `anonymous_id`, `user_id`, `event_type`, `occurred_at`. Particionar por mes solo si crece.

### El doble vector: sesión vs perfil

Cada usuario tiene **dos vectores** (cada uno puede ser multi-modo, ver Sector D):

- **Vector de sesión:** decay $\tau_{\text{sesión}} = 30$ min. Refleja intención presente.
- **Vector de perfil:** decay $\tau_{\text{perfil}} = 60$ días. Refleja gustos consolidados.

Combinación al rankear:

$$\mathbf{u}^{\text{efectivo}}_j = \mathcal{N}\left(\alpha \cdot \mathbf{u}^{\text{sesión}}_j + (1-\alpha) \cdot \mathbf{u}^{\text{perfil}}_j\right)$$

con $\alpha$ dinámico:

$$\alpha = \min(0.7, \,\, 0.1 + 0.05 \cdot n_{\text{eventos sesión}})$$

### Tips críticos

- Schema fijo desde el primer evento.
- Tracking server-side cuando sea posible (ad-blockers no pierden purchase).
- Idempotencia con `client_event_id` y deduplicación.
- El endpoint `POST /track` solo escribe; el procesamiento es asincrónico.

### Validación

- Anonymous_id estable entre páginas
- Eventos llegan a la tabla con timestamps coherentes
- Al registrarse, eventos previos se asocian al `user_id`
- Vector de sesión cambia visiblemente tras 5-10 clicks coherentes

---

## 8. Sector B · Catálogo dinámico con mock + grafo de co-ocurrencia

### Qué hace

Dos responsabilidades distintas pero relacionadas:
1. **Llenar el catálogo** con productos que vienen del mock (cron + búsqueda con miss).
2. **Mantener el grafo de co-ocurrencia** con la actividad real de los usuarios.

### Llenado del catálogo

**Mecanismo 1 — Cron periódico.** Cada N horas (4-6h) ejecuta peticiones al mock para categorías predefinidas. Garantiza que un usuario nuevo vea catálogo poblado.

**Mecanismo 2 — Búsqueda con miss.** Cuando una búsqueda no tiene resultados suficientes en local, se llama al mock en vivo (2-4s con skeleton honesto).

### Pipeline de enriquecimiento

Cada producto que llega del mock pasa por:

1. **Normalización LLM:** título + descripción + categoría cruda → JSON estructurado con categoría unificada, género, edad target, ocasión, estilo, palabras clave. Se guarda como `metadata` JSONB.
2. **Cálculo de embedding:** texto canónico (título + descripción + categoría + atributos clave) → vector $\mathbf{p}_i \in \mathbb{R}^d$, **normalizado a norma 1**, persistido en columna `embedding` (tipo `vector(d)` con pgvector).
3. **Tokenización para BM25:** se construye `tsvector` para búsqueda full-text indexada.
4. **Deduplicación:** si ya existe producto con misma combinación `source + source_product_id`, se actualiza.
5. **Guardado:** producto + metadata + embedding + tsvector se persisten.

### Detalle de economía: guardar todo

Cada petición al mock devuelve 25 productos. Aunque el usuario solo vea 10, los 25 entran al pipeline y se guardan. Baja el costo por producto en ~60%.

### Reglas de invalidación (TTL)

`last_refreshed_at` en cada producto. Si supera N días (3-7), refresh en background sin bloquear al usuario. Si el producto ya no existe en la API real, se desactiva pero NO se borra (necesario para histórico de órdenes).

### El grafo de co-ocurrencia

Esta es una pieza nueva en v1.2 que coexiste con el espacio semántico.

**Qué representa.** Una matriz dispersa donde el peso $w(p_i, p_j)$ refleja con qué frecuencia los productos $p_i$ y $p_j$ aparecen juntos en el comportamiento de los usuarios. "Juntos" puede ser: vistos en la misma sesión, agregados al mismo carrito, comprados juntos.

**Cómo se llena.** Cada vez que un usuario interactúa con dos productos en una ventana temporal (sugerencia: 30 minutos), se incrementa el contador correspondiente en la tabla `co_occurrence`:

```
(product_a_id, product_b_id, count, last_seen_at)
```

con la convención `product_a_id < product_b_id` para evitar duplicados.

Pesos por tipo de co-ocurrencia (configurables):
- co-purchase (ambos comprados): peso 5
- co-cart (ambos en carrito): peso 3
- co-view (ambos vistos): peso 1

**NPMI — la métrica que importa.** El count crudo no sirve como score. Productos populares co-ocurren con todo. Lo correcto es **Pointwise Mutual Information normalizada**:

$$\text{NPMI}(p_i, p_j) = \frac{\log\frac{P(p_i, p_j)}{P(p_i) \cdot P(p_j)}}{-\log P(p_i, p_j)} \in [-1, 1]$$

NPMI alto significa "estos dos productos aparecen juntos mucho más de lo que el azar predeciría". Es exactamente lo que captura cross-sell.

**Recálculo.** Job nocturno calcula NPMI sobre la matriz acumulada y persiste el top-50 por producto en una tabla denormalizada `co_occurrence_top` para queries rápidas en runtime.

**Cold start del grafo.** Al inicio, sin actividad, el grafo está vacío. Se puede sembrar opcionalmente con co-categoría: si dos productos comparten categoría unificada y rango de precio, se agrega una arista débil. Esto da un fallback hasta que la actividad real construya el grafo.

### Tips críticos

- **Cache de queries antes del mock.** Hash normalizado de la query → respuesta cacheada con TTL.
- **No bloquear al usuario por refrescos.** Productos stale se ven igual; el refresh ocurre en background.
- **Concurrencia limitada del cron.** Paralelismo 3-5 simultáneas para no saturar el mock ni el LLM.
- **Pipeline tolerante a fallos parciales.** Si LLM falla en enriquecer, guardar producto con metadata vacía y marcar para reintento.
- **Grafo de co-ocurrencia eficiente.** Una matriz `n × n` densa con n=10000 productos es 100M de entradas. Usar tabla dispersa (solo pares con count > 0) y truncar cola larga (top-K por producto, no todo).

### Validación

- BD vacía + cron una vez → productos con metadata enriquecida + embeddings + tsvector
- Búsqueda con miss → mock se llama (2-4s), productos se procesan, se muestran
- Búsqueda repetida → instantánea (cache hit)
- Después de tener actividad: co_occurrence se llena, NPMI se calcula, queries del top-50 son rápidas

---

## 9. Sector C · Búsqueda inteligente híbrida

### Qué hace

Toma texto crudo del usuario, lo interpreta con LLM, lo convierte en consulta híbrida (BM25 + semántica) y devuelve resultados rankeados según el perfil del usuario.

### El flujo paso a paso

**Paso 1 — Cache de queries (calibrado).** Antes del LLM, normalizar (lowercase, sin acentos, palabras ordenadas) y hashear. Si hay cache hit, salta al paso 4.

**Paso 2 — Cache semántico (calibrado).** Si no hay hit exacto, calcular embedding de la query y buscar queries cacheadas con similitud > $\theta$. Detalle de la calibración de $\theta$ abajo.

**Paso 3 — Normalización con LLM.** Sin cache hit, llamar al LLM con prompt fijo versionado. Para `"regalo para mi sobrina de 8 años, algo bonito y barato"`:

```json
{
  "intent": "regalo",
  "recipient_gender": "niña",
  "recipient_age_min": 7,
  "recipient_age_max": 9,
  "categories": ["juguetes", "ropa_niña", "accesorios"],
  "style": ["bonito", "lindo"],
  "price_range": "bajo",
  "search_terms": "juguete niña 8 años regalo",
  "confidence": 0.9
}
```

**Paso 4 — Búsqueda híbrida.** Dos sub-búsquedas en paralelo, luego fusión:

*4a. BM25 (full-text, sparse).* Sobre `tsvector` con los `search_terms` y los términos del título/descripción. BM25 brilla con nombres propios, SKUs, talles exactos: `"zapatillas Nike Air Max 270 talle 42"`. Devuelve top-K_BM25 productos rankeados por BM25 score.

*4b. Semántica (cosine, denso).* Embebe `search_terms`, hace `embedding <=> :query_vector` con filtros estructurados aplicados (categoría, género, edad, precio). Devuelve top-K_cos productos rankeados por similitud.

*4c. Fusión por RRF.* Para cada producto presente en al menos una lista, calcular:

$$\text{RRF}(p) = \frac{1}{k_0 + \text{rank}_{\text{BM25}}(p)} + \frac{1}{k_0 + \text{rank}_{\text{cos}}(p)}$$

con $k_0 = 60$. Productos que aparecen alto en ambas listas se rankean arriba. RRF es score-free: no requiere normalizar las escalas distintas de BM25 y cosine.

**Paso 5 — Decisión de llamar al mock.** Si los resultados locales están por debajo del umbral (sugerido: 12) Y la categoría no se ha refrescado recientemente Y `confidence > 0.5`, se llama al mock. Si `confidence < 0.5`, no se gasta petición — el LLM detectó query basura.

**Paso 6 — Reranking por perfil.** Sobre los resultados (locales o locales+frescos), aplicar:

$$s_{\text{final}}(p) = \beta \cdot s_{\text{RRF}}(p) + (1-\beta) \cdot \text{sim}(\mathbf{u}^{\text{efectivo}}_j, \mathbf{p})$$

con $\beta = 0.7$. La búsqueda manda; el perfil ordena empates.

**Paso 7 — Registro del evento search.** Persistir texto crudo, JSON normalizado, método (`bm25_only`, `cosine_only`, `hybrid_rrf`), número de resultados, hit/miss, eventual click.

### Calibración del umbral $\theta$ del cache semántico

El umbral $\theta$ del cache semántico no es 0.92 por decreto. Se calibra empíricamente:

1. Loguear ~10.000 queries reales en las primeras semanas.
2. Calcular distribución de `sim(q_i, q_j)` para pares aleatorios → distribución base.
3. Etiquetar manualmente ~200 pares como "deberían cachearse" (paráfrasis, queries equivalentes) → distribución positiva.
4. Elegir $\theta$ que separe ambas con FPR ≤ 0.1% sobre la distribución base.

Resultado: $\theta$ calibrado para tu modelo de embeddings y tus queries reales. En la práctica suele caer entre 0.88 y 0.95, pero el punto exacto es empírico.

### Tips críticos

- **Prompt versionado.** En el admin se filtra por versión para entender qué cambió cuando algo se rompe.
- **Sugerencias cuando no hay resultados.** Mostrar productos relacionados al embedding de la query, no mensaje vacío.
- **Chips visibles de lo que el LLM entendió.** "Para: niña, 7-9 años, regalo, presupuesto bajo" — el usuario corrige si el LLM entendió mal.
- **BM25 + cosine SIEMPRE en paralelo.** No usar uno solo. La combinación es robusta a queries muy literales y muy semánticas por igual.

### Validación

- Set de 30 queries reales: BM25 plano vs hybrid RRF. Hybrid debe ganar en relevancia subjetiva en ≥ 70% de los casos.
- Misma query dos veces: la segunda no gasta tokens.
- Query basura ("asdfgh"): no se llama al mock.
- Calibración de $\theta$ ejecutada y documentada con FPR medido.

---

## 10. Sector D · Personalización

Este es el sector reescrito completamente en v1.2. Lo que sigue es el motor real, no una versión simplificada.

### Visión general del pipeline

Cuando el usuario abre el home (o cualquier vista personalizable), el sistema ejecuta este pipeline:

```
1. Identificar contexto del usuario (vectores activos, sesión, último visto)
2. Generar candidatos desde 3+ fuentes en paralelo
3. Aplicar filtros duros (exclusión, stock, prohibidos)
4. Fusionar las listas con RRF → top-100
5. Diversificar con MMR → top-30
6. Reranking contextual con LLM → top-10
7. Render con razones generadas por el LLM
```

Cada paso se detalla abajo.

### El espacio donde vive todo

Sigue siendo $\mathbb{R}^d$ con vectores normalizados a la esfera unitaria. Lo que cambia es cómo se representa al usuario.

### Representación multi-modo del usuario

**Esto es el cambio conceptual más importante.** El usuario no es un vector único. Es una colección de hasta 3 vectores (modos), donde cada modo representa un cluster distinto de su comportamiento.

**Cuántos modos según historial:**

| Eventos del usuario | Número de modos | Cómo se calculan |
|---|---|---|
| 0 a 4 | 0 (solo prior) | Vector cohorte del onboarding |
| 5 a 19 | 1 | Promedio ponderado clásico |
| 20 a 99 | 2 | k-means con k=2 sobre los productos visitados, pesos w·δ |
| ≥ 100 | 3 | k-means con k=3 |

**Recálculo.** Los clusters se recalculan en batch nocturno. Durante el día, eventos nuevos se asignan al cluster más cercano y se actualiza incrementalmente con la fórmula de actualización (más abajo).

**Doble nivel de multi-modo.** En este negocio (pagador-receptor):
- **Nivel destinatario:** cada destinatario explícito tiene sus propios vectores (un pagador con 3 destinatarios → 3 sets de vectores).
- **Nivel modo:** cada destinatario puede tener 1 a 3 modos según historial.

Cuando se construye el feed, hay que saber a qué destinatario se le está armando. Si el usuario está navegando "para Ana" (lo selecciona en UI), se usan los vectores de Ana. Si está en modo neutral (sin destinatario seleccionado), se usa el destinatario default o un vector mezcla.

### Cálculo de los vectores de modo

Para un usuario con $m$ modos, cada modo $\mathbf{u}_j^{(m)}$ es el centroide ponderado de los productos asignados a ese modo:

$$\mathbf{u}_j^{(m)} = \mathcal{N}\left(\sum_{e \in E_j^{(m)}} w(\text{tipo}_e) \cdot \delta(t_e) \cdot \mathbf{p}_{\text{producto}_e}\right)$$

donde $E_j^{(m)}$ son los eventos asignados al modo $m$, y los componentes son los del v1.1 (validados):

**Pesos por tipo de evento:**

| Evento | Peso |
|---|---|
| `purchase` | 5.0 |
| `add_to_cart` | 3.0 |
| `add_to_wishlist` | 2.0 |
| `product_dwell` (>30s) | 1.5 |
| `product_view` | 1.0 |
| `category_click` | 0.5 |

**Decay temporal exponencial:**

$$\delta(t_e) = \exp\left(-\frac{\Delta t_e}{\tau}\right)$$

con $\tau = 60$ días para perfil, $\tau = 30$ min para sesión.

### Eventos negativos: filtros, no aritmética

**Cambio respecto a v1.1.** Los pesos negativos (restar el vector del producto rechazado) están eliminados.

**Razón.** En alta dimensión, restar un vector aleja también a sus vecinos comerciales. Si el usuario rechaza "iPhone 15 negro", restar su vector aleja también al "iPhone 15 azul" y a la funda compatible. No es lo que el usuario pidió.

**Solución.** Lista de exclusión con TTL:

```
excluded_products: (anonymous_id/user_id, product_id, excluded_at, ttl_until)
```

Default: TTL 14 días para `dismiss`. Se aplica como `WHERE NOT IN (...)` antes del retrieval. Sin tocar vectores.

### Actualización incremental de vectores

Estrategia validada del v1.1 (sin cambios). Mantener:

- `vector_unnormalized` (vector sin normalizar)
- `weight_sum` (acumulador escalar)

Al llegar evento nuevo:

$$\tilde{\mathbf{u}}_j \leftarrow \tilde{\mathbf{u}}_j \cdot e^{-\Delta t / \tau} + w_{\text{nuevo}} \cdot \mathbf{p}_{\text{nuevo}}$$

$$W_j \leftarrow W_j \cdot e^{-\Delta t / \tau} + w_{\text{nuevo}}$$

$$\mathbf{u}_j = \mathcal{N}(\tilde{\mathbf{u}}_j)$$

donde $\Delta t$ es el tiempo desde la última actualización. Coste $O(d)$ por evento. Recálculo desde cero en batch nocturno como higiene contra deriva.

### Cold start: prior bayesiano por cohorte

**Cambio respecto a v1.1.** No se "espera 5 eventos". Se personaliza desde el primer evento.

**Onboarding declarativo.** Al registrarse (o como overlay opcional para anónimos), 3-5 preguntas: ¿para quién compras? ¿edades? ¿categorías de interés? ¿estilo? Esto da una **cohorte** asignada al usuario.

**Vector inicial.** Centroide ponderado de los productos típicos de esa cohorte:

$$\mathbf{u}^{(0)}_j = \mathcal{N}\left(\sum_{c \in \text{cohorte}(j)} \pi_c \cdot \mathbf{c}_c\right)$$

donde $\mathbf{c}_c$ es el centroide de productos de categoría $c$ y $\pi_c$ son pesos del onboarding.

**Shrinkage bayesiano.** Cada evento mueve el vector desde el prior:

$$\mathbf{u}_j^{(n+1)} = \mathcal{N}\left(\frac{n}{n+\kappa} \cdot \mathbf{u}_j^{(n)} + \frac{\kappa}{n+\kappa} \cdot \mathbf{u}^{(0)}_j + w_e \cdot \mathbf{p}_e\right)$$

Con $\kappa$ controlando cuánto pesa el prior. Default $\kappa = 10$. Para $n \to \infty$, el prior desaparece naturalmente. Para $n = 0$, sólo está el prior + el primer evento.

**Resultado.** El usuario tiene un vector útil desde el evento 1. La personalización es degradada al inicio (el prior es genérico de cohorte) pero NO inexistente.

### Generación de candidatos: 3+ fuentes en paralelo

**Fuente A — Personalización semántica multi-modo.**

Para cada vector activo $\mathbf{u}_j^{(m)}$ del usuario:

$$L_A^{(m)} = \arg\text{topK}_{p \in P_{\text{activos}}}\,\, \text{sim}(\mathbf{u}_j^{(m)}, \mathbf{p})$$

con $K = 50$. Se ejecutan tantas queries como modos tenga el usuario. Las listas se unen para formar $L_A$.

**Fuente B — Co-ocurrencia con el último producto visto.**

Si la sesión actual tiene un último producto visto $p_{\text{last}}$:

$$L_B = \text{co\_occurrence\_top}[p_{\text{last}}]$$ (top-30 por NPMI)

Si no hay $p_{\text{last}}$ (usuario recién entró), $L_B$ se omite o se usa el último producto comprado del histórico.

**Fuente C — Popularidad por cohorte.**

No popularidad global. Popularidad **dentro de la cohorte demográfica del usuario** (mismo género receptor, rango de edad, etc.):

$$s_C(p) = \log(1 + \text{views}_{\text{cohorte}, 7d}) + 2 \log(1 + \text{adds}_{\text{cohorte}, 7d}) + 3 \log(1 + \text{purchases}_{\text{cohorte}, 7d})$$

Top-20 por este score.

**Fuente D opcional — Exploración.**

Productos nuevos en el catálogo o con baja exposición histórica. Top-10. Útil para evitar feedback loops y ayudar a productos huérfanos.

### Filtros duros pre-fusión

Antes de fusionar, sobre la unión de candidatos, aplicar:
- Excluir productos en `excluded_products` con TTL vivo
- Excluir productos sin stock o desactivados
- Excluir categorías prohibidas (regulación)
- Excluir productos ya comprados recientemente (a menos que sean consumibles)
- Excluir productos de margen negativo o cero

### Fusión con RRF

Cada candidato tiene un rango en cada lista donde aparece. RRF combina rangos sin escalas:

$$\text{RRF}(p) = \sum_{r \in \{A, B, C, D\}} \frac{\mathbb{1}[p \in L_r]}{k_0 + \text{rank}_{L_r}(p)}$$

con $k_0 = 60$. Productos que aparecen en múltiples listas suben naturalmente. Productos exclusivos de una lista mantienen presencia. RRF es robusto a calibración mala y a escalas distintas (cosine en [-1,1] vs popularidad sin techo).

Output: lista unificada de ~100 candidatos rankeados por RRF.

### Diversificación con MMR

Sobre los top-100 del RRF, se selecciona iterativamente con Maximal Marginal Relevance:

$$\text{MMR}(p) = \lambda \cdot s_{\text{RRF}}(p) - (1-\lambda) \cdot \max_{p' \in S} \text{sim}(p, p')$$

con $\lambda = 0.7$ (sintonía estándar) y $S$ = productos ya seleccionados.

**Qué hace.** El primer producto seleccionado es el mejor del RRF. El segundo es el que tiene buen score Y está lejos del primero. El tercero está lejos del primero Y del segundo. Etcétera. Resultado: 30 productos relevantes pero diversos.

**Reemplaza al slot allocation 60/30/10.** El slot allocation era una forma cruda de forzar diversidad por categoría. MMR es la forma matemática correcta porque opera en el espacio semántico real, no por cuotas hardcodeadas.

### LLM reranker contextual

Sobre los top-30 del MMR, se llama al LLM (Claude Haiku, GPT-4o-mini — modelos baratos y rápidos) con:

- Resumen del perfil del usuario en lenguaje natural ("usuario interesado en X, Y, Z; rango de precio típico $; suele comprar para…")
- Contexto temporal (hora, día de semana)
- Última interacción en la sesión
- Query reciente si la hubo
- Los 30 candidatos con metadata (título, precio, marca, categoría, atributos clave)

El LLM devuelve **top-10 ordenado + razón corta para cada uno** ("perfecto para regalo de cumpleaños cercano", "complementa el celular que viste hace un momento", "popular esta semana entre usuarios similares").

**Costo:** ~$0.001 por feed con Haiku. **Latencia:** 200-500ms.

**Por qué vale la pena.** El LLM captura cosas que el cosine no captura: intent ("este usuario probablemente está buscando regalo"), contexto temporal ("es lunes a las 9am, mostrar ropa de oficina"), modo del usuario ("está browseando sin foco, mostrar variedad"). Y de paso genera las razones que se muestran en cada tarjeta.

### Render del feed

Cada tarjeta del feed muestra:
- Imagen, título, precio (lo estándar)
- **Razón** generada por el LLM
- (Cuando aplica) destinatario sugerido: "para Ana"

Cuando el usuario clickea, se registra `clicked_with_reason`. Esa señal alimenta el aprendizaje futuro: qué razones convierten para qué tipo de usuario.

### Tips críticos del Sector D

- **No mezclar vectores muy distintos.** El multi-modo ya soluciona esto en gran medida, pero también se aplica al modelo pagador-receptor: cada destinatario es independiente.
- **Recalcular vectores en cascada tras compras.** La compra es la señal más fuerte. Después de una compra, no esperar al batch nocturno — actualizar incrementalmente al instante.
- **La métrica reina es Recall@k vs holdout temporal**, no diversidad. Detalle en sección 15.
- **Latencia del feed es presupuesto.** El LLM reranker (200-500ms) está en el camino crítico. Si la latencia total supera 1s, considerar reranker más pequeño (BGE-reranker o cross-encoder destilado) — aunque eso ya es v2.

### Validación

- 3 usuarios sintéticos con comportamientos distintos → feeds visiblemente distintos
- Recall@10 sobre holdout temporal supera baseline (top-popular sin personalización)
- Usuario nuevo (cold start con onboarding) recibe feed coherente con sus preferencias declaradas desde el primer evento
- Tras compra, feed siguiente sesión sesga claramente hacia esa categoría
- Lista de exclusión (TTL) funciona: producto rechazado no reaparece durante 14 días

---

## 11. Sector E · Admin y operación

### Qué hace

Panel para gestionar el negocio Y auditar la lógica de personalización. Sin esto no se cobra a nadie ni se depura nada.

### Vistas mínimas

**Órdenes.** Tabla filtrable por estado. Detalle con productos, cliente, destinatario, total cobrado, gasto, margen, historial de cambios. Botones para avanzar manualmente.

**Qué comprar hoy.** Lista de órdenes `pendiente` agrupada por proveedor, con links al producto. Botón "marcar como comprada" + tracking.

**Saldo de usuarios.** Saldo actual, registro manual de recargas (en producción real las hace el familiar; en MVP se simulan), historial.

**Búsquedas.** Texto crudo + JSON normalizado + método (bm25/cosine/hybrid) + resultados + hit/miss + click. Filtros por confidence baja para identificar prompts a corregir.

**Productos.** CRUD básico, filtros stale/huérfanos.

**Usuario individual.** Perfil interpretable + eventos recientes + **modos del usuario** (cuántos clusters tiene, qué categorías domina cada uno) + feed actual + lista de exclusión activa. Esto es lo más usado para depurar la personalización.

**Co-ocurrencia.** Top-N pares con NPMI más alto. Permite verificar que el grafo se está construyendo coherentemente y detectar artefactos (productos que co-ocurren todo con todo = ruido).

**Eval set.** Vista del holdout temporal: cuántos pares (usuario, producto comprado) hay disponibles, métricas Recall@k/nDCG@k/MRR actuales por segmento.

**Dashboard.** Usuarios activos, búsquedas/día, costo simulado del mock, tasa hit/miss, distribución de Recall@k por cohorte, tiempo medio del LLM reranker, errores del pipeline.

### Estados de orden

Normales: `pendiente` → `comprada` → `en_bodega` → `en_transito` → `para_entrega` → `entregada`

De excepción: `stock_fantasma`, `precio_subido`, `dañada_o_no_entregada`. Cuando se activa `stock_fantasma`, el sistema sugiere alternativas usando similitud al vector del producto agotado + co-ocurrencia.

### Tips críticos

- **Vista del usuario es lo más subestimado.** Auditar la personalización requiere ver casos individuales completos.
- **Costo simulado siempre visible.** Entrena la intuición de cuánto gastarías en producción.
- **Búsquedas con confidence baja** son la lista de prioridad para mejorar el prompt LLM.
- **NPMI top** detecta problemas en el grafo de co-ocurrencia antes de que afecten el feed.

### Validación

- Pasar orden completa por todos sus estados
- Activar `stock_fantasma` → sugerencias coherentes
- Vista de usuario muestra los modos del usuario y por qué le recomienda cada cosa
- Costo simulado se incrementa correctamente

---

## 12. El mock de la API agregadora

### Por qué el mock es la frontera única

Es el único componente simulado de todo el sistema. Su existencia se justifica por un único motivo: las peticiones a una API agregadora real cuestan dinero y no tiene sentido quemar presupuesto antes de validar el motor.

**Regla de diseño dura:** el mock se implementa detrás de una interfaz limpia que será sustituida por la integración real sin tocar nada del resto del sistema.

### Propiedades obligatorias

1. **Productos realistas.** Generados con LLM o dataset público (Amazon products en Kaggle). Distribución: 40% ropa, 20% electrónica, 15% hogar, 10% juguetes/bebé, 10% belleza, 5% otros.
2. **Latencia 2-4s con jitter.** No fija.
3. **Cuenta peticiones y costo simulado** ($0.04 por petición, visible en admin).
4. **25 productos por petición.** Como API real.
5. **Filtra por categoría y query.** El filtrado interno del mock es simple (LIKE) — no es lo que se está probando.
6. **Errores ~2%.** Fuerza manejo de errores desde el día uno.
7. **Reemplazable.** Interfaz limpia.

### Estructura del fixture (500 productos)

Cada producto: ID interno, título, descripción 2-3 frases, URL placeholder, precio, marca, categoría cruda al estilo Amazon, atributos por categoría, fuente simulada (Amazon/AliExpress/Shein). El multi-fuente permite probar deduplicación cross-platform.

### Tips

- Versionar el fixture
- Determinismo opcional para tests (mismo seed → misma respuesta)
- Latencia variable, no fija

---

## 13. Modelo de datos

### Tablas core

**`users`** — usuarios registrados. Campos: id, email, nombre, saldo, created_at.

**`anonymous_sessions`** — vínculo entre cookies anónimas y usuarios eventualmente registrados. Campos: anonymous_id (UUID), user_id (nullable), first_seen_at, last_seen_at.

**`recipients`** — destinatarios de los regalos. Campos: id, user_id, nombre, género, edad, dirección_cuba.

**`products`** — catálogo unificado. Campos: id, source, source_product_id, título, descripción, precio, imagen_url, categoría_cruda, metadata (JSONB), embedding (vector(d) normalizado), tsvector (para BM25), created_at, last_refreshed_at, is_active.

**`events`** — log de comportamiento. Campos: id, anonymous_id, user_id (nullable), session_id, event_type, occurred_at, payload (JSONB), source.

**`user_profiles`** — perfil consolidado base. Campos: id, anonymous_id, user_id (nullable), n_events, cohort_id, prior_vector (vector — del onboarding), interpretable_profile (JSONB), last_recompute_at, updated_at.

**`user_profile_modes`** — modos del usuario (multi-vector). Una fila por modo activo. Campos: id, user_profile_id, recipient_id (nullable, para multi-destinatario), mode_index (1, 2, o 3), vector_unnormalized (vector), weight_sum (float), n_events_in_mode, last_assigned_at.

**`session_vectors`** — vector volátil de sesión actual. Campos: id, session_id, vector_unnormalized, weight_sum, updated_at. Purga después de N horas inactividad.

**`cohort_centroids`** — centroides de cohortes para cold start. Campos: cohort_id, centroid_vector, n_users_in_cohort, last_recompute_at.

**`co_occurrence`** — matriz dispersa de co-ocurrencia. Campos: product_a_id, product_b_id (con `a < b`), count (con peso), last_seen_at. Índice compuesto en `(product_a_id, product_b_id)`.

**`co_occurrence_top`** — top-50 NPMI por producto, denormalizado para queries rápidas. Campos: product_id, related_product_id, npmi_score, rank.

**`excluded_products`** — lista de exclusión con TTL. Campos: id, anonymous_id, user_id, product_id, excluded_at, ttl_until.

**`searches`** — log de búsquedas. Campos: id, anonymous_id, user_id, raw_query, normalized_json (JSONB), prompt_version, search_method (bm25/cosine/hybrid), results_count, hit_cache, called_mock, occurred_at.

**`product_query_cache`** — cache de búsquedas resueltas. Campos: id, query_hash, query_embedding (vector), normalized_json, products_returned, created_at, ttl_until.

**`mock_calls`** — log de llamadas al mock. Campos: id, called_at, params, response_size, simulated_cost, latency_ms, was_error.

**`orders`**, **`order_items`** — órdenes con su estado y snapshot de productos. Como en v1.1.

**`eval_holdout`** — eval set para métricas. Campos: id, user_id, product_id, purchased_at, used_in_eval (bool).

### Decisiones de diseño

- JSONB para campos variables (atributos enriquecidos varían por categoría)
- Vectores en mismas tablas con `pgvector` (no tabla separada)
- `tsvector` indexado con GIN para BM25 rápido
- Snapshot en order_items (orden histórica permanece coherente si producto cambia)
- Anonymous_id en todas las tablas de comportamiento (continuidad antes/después del registro)

---

## 14. Roadmap por fases

### Fase 0 · Fundaciones (½ - 1 día)

- Setup proyecto + Postgres + pgvector + tsvector + GIN
- Modelo de datos completo (todas las tablas de sección 13)
- Auth básico
- Estructura de carpetas con los 5 sectores
- Mock funcional con fixture de 500 productos

**Criterio de aceptación:** BD vacía con todas las tablas creadas, login funcionando, mock devuelve 25 productos.

### Fase 1 · E-commerce básico + tracking (1-2 días)

- Home con grid de productos (al inicio sin personalización)
- Detalle de producto
- Búsqueda por texto plano (LIKE)
- Carrito y checkout simulado
- **Tracking completo de eventos desde el primer instante**, con anonymous_id
- Cron que llama al mock periódicamente
- Pipeline de enriquecimiento (LLM normaliza categoría + embedding + tsvector)

**Criterio de aceptación:** sesión completa funcional, eventos registrados con timestamp y anonymous_id, productos del cron persistidos con embedding y tsvector.

### Fase 2 · Búsqueda híbrida (1-2 días)

- LLM normaliza queries → JSON estructurado, prompt versionado
- Cache de queries con hash exacto
- Cache semántico con $\theta$ inicial; plan de calibración documentado
- BM25 + cosine en paralelo, fusión por RRF
- Llamada al mock cuando hay miss + confidence aceptable
- Skeleton honesto durante la espera
- Vista de búsquedas en admin

**Criterio de aceptación:** búsqueda híbrida supera búsqueda LIKE en relevancia subjetiva en ≥ 70% de un set de 30 queries reales. Cache hit en repetición. No se llama al mock con confidence < 0.5.

### Fase 3 · Personalización — Tres sub-fases incrementales

La personalización es el sector más complejo. Se construye en sub-fases, cada una con valor medible. Si una sub-fase no entrega mejora de métricas, se itera ahí antes de avanzar.

#### Fase 3a · Personalización básica (vector único)

- Cálculo de vector de perfil (único por usuario, sin multi-modo aún) con pesos y decay
- Vector de sesión separado, $\alpha$ dinámico
- Actualización incremental (`vector_unnormalized` + `weight_sum`)
- Lista de exclusión con TTL
- Cold start con prior por cohorte y shrinkage bayesiano
- Retrieval simple: top-K cercanos al vector
- Mezcla con popularidad por cohorte (sin RRF aún, slot allocation crudo)
- Vista del usuario en admin

**Criterio de aceptación:** Recall@10 sobre holdout temporal supera baseline (top-popular puro) en al menos +20%. Usuario cold-start con onboarding muestra feed coherente desde evento 1.

#### Fase 3b · Multi-vector + grafo de co-ocurrencia + RRF

- Multi-vector usuario (1-3 modos, k-means semanal)
- Grafo de co-ocurrencia con counts incrementales y NPMI nocturno
- Fuente B (co-ocurrencia con último visto) integrada al pipeline
- Fusión por RRF de las 3+ fuentes
- Vista de modos del usuario en admin
- Vista de NPMI top en admin

**Criterio de aceptación:** Recall@10 mejora respecto a Fase 3a en al menos +15%. nDCG@10 mejora. Diversidad inter-usuario (Jaccard guardrail) en rango [0.05, 0.40].

#### Fase 3c · MMR + LLM reranker

- MMR sobre top-100 del RRF → top-30
- LLM reranker contextual top-30 → top-10
- Razones generadas por el LLM en cada tarjeta
- Métrica de latencia del feed (p50, p99)

**Criterio de aceptación:** nDCG@10 mejora respecto a Fase 3b. Latencia p99 del feed < 1.5s. Razones generadas son coherentes (auditoría manual de 50 casos).

### Fase 4 · Admin completo (1-2 días)

- Vistas operativas (órdenes, qué comprar, saldo, productos)
- Vistas de auditoría (usuarios individuales con sus modos, búsquedas con confidence baja, NPMI top, eval set)
- Estados de excepción
- Dashboard con métricas

**Criterio de aceptación:** se puede operar el negocio entero desde el admin. Auditar un caso individual completo (qué le recomienda y por qué) toma < 1 minuto.

### Fase 5 · Validación y eval set

- Construcción del eval set con holdout temporal sobre data acumulada
- Cálculo de Recall@k, nDCG@k, MRR para los rankings actuales
- A/B comparación contra baselines simples
- Calibración empírica de $\theta$ del cache semántico (sección 9)
- Documento de resultados de validación contra las 4 hipótesis

**Criterio de aceptación:** las 4 hipótesis tienen respuesta documentada con datos. Decisión clara sobre seguir a producción real.

### Roadmap v2 (cuando haya tracción)

- Two-tower fine-tuned con DPR
- Item2vec entrenado en sesiones
- Cross-encoder reranker (BGE) sustituyendo el LLM cuando latencia importe
- Multi-objective ranking explícito con $\lambda$ aprendidos por bandit contextual
- Mezcla del feed por bandit (LinUCB o Thompson sampling) en lugar de proporciones fijas

---

## 15. Métricas de éxito y validación

**Cambio importante respecto a v1.1.** Las métricas primarias son las estándar de la industria de IR/recsys, no Jaccard.

### Métricas primarias (calidad de recomendación)

Para construirlas se usa **holdout temporal**: data hasta fecha $t^*$ es el "pasado" (entrenamiento), data después de $t^*$ es el "futuro" (eval). Para cada usuario que compró algo después de $t^*$:

> Si yo no supiera nada de lo que pasó después de $t^*$, ¿mi sistema le habría mostrado en el top-k el producto que efectivamente compró?

- **Recall@k** = fracción de "compras del futuro" capturadas en el top-k del feed que el sistema le habría mostrado.
- **nDCG@k** = lo mismo ponderado por posición (hit en posición 1 vale más que en posición 10).
- **MRR** = $\mathbb{E}[1/\text{rank}_{\text{primer hit}}]$.
- **Hit Rate@k** = fracción de sesiones donde la compra estaba en el feed.

Valores objetivo razonables para MVP:
- Recall@10 ≥ 0.20 (1 de cada 5 compras estaba en el top-10 del feed que se le habría mostrado)
- nDCG@10 ≥ 0.15
- MRR ≥ 0.10

Estos números se contrastan contra **baseline simple** (top-popular por cohorte). El sistema debe superar el baseline. Si no lo supera, hay un bug.

### Métricas guardrail (no primarias, detección de bugs)

- **Diversidad inter-usuario (Jaccard).** Para usuarios distintos, $\mathbb{E}[\text{Jaccard}(T_{j_1}, T_{j_2})]$ debe estar en $[0.05, 0.40]$. Si es < 0.05, hay bug (todo es random). Si es > 0.40, el sistema no personaliza.
- **Estabilidad intra-usuario (Jaccard).** Mismo usuario sesiones consecutivas: $> 0.5$. Si es < 0.3, el sistema es inestable.

### Métricas técnicas

- Latencia p50 búsqueda local: < 200ms
- Latencia p99 búsqueda con mock: < 4s
- Latencia p99 feed home (incluyendo LLM reranker): < 1.5s
- Tasa hit cache de queries: > 60% después de 100 búsquedas
- Costo simulado por usuario activo: medido y proyectado a producción

### Métricas del LLM

- **Coherencia de normalización.** Sobre 50 queries: % normalizado correctamente según evaluación humana. Objetivo > 85%.
- **Coherencia de razones del reranker.** Sobre 50 razones generadas: % coherentes. Objetivo > 80%.

### Calibración del umbral del cache semántico

Documentado como parte de la Fase 5. Procedimiento:
1. ~10.000 queries reales loggeadas
2. Distribución de cosine entre pares aleatorios (negativos)
3. ~200 pares manualmente etiquetados como equivalentes (positivos)
4. $\theta$ = umbral con FPR ≤ 0.1% sobre la negativa

### Validación de las 4 hipótesis

- **H1.** Recall@10/nDCG@10 superan baseline → personalización es real
- **H2.** Hybrid search supera búsqueda plana en queries reales → IA agrega valor
- **H3.** Costo simulado por usuario activo proyectado a producción es viable
- **H4.** Recall@10 para usuarios cold-start (post-onboarding) es positivo desde evento 1

---

## 16. Trampas comunes

**1. Empezar por el algoritmo antes que el tracking.** Si el algoritmo se construye antes que la captura, no tiene datos. Orden correcto: tracking → algoritmo → admin.

**2. Schema sucio en eventos.** Sin schema fijo desde el inicio, en mes 3 hay basura no recuperable.

**3. Optimizar prematuramente.** Postgres aguanta todo lo de MVP. Optimizar cuando se sienta dolor real.

**4. Ignorar el cold start.** El sistema cold-start con prior bayesiano debe ser parte del MVP, no extra.

**5. Mock demasiado simple.** Sin latencia variable, sin errores, productos repetitivos → valida un mundo que no existe.

**6. Saltarse la fusión de identidades al registrarse.** Trabajo de Fase 1, no posterior.

**7. Confiar en el feed sin validar Recall@k.** Personalización "que se ve bien" pero sin métricas duras = bug invisible.

**8. Acumular tareas pendientes en lugar de cerrar fases.** Cada fase se cierra con su criterio o no se avanza.

**9. (Nueva en v1.2) Modelar usuario como punto único.** Si el usuario tiene gustos en clusters distintos, el promedio cae lejos de todos. El multi-modo no es opcional para historiales con suficientes eventos.

**10. (Nueva en v1.2) Esperar que el cosine resuelva cross-sell.** No lo hace. Hay que construir el grafo de co-ocurrencia desde el día uno.

**11. (Nueva en v1.2) Pesos negativos para "alejar".** Restar un vector aleja también a sus vecinos comerciales. Usar filtros con TTL.

**12. (Nueva en v1.2) Umbrales arbitrarios.** $\theta = 0.92$ porque "suena razonable" no es defendible. Calibrar empíricamente.

---

## 17. Glosario

**Anonymous_id.** UUID asignado al navegador en la primera visita, persistido en cookie.

**BM25.** Función de ranking clásica de full-text search. Sparse, basada en frecuencia de términos. Brilla con nombres propios, SKUs, talles exactos.

**Co-ocurrencia.** Frecuencia con que dos productos aparecen juntos en el comportamiento del usuario (vista, carrito, compra).

**Cohorte.** Grupo de usuarios con perfil demográfico similar. Usado para cold start y popularidad calibrada.

**Cold start.** Estado de un usuario sin historial. Se resuelve con prior bayesiano por cohorte + shrinkage.

**Cosine similarity.** Producto interno entre dos vectores normalizados. Métrica del espacio semántico.

**Cron job.** Tarea programada periódica. En este sistema, el que llama al mock para refrescar catálogo.

**Decay temporal.** Reducción del peso de un evento conforme pasa el tiempo. Función exponencial con vida media $\tau$.

**Embedding.** Vector que representa un producto o usuario en el espacio semántico.

**Feed.** Lista personalizada de productos en home u otras vistas dinámicas.

**Hit / Miss.** Hit: la búsqueda encontró resultados en cache local. Miss: tuvo que llamar al mock.

**Holdout temporal.** Técnica de evaluación donde data anterior a fecha $t^*$ es entrenamiento y posterior es eval.

**Hybrid search.** Búsqueda que combina BM25 (sparse) con búsqueda semántica (denso). Robusta a queries muy literales y muy semánticas.

**LLM reranker.** Capa final del pipeline donde un LLM reordena los top-30 candidatos a top-10 con justificación textual.

**MMR (Maximal Marginal Relevance).** Algoritmo de selección iterativa que balancea relevancia con diversidad. Reemplaza al slot allocation por cuotas.

**Mock.** Implementación falsa que simula la API agregadora real. Único componente simulado del sistema.

**Multi-vector user representation.** Modelar al usuario con 1-3 vectores (modos) en lugar de uno único, capturando gustos multimodales.

**nDCG@k.** Métrica de IR. Hit en posición 1 vale más que en posición 10. Estándar de la industria.

**NPMI (Normalized Pointwise Mutual Information).** Métrica del grafo de co-ocurrencia. Mide cuánto dos productos co-ocurren más allá del azar. Rango [-1, 1].

**Pagador-receptor.** Modelo donde el usuario que paga (Miami) no es el destinatario (La Habana). Cada destinatario tiene sus propios vectores.

**pgvector.** Extensión de PostgreSQL para vectores. Núcleo de la similitud semántica.

**Recall@k.** Fracción de eventos relevantes (compras futuras) capturados en el top-k del feed. Métrica primaria de validación.

**Reranking.** Reordenar resultados según criterios adicionales (perfil, contexto, multi-objective).

**RRF (Reciprocal Rank Fusion).** Algoritmo de fusión de listas con escalas distintas. Score-free, opera sobre rangos. $\text{RRF}(d) = \sum_r 1/(k_0 + \text{rank}_r(d))$ con $k_0 = 60$.

**Shrinkage bayesiano.** Mezcla ponderada entre el vector observado y un prior, con peso del prior decreciente conforme aumentan las observaciones.

**Slot allocation.** Asignación de posiciones del feed a buckets por cuota. Reemplazado en v1.2 por MMR (más correcto matemáticamente).

**Stale.** Producto cuyo último refresh es más viejo que TTL.

**TTL (Time To Live).** Tiempo durante el cual un dato se considera válido.

**Two-tower retrieval.** Arquitectura de retrieval donde dos redes neuronales codifican usuario y producto en un mismo espacio. Diferida a v2.

**Vector de perfil / sesión.** Doble representación del usuario: perfil (consolidado, $\tau = 60$ días) y sesión (volátil, $\tau = 30$ min).

---

## 18. Referencias

Lecturas técnicas que justifican las decisiones de diseño. En orden de utilidad para entender el sistema:

1. **Karpukhin et al., *Dense Passage Retrieval*, EMNLP 2020.** El paper canónico de retrieval moderno. Two-tower, in-batch negatives, hard negatives.

2. **Pal et al., *PinnerSage*, KDD 2020 (Pinterest).** Multi-vector user representation. Justifica el diseño multi-modo del Sector D.

3. **Carbonell & Goldstein, *MMR*, SIGIR 1998.** El paper original de Maximal Marginal Relevance. Corto y leíble.

4. **Cormack et al., *Reciprocal Rank Fusion*, SIGIR 2009.** Solo 2 páginas. Justifica RRF como método de fusión.

5. **Barkan & Koenigstein, *Item2Vec*, 2016.** Para v2: embeddings entrenados en sesiones, no en descripciones.

6. **Yi et al., *Sampling-Bias-Corrected Neural Modeling*, RecSys 2019 (Google).** Producción a escala real (YouTube).

7. **Hidasi et al., *Session-Based Recommendations with RNNs*, ICLR 2016.** Justifica la separación sesión/perfil.

8. **Robertson & Zaragoza, *The Probabilistic Relevance Framework: BM25 and Beyond*, 2009.** Fundamentos de BM25.

9. **Bouma, *Normalized PMI*, 2009.** La métrica usada en el grafo de co-ocurrencia.

---

## Cierre

Este documento es la versión 1.2 del diseño tras revisión técnica externa. Los cambios respecto a v1.1 reflejan principios sólidos del estado del arte en sistemas de recomendación en 2026: usuario como distribución multimodal (PinnerSage), espacios separados para semántica y co-compra, fusión robusta con RRF, diversificación con MMR, reranking contextual.

La complejidad agregada se concentra en el Sector D, que es donde está el corazón del producto. Los demás sectores son sustancialmente iguales y simples.

El siguiente paso es implementar Fase 0 con este documento como contexto, y avanzar fase a fase respetando cada criterio de aceptación.
