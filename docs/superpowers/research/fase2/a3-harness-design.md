# A3 — Diseño del harness del gate ≥2x: simulador NO estacionario, agente real vs motor congelado

**Fecha:** 2026-06-11 · **Branch:** `feat/thesis-personalization-program`
**Fuentes:** código instalado leído entero (`src/thesis/data/behavior-model.ts`, `src/thesis/data/catalog-model.ts`, `scripts/_audit/exp-j-closed-loop.ts`, `scripts/_audit/exp-k-pop-sweep.ts`, `scripts/_audit/lib.ts`, `src/sectors/f-slate/{compose,config}.ts`, `src/sectors/f-slate/rules/{types,schema,evaluate}.ts`, `src/sectors/f-slate/sections/registry.ts`, `src/sectors/d-personalization/explore/epsilon.ts`, migraciones 0023–0029), `node_modules/deepagents/dist/index.d.ts` (firma `createDeepAgent` líneas 3064–3200), auditoría destructiva `docs/auditoria-destructiva-f6-2026-06-09.md`, y los informes hermanos A1 (`a1-deepagents-langgraph-api.md`) y A2 (`a2-deepseek-v4-langchain.md`, pricing verificado 2026-06-11). Ninguna API citada viene de memoria.

---

## 0. Resumen del diseño en una página

- **Mundo:** behavior-model v2 (Zipf + elasticidad + `exposurePolicy`) + **un (1) knob aditivo nuevo** `attractivenessById` con test de regresión bit-idéntica. El harness controla la NO estacionariedad **fuera** del generador: vistas de catálogo por época (precios mutados, disponibilidad), atractividad por época (shifts de demanda, lanzamientos). El panel de usuarios es idéntico entre épocas y brazos (mismo seed, patrón exp-J).
- **Dos brazos, mismo mundo, misma maquinaria:** ambos corren el MISMO compositor de slates que lee una tabla `ui_placements` in-memory con la MISMA semántica que `compose.ts` (reutiliza `evaluateRule` real), los MISMOS "crons" de datos (popularidad ventana 1 época ≈ 7-14d, NPMI ventana 6 épocas ≈ 90d, reconstruidos del log PROPIO de cada brazo), el MISMO ε=0.1, el MISMO cascade λ=0.85. **Lo único que difiere: quién escribe `ui_placements` entre épocas** (nadie vs el agente merchandiser real con DeepSeek v4).
- **Calendario:** época 0 orgánica (warmup compartido, fuera del gate) → época 1 config congelada en ambos brazos (bit-idéntica, fuera del gate) → el agente decide en las fronteras de las épocas 2..13 → **gate = Σ margen realizado de las épocas 2..13**.
- **Gate:** N=5 seeds vírgenes; ratio por seed; media geométrica Ĝ con CI95 t sobre log-ratios. **PASA si Ĝ ≥ 2.0 ∧ CI95-inferior > 1.0 ∧ ratio > 1.0 en TODOS los seeds.** 1.9x = FAIL sin redondeo. Escalada única pre-registrada a N=10 si Ĝ≥2 pero CI ancho.
- **Coste:** ~60 runs LLM (12 decisiones × 5 seeds) ≈ **$0.66 con v4-pro** (peor caso pricing 4×: $2.64). Cómputo: ~130 llamadas a `sampleBehavior` (users=1000, universo=3000) ≈ 10 min de CPU en 2 cores; wall total ~15-20 min con seeds en paralelo (LLM es I/O-bound). `--smoke`: <5 min, ~$0.04.
- **Anti-trampa:** 15 controles explícitos (§8), cada uno mapeado a un hallazgo de la auditoría F6 que lo motivó.

---

## 1. El mundo no estacionario (Q1)

### 1.1 Por qué NO se puede hacer mutando el catálogo a ciegas (3 trampas del generador)

Leído `sampleBehavior` completo, hay tres acoplamientos que rompen el panel o reordenan la demanda si se muta el catálogo entre épocas:

1. **`distinctSubcategories(catalog)` alimenta la generación de usuarios** (`behavior-model.ts:529,539-547`): si una época elimina la última unidad de una subcategoría, `allSubs` cambia → los draws de taste cambian → **otro panel de usuarios** → los brazos dejan de ser comparables. Lo mismo si un lanzamiento introduce una subcategoría nueva.
2. **La asignación Zipf interna se baraja sobre la lista de ids del catálogo** (`behavior-model.ts:502-521`): añadir/quitar UN producto re-baraja TODA la asignación de atractividad → un "shift" pequeño reordenaría la demanda del mundo entero — no estacionariedad accidental, no controlada, no defendible.
3. **La siembra de complementos resuelve por `productById`** (`behavior-model.ts:738-774`): un complemento "agotado" seguiría entrando en cestas si el mapa lo contiene.

### 1.2 Solución: catálogo-universo inmutable + 1 knob nuevo + vistas por época

**El array de catálogo que recibe `sampleBehavior` es SIEMPRE el universo completo** (mismos ids, mismas subcategorías, en todas las épocas y brazos) ⇒ panel bit-estable. La no estacionariedad entra por tres canales que el harness controla por época `t`:

