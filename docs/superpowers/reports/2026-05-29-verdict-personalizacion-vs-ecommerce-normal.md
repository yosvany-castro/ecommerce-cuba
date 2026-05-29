# ¿Vale la pena esta personalización vs un ecommerce normal?

**Fecha:** 2026-05-29 · **Branch:** `audit/ranker-pipeline-2026-05-29`
**Método:** conduje el sistema real como comprador (test_schema, catálogo de 42
productos con embeddings Voyage reales, eventos reales, feed/búsqueda reales).
9 experimentos reproducibles en `scripts/audit-explore/`. Costo ~$0.10.

> Esto es un juicio de **arquitectura de producto**, basado en mediciones, no en
> opinión. La pregunta del dueño: ¿la maquinaria cara y compleja (perfiles
> multi-vector + máquina de estados de cohortes + reranker LLM) gana lo
> suficiente sobre un "ecommerce normal bien hecho" (buena búsqueda + categorías
> + popular/trending + "comprados juntos" + "más como lo que estás viendo")?

---

## Respuesta corta

**Para ESTE negocio (reseller Cuba: pesado en regalos, tienda nueva con datos
escasos, sensible al costo, sin stock físico) la mayor parte del valor se logra
con la mitad BARATA del sistema. La mitad CARA (cohortes + reranker LLM) hoy
aporta poco y, en el caso de uso dominante —regalos— activamente estorba.**

Recomendación: **enviar ya la mitad barata; secuenciar/condicionar la cara.**
No es "tirar la personalización", es **reasignar el gasto** a donde paga.

---

## La evidencia (qué probó cada experimento)

| Exp | Qué medí | Resultado |
|---|---|---|
| 1 | Perfil mono-intención | ✅ adapta perfecto (10/10 en clúster, razones concretas) |
| 2 | Shift de intención en sesión | ✅ pivota, pero **contamina el modo** y hace cohort-switching duro |
| 3 | Cross-sell (co-ocurrencia vs coseno) | ✅ surfacea **complementos** (Mouse/Teclado, Tacones/Cartera) que el coseno hunde bajo sustitutos; los inyecta al feed |
| 4 | Usuario multi-modo (k-means) | ✅ 2 modos separados, feed mezcla ambos |
| 6 | **Comprador de regalos** (niña→mamá→papá) | ❌ feed contaminado entre destinatarios (feed de "mamá" = 50% juguetes) |
| 7 | **Reranker LLM vs MMR** | ❌ **mismos 10 productos** (overlap 10/10); solo reordena 7 + agrega frases; **+6.6 s** y 1 llamada DeepSeek por feed |
| 8 | **Lift vs baselines** (MRR sobre target long-tail) | P=0.180, "más como lo último visto"=0.118, popular-cohort=0.000, popular-global=0.000 |
| 9 | Lag de cohorte + duplicados | ❌ flip de cohorte tarda **~4 eventos**; **feed con producto duplicado** (10 items, 8 únicos) |

---

## Veredicto componente por componente (KEEP / SIMPLIFICAR / CORTAR)

### ✅ KEEP — la "mitad barata" que SÍ paga (esto es tu MVP real)
- **Búsqueda híbrida (BM25 + coseno + intent LLM).** Funciona: exacto
  ("Nike Air Zoom"), vago ("algo elegante para una fiesta"→vestidos), y extrae
  destinatario/edad/precio. Es el corazón de cualquier ecommerce. (exp5)
  - *Pendiente:* propagar `recipient_*` al ranking (hoy se descarta) y opcional
    tilt por perfil. Barato, alto impacto.
- **Co-ocurrencia / "comprados juntos" (NPMI).** Barato (sin LLM, sin GPU),
  captura relación comercial real que el coseno no ve. **Esto es lo más
  diferenciador y más barato a la vez.** (exp3)
- **"Más como lo que estás viendo" (coseno del último visto).** MRR 0.118 — solo
  con esto capturas **~65%** del beneficio de toda la personalización, sin
  perfiles ni cohortes ni LLM. (exp8)
- **Popular/trending por categoría + filtros de destinatario.** Para el "head"
  del catálogo (lo que sí tiene ventas). Complementa, no compite, con lo de
  arriba.

