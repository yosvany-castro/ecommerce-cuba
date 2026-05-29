# ¿Vale la pena esta personalización vs un ecommerce normal?

**Fecha:** 2026-05-29 · **Branch:** `audit/ranker-pipeline-2026-05-29`
**Método:** conduje el sistema real como comprador (test_schema, catálogo de 42
productos con embeddings Voyage reales, eventos reales, feed/búsqueda reales).
9 experimentos reproducibles en `scripts/audit-explore/`. Costo ~$0.10.

> Juicio de **arquitectura de producto**, con números medidos (no opinión). Todos
> los valores de abajo salen de líneas `MARKER_*` de corridas limpias; corregí un
> borrador previo que tenía cifras escritas ANTES de medir.
>
> Caveat honesto: catálogo de 42 ítems y usuarios sintéticos de gusto coherente.
> Sirve para comparar **mecanismos**, no es un eval de producción. Donde el tamaño
> chico sesga el resultado, lo digo.

---

## Respuesta corta

**La mitad BARATA del sistema entrega casi todo el valor. La mitad CARA (perfil
multi-vector + máquina de cohortes + reranker LLM) hoy aporta poco medible y, en
el caso de uso dominante del negocio —regalos—, activamente estorba.**

No es "tirar la personalización": es **secuenciarla y reasignar el gasto**.

---

## El dato que más pesa (exp8 — lift sobre un target long-tail)

Para cada usuario holdeé un ítem de su gusto SIN señal de popularidad (la cola
larga, justo lo que un buscador/popular no encuentra) y medí su rank bajo 4
estrategias. **MRR (más alto = mejor):**

| Estrategia | MRR | recall@10 |
|---|---|---|
| **"Más como lo que estás viendo"** (coseno del último ítem, **cero perfil**) | **0.233** | 1.00 |
| Retrieval personalizado (vector de perfil) | 0.225 | 1.00 |
| Popular por cohorte | 0.042 | 0.33 |
| Popular global | 0.017 | 0.00 |

**Lectura:** el coseno simple "más como esto" **igualó (de hecho superó por poco)**
al stack de perfil completo, y la popularidad **no encuentra la cola** (MRR ~0).
Es decir: el valor está en **retrieval por contenido (coseno) + co-ocurrencia**,
no en la maquinaria pesada de perfil/cohorte/LLM. La popularidad sirve para el
"head" (lo que ya se vende), no para descubrir.

---

## El reranker LLM no cambia QUÉ se muestra (exp7)

Mismo perfil, mismos top-30; comparé reranker LLM vs fallback MMR:

- **set_overlap = 10/10** → el LLM devuelve **exactamente los mismos 10 productos**
  que el MMR. Solo **reordena 7** y reescribe las frases.
- **latency:** LLM 4591 ms vs MMR 4429 ms → **overhead del LLM ≈ 162 ms** en esta
  corrida (DeepSeek caliente). OJO: el grueso (~4.4 s) es el **pipeline de DB**
  (muchas queries secuenciales contra el pooler free-tier), NO el LLM. F3c midió
  llamadas frías de 5–7 s, así que la latencia del LLM es **bimodal** (rápida
  caliente, lenta fría) — pero **el cuello de botella real del feed es la DB**.

**Conclusión:** el reranker es la pieza más cara (1 llamada de API por feed) y la
que menos mueve la aguja (no cambia el set; reordena + frases). Su latencia es
variable; el problema de latencia que SÍ hay que atacar es el fan-out de queries.

---

## La evidencia completa (qué probó cada experimento)