| Canal | Mecanismo | ¿Toca el generador? |
|---|---|---|
| Demanda (shifts, lanzamientos, agotamientos) | `attractivenessById` — knob NUEVO v3 (abajo) | Sí — 1 knob aditivo |
| Precios | Clones del producto con `price_cents` y `attrs.priceBand` mutados en la vista de época | No (el catálogo es un parámetro) |
| Disponibilidad en la tienda | Máscara `activeIds(t)` aplicada por el **slate builder** del harness + mapa de complementos filtrado activo×activo por época | No |

**Knob v3 propuesto (única modificación a `behavior-model.ts`):**

```ts
// BehaviorOpts (añadir):
/**
 * v3 (harness Fase 2): atractividad intrínseca por source_product_id,
 * suministrada externamente. Cuando está presente, sustituye la tabla
 * interna derivada de zipfS (que NO debe pasarse a la vez). Los valores se
 * usan TAL CUAL como attFactor (el caller normaliza y aplica su eta).
 * Omitido ⇒ output BIT-IDÉNTICO a v2 (garantizado por test de regresión).
 */
attractivenessById?: ReadonlyMap<string, number>;
```

Implementación: en el bloque `if (opts.zipfS !== undefined...)` añadir la rama `else if (opts.attractivenessById)` que puebla `attFactorById` directamente. No consume `rngV2` (el barajado Zipf interno tampoco corre), así que la alineación de streams se mantiene mientras el harness use SIEMPRE el knob — y lo usa siempre. **Test obligatorio:** mismo `opts` sin el knob ⇒ `JSON.stringify(out)` idéntico byte a byte a v2 (cazaría cualquier draw accidental).

**Construcción de la atractividad por época (en el harness, no en el generador):**

```ts
// world.ts — determinista desde worldSeed; calibración = mundo oficial exp-K
const ZIPF_S = 1.0, ZIPF_ETA = 0.7;          // exp-k oficial (eta=0.7)
// a_i: Zipf(s=1.0) sobre un barajado seed-fijo de los ids del UNIVERSO (una vez)
// m_i(t): multiplicador de demanda por época (shifts §1.3)
// att_i(t) = activo(i,t) ? ((a_i · m_i(t)) / meanActivos)^ZIPF_ETA : 0
```