### 🟡 SIMPLIFICAR / CONDICIONAR — valor real pero mal asignado
- **Perfil semántico (vector de usuario).** Añade ~50% de MRR sobre "último
  visto" para **descubrir long-tail** (items nuevos sin historial de ventas) —
  relevante para un reseller que agrega inventario nuevo constantemente. PERO
  solo aporta para usuarios **logueados, con gusto coherente (no regalo) y con
  historial suficiente** → minoría al inicio. **Condicionar** su activación a
  "logueado + N eventos + intención de compra propia".
- **Cohortes + shift-detection.** Útil en teoría, pero hoy: lag de ~4 eventos
  (exp9), contamina modos (exp2/6) y **rompe el caso de regalos** (exp6). En un
  reseller Cuba donde regalar es central, esto resta más de lo que suma.

### 🔴 CORTAR / DIFERIR para el MVP
- **Reranker LLM (DeepSeek).** Es la pieza MÁS cara y la que MENOS aporta:
  **no cambia qué productos se muestran** (idénticos al MMR, exp7), solo
  reordena y escribe frases, a **+6.6 s y una llamada de API por feed** (la
  compuerta es p99<1.5 s), y **introduce el bug de duplicados** (exp9). 
  - *Reemplazo:* MMR determinista (ya existe, ~520 ms) para el orden +
    **razones por plantilla** desde atributos+contexto ("Combina con el iPhone
    que viste", "Precio acorde a tu rango") — 90% del valor percibido, ~1% del
    costo y latencia. Reservar el LLM para un futuro modo "premium" o prewarm de
    cohorts populares, con Anthropic Haiku + prompt caching.

---

## La cuenta de "vale la pena" en una línea

| Capa | Costo | Valor (este negocio) | Veredicto |
|---|---|---|---|
| Búsqueda híbrida + intent | bajo | alto | **KEEP** |
| Co-ocurrencia (comprados juntos) | muy bajo | alto | **KEEP** |
| "Más como lo último visto" | muy bajo | medio-alto (65% del total) | **KEEP** |
| Popular por categoría/destinatario | bajo | medio (head) | **KEEP** |
| Perfil semántico multi-vector | medio | bajo-medio (tail, repeat users) | **CONDICIONAR** |
| Cohortes + shift detection | medio | negativo en regalos | **SIMPLIFICAR** |
| Reranker LLM | **alto ($ + 7 s/feed)** | bajo (orden+frases) | **CORTAR/DIFERIR** |

**Conclusión:** un "ecommerce normal **bien hecho**" (búsqueda con intent +
comprados-juntos + más-como-esto + popular con filtros) te da ~80% del resultado
a una fracción del costo y la latencia, y **sin** romperse con los regalos. La
personalización profunda (perfil + cohortes + LLM) es una **fase 2**, para cuando
tengas tráfico, usuarios logueados recurrentes y datos — y aun así el reranker
LLM necesita repensarse (latencia, costo, duplicados, regalos).

---

## Bugs nuevos encontrados conduciendo el sistema (sumar a los reportes de código)

- **[P2] Producto duplicado en un mismo feed.** `rerank.ts` valida ranks únicos
  pero **no** product_ids únicos → el LLM puede repetir un item. Reproducido:
  feed women-luxury con 10 items / 8 únicos (exp9). Fix: validar product_ids
  distintos en `responseSchema`/post-parse.
- **[P2] Lag de cohorte ~4 eventos + contaminación de modo.** El cohort tarda
  ~4 señales contradictorias en cambiar; durante ese lag el feed sirve el cohort
  equivocado y los eventos se acumulan en el modo equivocado (exp6/exp9). En
  regalos esto significa "siempre un destinatario atrás".
- **[P1 producto] Sin modelo de "regalo".** Toda la arquitectura asume que el
  historial = gusto del usuario. En un reseller, mucho historial = regalos para
  terceros → el perfil se envenena. Necesita separar "para mí" vs "regalo"
  (recipient explícito) ANTES de invertir más en perfiles.

---

## Reproducir
```
npx tsx scripts/audit-explore/00-seed.ts
npx tsx scripts/audit-explore/0{1..9}-*.ts   # 01 luxury, 02 shift, 03 xsell,
                                             # 04 multimodal, 05 search, 06 gift,
                                             # 07 reranker-value, 08 lift, 09 dup/cohort
```