| Exp | Qué medí | Resultado |
|---|---|---|
| 1 | Perfil mono-intención | ✅ adapta perfecto (10/10 en clúster, razones concretas) |
| 2 | Shift de intención en sesión | ✅ pivota, pero contamina el modo y hace cohort-switching duro |
| 3 | Cross-sell (co-ocurrencia vs coseno) | ✅ surfacea **complementos** (Mouse/Teclado, Tacones/Cartera) que el coseno hunde bajo sustitutos; los inyecta al feed (Funda #1 / Cargador #2 tras ver iPhone) |
| 4 | Usuario multi-modo (k-means) | ✅ 2 modos separados (joyería 0.94 / ropa 0.91), feed mezcla ambos |
| 6 | **Comprador de regalos** (niña→mamá→papá) | ❌ feed contaminado entre destinatarios (feed "para sobrina" = 6 juguetes + 4 deporte de hombre) |
| 7 | **Reranker LLM vs MMR** | ❌ mismos 10 productos (overlap 10/10), +162 ms LLM, DB ~4.4 s domina |
| 8 | **Lift vs baselines** | "más como esto" (0.233) ≈ perfil (0.225) ≫ popular (0.04/0.02) |
| 9 | Lag de cohorte + duplicados | ❌ cohort sirve el destinatario equivocado ~3 eventos; duplicados NO observados (riesgo latente) |

---

## Veredicto componente por componente

### ✅ KEEP — la mitad barata (tu MVP real)
- **Búsqueda híbrida (BM25 + coseno + intent LLM).** Exacto ("Nike Air Zoom"),
  vago ("algo elegante para una fiesta"→vestidos), extrae destinatario/edad/precio
  (exp5). Corazón del ecommerce. *Pendiente:* propagar `recipient_*` al ranking
  (hoy se descarta) — barato, alto impacto.
- **Co-ocurrencia / "comprados juntos" (NPMI).** Sin LLM, sin GPU; captura relación
  comercial que el coseno no ve (exp3). Lo más diferenciador y más barato a la vez.
- **"Más como lo que estás viendo" (coseno del ítem actual).** En exp8 igualó al
  stack de perfil completo. Es el motor de recomendación más barato y de mayor ROI.
- **Popular/trending por categoría + filtros de destinatario.** Para el head.

### 🟡 CONDICIONAR — valor real pero acotado
- **Perfil semántico (vector de usuario).** Su ventaja sobre "más como esto" fue
  **nula** en exp8. Donde SÍ aporta: el **home feed sin ítem ancla** (entras sin
  estar mirando nada) y el blend multi-interés (exp4). Vale, pero **condicionar** a
  "logueado + N eventos + compra propia (no regalo)". No es prioridad de MVP.
- **Cohortes + shift-detection.** Lag de ~3 eventos (exp9): durante el cambio de
  destinatario sirve el cohort equivocado y **envenena el modo** (exp6). En un
  reseller donde regalar es central, resta.

### 🔴 CORTAR / DIFERIR para el MVP
- **Reranker LLM (DeepSeek).** No cambia el set (exp7), cuesta 1 llamada por feed,
  latencia bimodal, y su única ganancia real son las **frases**. *Reemplazo:* MMR
  determinista (ya existe) para el orden + **razones por plantilla** desde
  atributos+contexto ("Combina con el iPhone que viste", "Precio acorde a tu
  rango") → ~90% del valor percibido a ~1% del costo. Reservar el LLM para un
  modo "premium" futuro con Anthropic Haiku + prompt caching y prewarm.

---

## La cuenta en una tabla

| Capa | Costo | Valor (este negocio) | Veredicto |
|---|---|---|---|
| Búsqueda híbrida + intent | bajo | alto | **KEEP** |
| Co-ocurrencia (comprados juntos) | muy bajo | alto | **KEEP** |
| "Más como lo que estás viendo" | muy bajo | alto (≈ perfil en exp8) | **KEEP** |
| Popular por categoría/destinatario | bajo | medio (head) | **KEEP** |
| Perfil semántico multi-vector | medio | bajo medible hoy | **CONDICIONAR** |
| Cohortes + shift detection | medio | negativo en regalos | **SIMPLIFICAR** |
| Reranker LLM | alto ($/feed) | bajo (orden + frases) | **CORTAR/DIFERIR** |

**Conclusión:** un "ecommerce normal **bien hecho**" (búsqueda con intent +
comprados-juntos + más-como-esto + popular con filtros) entrega ~80% del resultado
a una fracción del costo, sin romperse con regalos. La personalización profunda
(perfil + cohortes + LLM) es **fase 2**, para cuando haya tráfico, usuarios
logueados recurrentes y datos.

---

## Bugs / riesgos nuevos hallados conduciendo el sistema

- **[P2 latente] Producto duplicado posible en un feed.** `rerank.ts` valida ranks
  únicos pero **no** product_ids únicos → el LLM PODRÍA repetir un item. **No lo
  observé** en mis corridas (0 dups en 3 personas, exp9), pero el guard falta. Fix
  barato: validar product_ids distintos en el parse.
- **[P2] Lag de cohorte ~3 eventos + contaminación de modo (exp6/exp9).** Al cambiar
  de destinatario, el feed sirve el cohort anterior por ~3 vistas y esos eventos se
  acumulan en el modo equivocado. "Siempre un destinatario atrás."
- **[P1 producto] No hay modelo de "regalo".** Toda la arquitectura asume
  historial = gusto del usuario. En un reseller, mucho historial = regalos para
  terceros → el perfil se envenena (exp6: 3 buckets de cohorte, ninguno = el
  usuario). Separar "para mí" vs "regalo" (recipient explícito) ANTES de invertir
  más en perfiles.
- **[perf] El feed está dominado por ~4.4 s de queries secuenciales de DB** sobre
  el pooler free-tier — más que por el LLM. Si la latencia importa, paralelizar/
  reducir el fan-out de queries en `generateFeed` rinde más que cambiar de LLM.

---

## Reproducir
```
npx tsx scripts/audit-explore/00-seed.ts
for f in 01-women-luxury 02-intent-shift 03-crosssell 04-multimodal 05-search \
         06-gift-shopper 07-reranker-value 08-lift-vs-baselines 09-dup-cohort-probe; do
  npx tsx scripts/audit-explore/$f.ts
done
```