`att=0` para inactivos hace que el régimen orgánico (solo época 0) los ignore (score ≈ ruido N(0,0.05) vs ≥0.05·1 de cualquier activo fuera de taste); en las épocas medidas la exclusión es **estructural** (máscara del slate builder + complementos filtrados), y un invariante post-época lo verifica (§8 #4).

### 1.3 Tipos de shift, magnitudes y calendario (pre-registrados)

Contexto del negocio: revendedor Amazon/AliExpress→Cuba sin stock físico. La volatilidad real viene de: catálogo upstream que rota, agotamientos upstream, precios upstream + logística, y estacionalidad de demanda local (Día de las Madres, inicio de curso, calor → ventiladores, fiestas de fin de año).

| Shift | Mecanismo | Magnitud propuesta (pre-registrada) | Justificación reseller |
|---|---|---|---|
| **Lanzamientos** | Universo 3000 = 2400 activos en e0 + 600 reservados; oleadas de activación | ~40 productos/época (≈1.7% del activo); 1 de cada oleada forzado al decil superior de `a_i` ("hit"), el resto hereda su Zipf (mayoría duds) | Los resellers rotan catálogo continuamente; los hits son raros |
| **Agotamientos** | Desactivación programada (exógena, misma en ambos brazos) | 2.5% del activo/época; muestreo sesgado hacia `a_i` alto con peso `(1 - stock_health)` del catálogo (los bestsellers se agotan upstream) | Es EL dolor del dropshipping: el producto estrella desaparece de la noche a la mañana — y es lo que hace decaer una config estática |
| **Shift de demanda por categoría** | `m_i(t)` por subcategoría | Cada 3 épocas, 1-2 categorías "evento" ×2.0–×3.0 durante 2-3 épocas con rampa subida/bajada; el resto random-walk suave ×[0.9, 1.1] por época | Estacionalidad retail típica de categoría-evento es 2-3× (regalos, escolar, clima); el walk suave evita un mundo estático entre eventos |
| **Precio × elasticidad** | Clon con `price_cents` ±10–25% y `priceBand` ±1 en ~30% de los repricings | 7% del activo repricea por época | FX/logística/upstream; `priceGamma=0.8` (mundo oficial) convierte el repricing en efecto real de conversión, y `priceBand` mueve también el price-fit del click model |

**Calendario:** `T_total = 14` épocas × `EPOCH_DAYS = 14` días simulados ≈ 6.5 meses. Época 0 = warmup orgánico; época 1 = baseline congelada compartida; épocas 2..13 = medidas (12 decisiones del agente). El calendario de shifts se **muestrea determinísticamente de `worldSeed`** — jamás a mano, jamás después de ver resultados (§8 #10).

**Exógeno por diseño (v1):** los agotamientos NO dependen de las ventas del brazo (un hazard ∝ ventas castigaría más al brazo que más vende y entrelazaría los mundos). Ambos brazos viven el MISMO calendario de shifts; la divergencia viene solo de la política. Variante endógena: extensión v2, fuera del gate.

### 1.4 Por qué una config estática DECAE en este mundo (sin amañar)

Honestidad primero: las secciones `popular`/`cross_sell` se auto-refrescan vía crons en AMBOS brazos (§2), así que el congelado **no** decae por datos viejos. Decae por lo que una config no puede hacer: (a) **reasignar slots** cuando la demanda se desplaza de categoría (la sección categoría-objetivo equivocada sigue arriba del cascade — y el cascade ES el position bias del mundo); (b) **re-targetear reglas** (`session_cohort`, `hour_of_day`) hacia las cohortes que ahora convierten; (c) **re-dimensionar params** (`limit`, `mode: global|cohort`) cuando el mix cambia; (d) **reaccionar a oleadas de lanzamientos/agotamientos** ajustando la mezcla de secciones. Si con estas palancas el agente no llega a 2x, **el harness debe decirlo** — ese es su trabajo (ver lectura honesta en §5.3 y riesgo R1 en §10).

---

## 2. Qué se congela exactamente (Q2) — el contrafactual defendible

**Principio:** el gate mide "¿cuánto vale el MERCHANDISER adaptativo?", no "¿cuánto vale tener datos frescos?". Todo lo que en producción corre sin agente, corre en ambos brazos.

| Componente | Brazo congelado | Brazo agente |
|---|---|---|
| Filas `ui_placements` (slots, secciones, params, reglas, status) | **CONGELADO** en la config de lanzamiento (= seed 0026: `hero_grid` slot 10 + `popular` global; la config que la tienda real shippea) | El agente las reescribe entre épocas |
| Cron popularidad (≡ `product_popularity_7d`, 0027) | ✅ corre cada época, **del log propio del brazo**, ventana = última época | ✅ idéntico |
| Cron NPMI (≡ `co_occurrence_top`, fórmula `buildPairCounts`+`buildNpmiTop` de `scripts/_audit/lib.ts`, que replica el SQL de producción con overlap 1.000 verificado en la auditoría) | ✅ corre cada época, ventana = últimas 6 épocas (≈90d, paridad con la poda F3/F4) | ✅ idéntico |
| Ranker del `hero_grid` (rrf-sess-pop, el campeón validado 3/3 seeds de F6) | ✅ re-lee datos frescos por sesión | ✅ idéntico (NO es palanca del agente, salvo `params.limit`) |
| Exploración ε (paridad `EXPLORATION_EPSILON=0.1`, `feed.ts:187`, vía `applyEpsilonExploration` de `explore/epsilon.ts`) | ✅ 0.1 | ✅ 0.1 |
| Disponibilidad (productos inactivos salen de los candidatos) | ✅ sincronizada | ✅ idéntica |
| Cascade λ, SLATE_K, panel de usuarios, calendario de shifts | idénticos | idénticos |

**Defensa ante auditoría:** congelar también los crons inflaría el ratio con "datos frescos vs datos viejos" — un efecto que NO es del agente (en prod los crons corren solos). Este es el contrafactual MÁS DURO posible para el agente: una tienda competente con pipelines vivos y sin equipo de merchandising. Cualquier ratio ≥2 contra ESTE rival es atribuible solo a la escritura de config. (Mapea el hallazgo H6 de la auditoría — "baseline con oráculo/dopado" — a su inverso: baseline con todo lo legítimo, nada más.)

**Nota sobre el log por brazo:** cada brazo acumula SU PROPIO log de eventos (patrón exp-J `cumEvents`), porque en prod los crons del mundo-con-agente verían el tráfico del mundo-con-agente. Compartir el log contaminaría ambos contrafactuales.

---

## 3. Palancas del agente y paridad sim↔prod (Q3)

### 3.1 Escrituras permitidas — exactamente las de producción

La superficie de escritura es `ui_placements` (0025) y nada más. Validación con los MISMOS validadores que prod:

| Operación | Validación (código real reutilizado) |
|---|---|
| `INSERT` placement: `{surface, slot, section_type, params, rule, scope, ttl_until, risk_tier}` | `section_type ∈ SECTION_REGISTRY ∪ {hero_grid}` (`sections/registry.ts:98-103`); `params` por `paramsSchema` zod del resolver (p.ej. `popular`: `{limit ≤30, mode ∈ global|cohort|pdp_category}`); `rule` por `RuleSchema` (`rules/schema.ts:52`, `isValidRule`) |
| `UPDATE` params/rule/slot (bump `version`) | mismos schemas |
| `UPDATE status`: `approved→paused`, `paused→approved`, `*→archived` | máquina de estados de 0025 |
| `status='killed'` | **irreversible** — el store del sim replica el trigger `ui_placements_killed_is_final` (0025:71-84) lanzando error en cualquier resurrección |
| `risk_tier` → status efectivo | `low` ⇒ `approved` inmediato; `medium` ⇒ `approved` con `ttl_until` ≤ 2 épocas obligatorio; `high` ⇒ `pending` — **y `pending` NO se sirve** (el loader de prod filtra `status='approved'`, `config.ts:123`), o sea: en el sim, como en prod, una propuesta high-risk sin humano NO tiene efecto. Honesto: el gate mide el valor del agente bajo la política de autonomía real |

**Restricciones v1 (paridad estricta):** `scope='global'` solamente (`user_segment` es seam null hoy — `compose.ts:74`); superficies del sim: `home` (única compuesta, §3.3). Slots con gaps de 10 (convención 0025) — el agente puede intercalar.

### 3.2 Cadencia y qué VE el agente

El agente corre **solo en fronteras de época** (paridad con el cron de prod). Su input es UN JSON construido por `metrics.ts` exclusivamente con datos que existen en prod:

```ts
interface MerchandiserInput {
  epoch: number;                       // t — va a decidir para t (ve hasta t-1)
  placements: SimPlacementRow[];       // la tabla viva (sus propias filas incluidas)
  placementMetrics: Array<{            // ≡ join feed_impressions+purchase_attributions
    placement_id: string; section_type: string; slot: number; epoch: number;
    impressions: number;               // slots servidos       (≡ served_at)
    examined: number;                  // examinados por cascade (≡ seen_at, 0024)
    carts: number; purchases: number;
    realized_margin_cents: number;     // Σ price·margin de compras atribuidas
  }>;                                  // últimas 3 épocas, por placement
  categoryTrends: Array<{              // ≡ product_popularity_7d agrupada (0027)
    category: string; epoch: number;
    views: number; purchases: number; active_products: number;
    new_products: number; stockouts: number;   // ≡ products.is_active deltas
  }>;
  catalogFacts: Array<{                // ≡ products (lo que un admin ve)
    product_id: string; category: string; price_cents: number;
    margin_pct: number; is_active: boolean; epochs_since_launch: number;
  }>;                                  // top-N por categoría, no el universo entero
  holdoutComparison: { treated_margin_cents: number; holdout_margin_cents: number };
}
```

**Jamás en el payload:** `latent_state`, `attractivenessById`, el calendario de shifts, nada con timestamp > frontera. Test unit: whitelist de claves del JSON (§9).

### 3.3 El puente exposurePolicy — un solo compositor para ambos brazos

```ts
// store.ts — firma del puente hacia sampleBehavior (ExposureContext es el
// tipo REAL de behavior-model.ts:339-348: {user, sessionIndex, isGift, recipient, rng})
function makeArmPolicy(arm: ArmState, epoch: number): (ctx: ExposureContext) => string[] {
  // 1. SlateRuleContext del sim (campos de rules/types.ts:33-46):
  //    surface:'home'; hour_of_day/day_of_week del started_at simulado;
  //    is_logged_in:true; session_cohort = subcategoría modal de las VISTAS
  //    PASADAS del usuario en el log del brazo (jamás ctx.isGift — eso es GT);
  //    signal_window_size = nº de vistas pasadas; resto = constantes seguras.
  // 2. Placements = filas approved ordenadas slot ASC, version DESC; colisiones
  //    por especificidad con evaluateRule() IMPORTADO de f-slate/rules/evaluate
  //    (misma semántica que compose.ts:93-106; el bloque se extrae a una función
  //    pura compartida `selectPlacements()` para que sim y prod sean UN código).
  // 3. Cada sección resuelve con la fórmula de SU resolver de producción:
  //    popular(global)      → events de la época t-1 DESC          (≡ registry.ts:93)
  //    popular(cohort)      → idem filtrado a session_cohort       (≡ registry.ts:84)
  //    cross_sell           → NPMI top del último visto del usuario (≡ registry.ts:25,
  //                           ancla = last-viewed del log; en prod es el PDP anchor —
  //                           desviación documentada §3.4)
  //    hero_grid            → rrf-sess-pop (rrfFuse de retrieve/rrf + cabezas
  //                           subcat-quota y pop-global, el campeón exp-K)
  //    Todos enmascarados a activeIds(epoch).
  // 4. Concatenar por slot, dedupe conservando orden, ε-greedy por slot
  //    (ε=0.1, misma forma que applyEpsilonExploration, rng = ctx.rng — el
  //    ÚNICO stream legal para una política, behavior-model.ts:346),
  //    truncar a SLATE_K=20, registrar slot→placement_id para atribución.
  // 5. Si la config produce 0 placements ⇒ DEFAULT_PLACEMENTS (config.ts:63)
  //    — JAMÁS devolver [] (un slate vacío caería al régimen ORGÁNICO del
  //    generador = oráculo personal = exploit del agente; §8 #7).
}
```

Ambos brazos llaman exactamente esta función; solo difiere `arm.placements`.

### 3.4 Desviaciones sim↔prod documentadas (para el capítulo de validez)

1. `cross_sell` ancla en last-viewed del log (el sim no modela navegación PDP); prod ancla en el PDP actual. Misma señal (NPMI), ancla más débil — conservador contra el agente.
2. `cart_addons` no existe en el sim (no hay carrito persistente entre sesiones). El agente no la tiene como palanca.
3. `recipient_active`/`gift_confirmed` fijos a false (el detector real tiene precision ~13% a prevalencia real — H8; dárselo "perfecto" al sim sería un oráculo).

---

## 4. Revenue realizado (Q4)

- **Métrica primaria del gate: margen realizado** — `Σ price_cents(t) · margin_pct` sobre los eventos `purchase` simulados del brazo en las épocas 2..13, a precio vigente de la época. Es la métrica de exp-J (`epochMetrics`, exp-j:209-232) y la del negocio (reseller vive del margen). Crucial: `margin_pct` está anti-correlacionado con priceBand en el catálogo (`catalog-model.ts:147-148`) ⇒ un gate sobre GMV sería gameable empujando caros de margen bajo; el margen cierra esa puerta. **GMV se reporta como secundaria.**
- **Cuenta TODO el brazo, no solo lo atribuido al slate:** compras de complementos sembrados (pull-in del usuario) cuentan como "orgánicas" (≡ `purchase_attributions.feed_request_id NULL`, 0029) y suman al total del brazo. El gate es sobre el pastel completo — mover atribución sin mover el pastel no puntúa (H4-proof).
- **Cero estimaciones de modelo:** el funnel del generador (P_CART·P_BUY·elasticidad·satisfacción) ES la verdad; nada de `E[rev]` con señal del ranker en NINGÚN punto del gate (la métrica circular de H4 queda estructuralmente fuera).
- **Holdout interno: SÍ, 10% en el brazo agente.** Usuarios con `fnv1a(user_id) % 10 === 0` (estable entre épocas) reciben SIEMPRE la composición congelada **dentro del brazo agente**, y sus compras cuentan en el total del brazo agente. Razones: (a) en prod el holdout existe (`slate_decisions.holdout`, 0024) y su coste de oportunidad lo paga el despliegue real — el sim debe pagarlo también; (b) le da al agente la misma señal treated-vs-holdout que tendría en prod (`holdoutComparison` del input §3.2). El brazo congelado no necesita holdout (todo él lo es).

---

## 5. Matemática del gate (Q5)

### 5.1 Unidad de réplica = seed (y por qué no hay pairing más fino)

Verificado en el generador: los draws del funnel (`rng.next() < P_CART·…`, behavior-model.ts:803,812) salen del stream PRINCIPAL y su número depende del tamaño de cesta, que depende del slate (rngV2/cascade). En cuanto los slates de los dos brazos difieren en UNA sesión, los streams principales se desincronizan ⇒ las sesiones posteriores no son pareadas entre brazos. Lo que SÍ es idéntico entre brazos: panel de usuarios, tastes, calendario de shifts, mundo. Conclusión: el par honesto es **(brazo agente, brazo congelado) dentro del mismo seed**, y el seed es la unidad de inferencia. `pairedBootstrap` de `scripts/_audit/lib.ts:635` (que es por-caso) queda como diagnóstico intra-seed (bootstrap NO pareado de margen por sesión), no como estadístico del gate.

### 5.2 Estadístico y criterio EXACTO (pre-registrado)

- Por seed `s`: `ratio_s = M_agent(s) / M_frozen(s)`, con `M = Σ margen realizado, épocas 2..13`.
- **Punto:** media geométrica `Ĝ = exp(mean(ln ratio_s))` (los ratios son multiplicativos; la media aritmética sobre-pesa outliers altos — sería auto-favorecerse).
- **CI95:** t-Student sobre log-ratios: `exp(mean ± t₀.₉₇₅,ₙ₋₁ · sd(ln ratio)/√N)`. Con N=5, t=2.776.
- **GATE PASA si y solo si (las tres):**
  1. `Ĝ ≥ 2.0`
  2. CI95 inferior de Ĝ `> 1.0` (superioridad estadísticamente significativa)
  3. `ratio_s > 1.0` en **todos** los seeds (unanimidad — ningún mundo donde el agente pierda)
- **Etiqueta "strong pass"** (no requerida): CI95 inferior ≥ 2.0.

**Por qué no exigir CI-inferior ≥ 2.0:** con N=5 y sd(ln ratio)=0.3 (plausible entre mundos no estacionarios), el半 ancho del CI es ×1.45 — exigir CI-low≥2 obligaría a Ĝ≈2.9 y crearía el incentivo perverso de REDUCIR la varianza del mundo (= amañarlo hacia la docilidad). El criterio elegido separa las dos preguntas: ¿el efecto es ≥2x en punto? y ¿es real (CI>1, unanimidad)? — y deja la incertidumbre del 2.0 a la regla de escalada.

**Escalada única pre-registrada:** si `Ĝ ≥ 2.0` pero CI-inferior ≤ 1.0 (CI ancho), se corre UNA extensión a N=10 con los seeds pre-listados, y el veredicto final se calcula sobre los 10, salga lo que salga. Sin más extensiones (la repetición opcional infinita es p-hacking secuencial; una extensión fija y declarada mantiene la inflación de tipo I acotada y se reporta como tal).

**Seeds:** desarrollo y debugging SOLO con seed `123`. Gate primario: `{42, 7, 2026, 31337, 777}`. Extensión: `{1001, 1002, 1003, 1004, 1005}`. Los seeds del gate no se tocan hasta que el harness está congelado (protocolo exp-K: "tune on 123, confirm untouched").

### 5.3 Lecturas honestas pre-comprometidas

| Resultado | Veredicto | Qué se reporta (literal, sin reframing) |
|---|---|---|
| Ĝ = 1.4x, CI [1.2, 1.6] | **NO se despliega** | "El agente añade +40% significativo pero no cumple el contrato 2x. Opciones: mejorar agente, o renegociar el gate CON esta evidencia delante — nunca re-tunear el mundo." |
| Ĝ = 1.9x, CI [1.5, 2.4] | **NO se despliega** | 1.9 ≠ 2.0. El criterio existe exactamente para que esto no se redondee. Se reporta como "falló el gate por margen estrecho" con el CI completo. |
| Ĝ = 2.1x, CI [0.9, 4.9] | **Escalada a N=10**, veredicto sobre los 10 | Si tras N=10 el CI-low sigue ≤1: NO se despliega ("efecto puntual grande pero no distinguible de la varianza entre mundos"). |
| Ĝ = 2.3x, CI [1.4, 3.8], 5/5 seeds >1 | **Se despliega** | Con la trayectoria por época y el audit de acciones adjuntos. |
| Cualquier resultado + brazo congelado colapsando >50% entre épocas consecutivas | **Run inválido** | Mundo demasiado violento vs realidad retail ⇒ revisar magnitudes ANTES de mirar ratios (pero el cambio de mundo invalida los seeds usados: re-registro + seeds frescos). |

---

## 6. El agente REAL dentro del harness (Q6)

### 6.1 Mismo módulo que producción, backends de tools intercambiados

El gate mide al agente que se despliega (anti-H7). El módulo `src/sectors/g-agents/runtime/merchandiser.ts` (tarea C2) se construye con:

```ts
// APIs verificadas: deepagents/dist/index.d.ts:3200 (createDeepAgent, síncrona),
// :3064-3167 (CreateDeepAgentParams: model, tools, systemPrompt, subagents,
// responseFormat...). Detalle completo en A1.
import { createDeepAgent } from "deepagents";
import { ChatDeepSeek } from "@langchain/deepseek";
import { tool } from "@langchain/core/tools";   // soporta zod 4 nativo (A1 §2.1)

export function buildMerchandiser(backend: MerchandiserBackend) {
  return createDeepAgent({
    model: new ChatDeepSeek({
      model: "deepseek-v4-pro", temperature: 0, maxTokens: 8192,
      modelKwargs: { thinking: { type: "enabled" }, reasoning_effort: "high" },
    }),
    tools: [
      tool(backend.readMetrics,  { name: "read_metrics",  schema: zMetricsQuery }),
      tool(backend.readCatalog,  { name: "read_catalog",  schema: zCatalogQuery }),
      tool(backend.proposeWrite, { name: "propose_placement_write", schema: zPlacementWrite }),
    ],
    systemPrompt: MERCHANDISER_PROMPT,   // estable byte a byte ⇒ caché DeepSeek (A2 §4.4)
  });
}
// invoke SIEMPRE con recursionLimit explícito (deepagents fija 10000 — A1 §1 gotcha):
// await agent.invoke({ messages: [...] }, { recursionLimit: 24 });
```

`MerchandiserBackend` tiene dos implementaciones: **pg** (prod, lee `feed_impressions`/`purchase_attributions`/`product_popularity_7d`, escribe `ui_placements`) y **sim** (lee `metrics.ts`, escribe el store in-memory). Prompt, modelo, schemas de tools: **idénticos**. Restricciones empíricas de A2 que aplican: en thinking mode NO forzar `tool_choice` nombrado (400 verificado); salida estructurada con `method:"jsonMode"` si se usa `withStructuredOutput`.

### 6.2 Coste LLM por run del gate

Con el pricing verificado en A2 (pricing page 2026-06-11): v4-pro $0.435/M input miss, $0.003625/M hit, $0.87/M output; v4-flash ≈ 3.1× más barato.

| Concepto | Cuenta |
|---|---|
| Runs del agente | 12 fronteras × 5 seeds = **60** (escalada N=10: 120) |
| Por run (~6 iteraciones de loop, ~10K input/llamada con ≥80% cache-hit por prefijo estable, ~1.2K output incl. reasoning) | ≈ **$0.011** (v4-pro) |
| **Gate completo** | **≈ $0.66** v4-pro; peor caso pricing 4× (discrepancia documentada en A2 §4.1): **$2.64**. Con crítico-subagente (+50%): ~$1/4. Con flash: ~$0.21 |

**Mitigaciones (en orden de impacto):**
1. **Caché de decisiones**: key = `sha256(worldVersion + promptVersion + seed + epoch + metricsJson)` → `scripts/agents/cache/<key>.json` con el transcript completo. Re-runs del harness durante desarrollo = $0. Los transcripts se commitean como artefactos auditables (las decisiones del gate son reproducibles e inspeccionables).
2. **Prefijo de prompt estable byte a byte** (system + tools en orden fijo — LangChain preserva el orden de `bindTools`, A2 §4.4): el caché server-side de DeepSeek baja el input a $0.003625/M.
3. **`--smoke`**: 1 seed × 3 épocas medidas × mundo pequeño (§7) ≈ 3 runs ≈ **$0.04** — para CI y para iterar plomería.
4. **`--agent=scripted`**: un agente heurístico determinista (reglas if/then sobre los mismos tools) para tests de plomería del harness. **PROHIBIDO para el gate** — flag rechazado si `--gate` está presente (assertion en el CLI).

---

## 7. Presupuesto de cómputo — 2 cores (Q7)

Dimensiones propuestas (calibradas contra exp-J/exp-K que ya corrieron en esta máquina):

| Parámetro | Gate | `--smoke` |
|---|---|---|
| Universo / activos en e0 | 3000 / 2400 | 1500 / 1200 |
| Usuarios (panel fijo) | 1000 | 300 |
| Épocas (warmup+baseline+medidas) | 1+1+12 | 1+1+3 |
| Seeds | 5 | 1 |
| Llamadas `sampleBehavior` | 5×(2+2×12)=130 | 8 |
| Eventos por época por brazo | ~30-50K | ~10K |

Coste por componente (medido en orden de magnitud por exp-J, que con n=2000/users=800/days=90 y 5 llamadas corrió en segundos): época orgánica e0 = O(users·sesiones·universo) ≈ 13.5M evaluaciones de `scoreProduct` ≈ 5-8s; épocas con exposición NO escanean el catálogo (el slate decide) ≈ 0.5-2s; crons por época (pair counts ventana 6 épocas + sort popularidad) ≈ <1s. **Total sim ≈ 6-10 min secuencial.** Wall del gate dominado por LLM (60 runs × 30-90s thinking): se corren los 5 seeds como pipelines concurrentes (`Promise.all` — el LLM es I/O-bound y el sim de cada seed cabe intercalado en 2 cores) ⇒ **wall total ≈ 15-20 min**. `--smoke` < 5 min. Sin workers, sin DB (todo in-memory, como exp-J): cero round-trips.

---

## 8. Lista anti-trampa explícita (Q8) — cada control mapeado a su hallazgo F6

1. **[H3 fuga transductiva]** Crons solo-pasado: popularidad/NPMI de cada época se construyen EXCLUSIVAMENTE de eventos de épocas < t del log del brazo. No existe código que toque eventos de la época en curso (los artefactos se construyen ANTES de llamar a `sampleBehavior`).
2. **[H3]** El agente en la frontera t recibe agregados de épocas ≤ t-1, generados por `metrics.ts` — función pura con test de whitelist de claves: ni `latent_state`, ni `attractivenessById`, ni calendario de shifts, ni NINGÚN campo fuera de la lista (§3.2) puede entrar al prompt sin romper el test.
3. **[H4 métrica circular]** El gate es margen REALIZADO del funnel del generador. `expectedRevenue`/cosenos/scores del ranker no aparecen en ningún término del gate. Grep-gate en CI: `eval-harness.ts` no importa nada de `src/thesis/objectives/`.
4. **[H1/H2 mundo amañado]** (a) Magnitudes de shift justificadas por la realidad del reseller y **pre-registradas en este documento antes de existir el harness**; (b) calendario muestreado de `worldSeed`, no elegido a mano; (c) invariante post-época: ningún evento referencia un producto inactivo (aborta el run); (d) sanity report del mundo por seed: Gini de ventas, cuota top-20% (~debe rondar 72/28 — calibración exp-G/K), trayectoria del brazo congelado (si colapsa >50% entre épocas, run inválido §5.3); (e) cualquier cambio de mundo tras ver un ratio = invalidación de seeds usados, re-registro, seeds frescos.
5. **[H6 baseline dopado/estrangulado]** El congelado recibe TODOS los crons, el mismo ranker hero, el mismo ε y la config real de lanzamiento (seed 0026 + popular). Sin oráculos en ningún brazo: `session_cohort` se computa del log observado, nunca de `latent_state`/`ctx.isGift`.
6. **[H7 validado ≠ desplegado]** El agente del harness es el módulo de producción con backend intercambiado (§6.1): mismo modelo, mismo prompt, mismos schemas. El compositor del sim comparte `evaluateRule` y `selectPlacements()` extraída de `compose.ts` — test de paridad: misma tabla de placements + mismo contexto ⇒ misma selección que `composePage` (contra una DB de test).
7. **[usuarios-oráculo / loop]** Toda época medida es exposure-mediated. **Slate vacío ⇒ DEFAULT_PLACEMENTS, jamás `[]`** — porque `[]` activa el fallback ORGÁNICO del generador (behavior-model.ts:684), que es el buscador personal perfecto del usuario: un agente que "rompiera" su config a propósito COBRARÍA el oráculo. Test unit dedicado a este caso.
8. **[paridad de palancas]** El agente solo posee 3 tools; `propose_placement_write` valida con `RuleSchema` + `paramsSchema` reales + máquina de estados + trigger killed replicado. No existe tool de "modificar ranker", "ver futuro" ni "leer mundo". El runtime de deepagents añade tools de filesystem virtual (StateBackend, herméticas — A1 §3.1) y `task`; superficie real de efectos = los 3 tools (postura A1 §3.6).
9. **[verificación de escrituras]** El harness diffea el store antes/después de cada run del agente: cualquier delta fuera de `ui_placements`-sim ⇒ abort. El mundo (`world.ts`) es estructura congelada (`Object.freeze` en dev) y su hash se verifica tras cada fase de agente.
10. **[no-tuning]** Seeds del gate vírgenes hasta harness congelado (`123` para todo el desarrollo); criterio, métricas, magnitudes y regla de escalada fijados en ESTE documento con fecha anterior al primer run del gate.
11. **[no-determinismo LLM]** temperature 0 + caché write-once por (seed, época): el run del gate queda congelado y re-verificable; transcripts commiteados.
12. **[exposición idéntica]** SLATE_K=20, λ=0.85, ε=0.1 constantes compartidas en `sim/constants.ts` — imposible divergir por brazo (un solo objeto config para ambos).
13. **[candidatos idénticos]** La máscara `activeIds(t)` se aplica en el ÚNICO slate builder compartido; no hay pool por brazo.
14. **[atribución no inflable]** El gate suma TODO el margen del brazo (slate + orgánico/complementos); la atribución por placement existe solo como input informativo del agente.
15. **[época 0/1 fuera del gate]** Warmup orgánico y baseline congelada compartida se excluyen de las sumas: son idénticos entre brazos y solo diluirían el ratio hacia 1 (dilución que, nótese, FAVORECERÍA aparentar honestidad barata — excluirlas es lo neutral y se declara).

---

## 9. Estructura de archivos y tests (Q9)

```
src/sectors/g-agents/
├── sim/
│   ├── constants.ts        # SLATE_K, λ, ε, ZIPF_S/ETA, EPOCH_DAYS, ventanas de cron
│   ├── world.ts            # buildWorld(worldSeed, spec) → { universe, epochView(t),
│   │                       #   attractiveness(t), activeIds(t), complements(t), shiftLog }
│   ├── shifts.ts           # calendario de shifts muestreado de worldSeed (§1.3)
│   ├── store.ts            # tabla ui_placements in-memory + máquina de estados +
│   │                       #   killed-irreversible + selectPlacements() compartida
│   ├── sections.ts         # resolvers sim (popular/cross_sell/hero rrf-sess-pop)
│   │                       #   espejo 1:1 de las fórmulas de registry.ts y exp-K
│   ├── crons.ts            # popularidad por época + NPMI ventana 6 épocas
│   │                       #   (promueve buildPairCounts/buildNpmiTop desde _audit/lib.ts
│   │                       #    o importa npmiFromCounts de producción)
│   ├── policy.ts           # makeArmPolicy(): ExposureContext → string[] (§3.3)
│   ├── metrics.ts          # MerchandiserInput (whitelist) + ledger margen realizado
│   └── stats.ts            # ratio por seed, media geométrica, CI95 t en log-espacio
├── runtime/                # (tarea C2 — el agente real; el harness lo IMPORTA)
│   ├── merchandiser.ts     # buildMerchandiser(backend) con createDeepAgent (§6.1)
│   ├── backend-pg.ts       # prod
│   └── backend-sim.ts      # harness
scripts/agents/
├── eval-harness.ts         # CLI: --seeds 42,7,2026,31337,777 --gate | --smoke |
│                           #   --agent=llm|scripted (scripted vetado con --gate)
│                           #   → reporte JSON+md con ratios, CI, trayectorias,
│                           #     audit de acciones del agente, sanity del mundo
└── cache/                  # decisiones LLM write-once por hash (commiteadas)
src/thesis/data/behavior-model.ts   # + knob attractivenessById (v3, §1.2)
```

**Tests unit (frugales — cazan regresiones reales, nada de demos):**

| Test | Qué regresión caza |
|---|---|
| `behavior-model.v3.test.ts`: opts sin `attractivenessById` ⇒ output bit-idéntico a v2 (snapshot hash) | El knob nuevo rompe el mundo auditado |
| `world.test.ts`: (a) subcategorías del view constantes en todas las épocas; (b) shift de demanda ×3 en una categoría sube sus compras en un mini-mundo (1 assert direccional); (c) producto inactivo jamás aparece en eventos de épocas medidas | Pánel roto / shifts sin efecto / fuga de inactivos |
| `store.test.ts`: killed-irreversible lanza; pending no se sirve; colisión de slot resuelve como `compose.ts` (1 caso con scopes) | Divergencia sim↔prod en la semántica de config |
| `policy.test.ts`: config con 0 placements ⇒ slate DEFAULT (no `[]`) | El exploit del fallback orgánico (§8 #7) |
| `metrics.test.ts`: whitelist de claves del MerchandiserInput; payload de frontera t no contiene épocas ≥ t | Fuga de oráculo al prompt |
| `stats.test.ts`: gate math con números enlatados (PASS/FAIL/escalada en los 3 bordes: 1.99, 2.0+CI ancho, unanimidad rota) | Un off-by-one decide un despliegue |

Sin tests de llamadas LLM (el caché + `--smoke` cubren la integración a coste ~$0.04).

---

## 10. Riesgos y preguntas abiertas

- **R1 — El gate 2x puede ser inalcanzable en un mundo honesto.** Lifts de merchandising reales son 5-30%; 2x sobre el revenue TOTAL exige que la no estacionariedad sea severa Y que la config estática la sufra de lleno. El diseño lo asume sin amañar: si sale 1.3x, el harness habrá hecho su trabajo y la decisión (no desplegar / renegociar el gate con evidencia) es del dueño del programa. **Lo que este diseño prohíbe es la tercera vía: subir las magnitudes de shift hasta que salga 2x.**
- **R2 — Palancas estrechas.** Con el registry actual (hero/popular/cross_sell) el agente tiene pocas teclas. Si F2 añade secciones nuevas a producción (p.ej. "novedades"), entran al sim POR PARIDAD (mismo resolver), nunca como sección sim-only.
- **R3 — `behavior-model` v3 toca el generador auditado.** Mitigado por el test bit-idéntico, pero requiere aprobación explícita (es el archivo más sensible de la tesis).
- **P1:** ¿Gate sobre margen (propuesto) o GMV? El texto del gate dice "revenue"; propongo margen con GMV secundaria — necesita confirmación del orquestador.
- **P2:** ¿El agente del gate incluye el subagente crítico (A1 §5) o se gatea el agente simple? Propongo: gatear la configuración exacta que se desplegaría (decisión de C2, fijarla ANTES del primer run del gate).
- **P3:** ¿Magnitudes de shift definitivas? Las de §1.3 son la propuesta pre-registrada; si el orquestador las cambia, debe ser ANTES de correr seed alguno del gate.
