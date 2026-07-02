# Spec — Fase 2 re-build: gate multi-superficie FIEL + agente ADAPTATIVO

**Fecha:** 2026-06-18 · **Branch:** `feat/thesis-personalization-program` · **Estado:** PROPUESTO (pendiente de green-light del usuario)
**Supersede:** el veredicto `docs/superpowers/reports/2026-06-18-fase2-gate-verdict.md` ("techo estructural λ²⁰≈3.9%") queda invalidado: ese techo era un ARTEFACTO del simulador, no del merchandising.

---

## 0. Causa raíz (probada, workflow 8 agentes `wf_3ac5b92c-28c`)

Ĝ=1.005 (paridad) NO es incompetencia del agente ni techo estructural. Es un defecto de fidelidad del sim, en tres capas que se componen:

1. **Colapso a un solo slate.** El sim escribe todos los placements del agente en `surface="home"` slot≥20, concatena las 4 secciones en UNA lista, trunca a `SLATE_K=20` (`policy.ts:225`) y corre UNA sola cascada (`behavior-model.ts:669-674`). El hero (priority 0) reclama slots 0-19 → el `slice` borra entero lo del agente → **superficie alcanzable ≈0%** (solo se cuela ε-greedy, independiente del agente). El "3.9%"=λ²⁰ es la atención que el slot 20 *recibiría* si no estuviera cortado.
2. **Denominador hero-dominado.** Ĝ = M_agent/M_frozen sobre margen TOTAL; ambos brazos comparten el MISMO hero + la MISMA demanda orgánica. Ĝ=(S+Δ)/(S+Δ₀), S domina → clavado en 1. 2× exige Δ≥S+2Δ₀ (imposible con hero intacto y compartido).
3. **Infidelidad a producción** (agente A1, leyendo prod): el home renderiza carruseles SEPARADOS (`SlateRenderer.tsx`), **cross_sell vive en la PDP** y **cart_addons en el carrito** (no en el home), y `MAX_PLACEMENTS_PER_SURFACE=8` es **por superficie** — cada superficie se compone independiente, cada carrusel tiene atención propia. El sim aplasta todo en un home de 20.

→ Corregir el modelo del mundo a multi-superficie es **corrección de fidelidad, no amaño**. El amaño sería lo contrario (mantener 2× sobre un total que el agente no puede tocar por diseño).

## 1. Decisiones del usuario (vinculantes)

- **Vara:** 2× sobre **revenue TOTAL** (aditivo, vía superficies reales del agente; el hero NUNCA se cede).
- **Alcance:** home no-hero + **PDP + carrito** (modelo fiel completo).
- **Calibración:** **misma cascada λ=0.85 independiente por superficie** (reusar el modelo de atención auditado; cero constantes nuevas).

## 2. Cláusula de honestidad (PRE-REGISTRADA — no se renegocia post-hoc)

- El **A/A es el guardarraíl**: con ambos brazos congelados (sin agente), el nuevo modelo de atención DEBE dar Ĝ=1.0000 exacto. Si el A/A muestra lift, la atención está amañada → recalibrar antes de mirar el brazo agente.
- La atención del **hero queda idéntica** a hoy (item i del hero conserva P=λ^i). Soberanía verificable por test de invarianza.
- Cero números de tráfico inventados: el journey es **endógeno** (§4). El único parámetro de atención es λ=0.85, ya auditado.
- Si con esta calibración honesta el resultado es **<2×-total**, se reporta el lift real ("+X% significativo, no 2×"). NO se infla la calibración para forzar el pass. El número 2× no es sagrado; la honestidad sí.

## 3. Modelo de atención fiel (el cambio central)

Hoy: una cascada sobre una lista concatenada de 20; el hero monopoliza. Reemplazo:

**Dos niveles de decay, un solo λ=0.85:**
- **Vertical (entre secciones, scroll de página):** la sección en índice vertical `v` (0 = arriba) se alcanza con prob `λ^v`. El hero es `v=0` (siempre alcanzado). Cada carrusel siguiente `v=1,2,...` se alcanza con prob `0.85^v`.
- **Horizontal (dentro de la sección, cascade):** el ítem en índice `i` de una sección alcanzada se examina con prob `λ^i` (continuación de cascade, exactamente como hoy).
- **Compuesto:** `P(examinar ítem i de la sección v) = 0.85^v · (cascade hasta i)`.
  - Hero (`v=0`): `P = 0.85^0 · λ^i = λ^i` → **IDÉNTICO a hoy** (soberanía).
  - Carrusel del agente (`v=1`): primer ítem a `0.85` de atención (justo debajo del hero). Defendible.

**Composición por superficie (espejo de prod):** cada superficie (home, pdp, cart) se compone independiente vía `selectPlacements`, cap `MAX_PLACEMENTS_PER_SURFACE=8`. **Se elimina el `slice(0,SLATE_K)` global** que mata al agente; el truncado pasa a ser por-sección (limit de cada placement) + cap por-superficie.

## 4. Journey endógeno (la nueva mecánica del sim)

Hoy una sesión examina UN slate. Nueva sesión = journey acotado, **sin parámetros de tráfico nuevos**:

1. **Home visit:** examina el home (hero + carruseles) con atención de dos niveles (§3). Los ítems examinados entran al funnel (view→cart→buy) como hoy.
2. **PDP visits = ítems vistos en el home (endógeno).** Cada `product_view` del home es una visita a esa PDP. En esa PDP se renderiza `cross_sell` (anclado a ese producto) + opcional `popular(pdp_category)`, examinado con su PROPIA cascade fresca (`v=0` en la PDP). Los ítems del cross_sell entran al funnel.
3. **Cart visit:** si la sesión tiene ≥1 `add_to_cart`, hay una visita al carrito que renderiza `cart_addons` (anclado a los ítems del carrito), cascade fresca. Sus ítems entran al funnel.
4. **Acotación (anti-explosión):** profundidad fija home→PDP→cart. Los ítems de cross_sell/cart_addons que convierten se cuentan, pero **NO** generan nuevas visitas a PDP (sin recursión). Journey de profundidad 1.

Faithfulness: las visitas PDP/cart son proporcionales al funnel real (más browsing → más PDPs → más superficie de cross_sell), no a un número arbitrario. cross_sell/cart_addons resuelven con los MISMOS resolvers espejo de prod (NPMI para cross_sell, etc.).

## 5. Métrica honesta

- `Ĝ_total = M_agent / M_frozen` (fórmula intacta), pero ahora M incluye el margen de PDP + carrito + carruseles del home.
- **Brazo frozen:** sirve los DEFAULT por superficie (home=hero; pdp=cross_sell default NPMI; cart=cart_addons default), CONGELADOS en e1. Sus placements decaen con los shifts.
- **Brazo agente:** mismo hero (intocado) + carruseles del home que añade + cross_sell/cart_addons adaptativos. Su lift = lo aditivo del home + (cross_sell_agente − cross_sell_frozen) + (cart_agente − cart_frozen).
- **A/A guard** (§2). Se conservan TODAS las anti-trampas (mismo mundo ambos brazos, crons del log propio, sin fuga transductiva, ledger ground-truth directo).
- Se reporta Ĝ_total como titular + el desglose Δ por superficie (transparencia).

## 6. Agente adaptativo (el "tuneo" real — frameworks investigados)

Hoy `merchandiser.ts` es **one-shot reactivo**: `createDeepAgent` sin checkpointer, sin store, sin memoria cross-época. Su ventaja sobre el motor congelado es CERO porque no explota lo único que lo distingue: **adaptarse a los shifts no-estacionarios que el baseline congelado pierde.**

Upgrade (LangGraph 1.4 + DeepAgents 1.10, vía Context7):
- **Memoria cross-época (`BaseStore`/`InMemoryStore`):** baselines por superficie (EMAs de CTR/margen) que sobreviven entre épocas. Sin esto el agente es amnésico y no puede detectar shifts.
- **Detección de shift:** nodo que compara métricas actuales vs baseline recordado; cuando una superficie cae (shift de demanda), dispara re-merchandising SOLO de esa superficie (barato en estable, caro solo en shift → disciplina de coste, cada mock = $).
- **Fan-out por superficie (`Send`):** un sub-paso merchandiser por superficie (home/PDP/cart), tuneado independiente; resultados reducidos a estado compartido.
- **Se conserva:** planning DeepAgents (`write_todos` una por superficie), subagente critic, hero **no-escribible** por 4 capas (whitelist de schema excluye `hero_grid`, slot≥20 en create, `PROTECTED_SLOTS` en serve, tier `high`/pending para slots protegidos) + permisos de FS del backend.
- **De dónde sale el 2× honesto:** el frozen congela en e1; sobre 12 épocas de shifts pre-registrados, sus placements estáticos decaen. El agente que detecta y re-merchandisa dobla el baseline rezagado **en las superficies que controla** durante las ventanas de shift. Si esas superficies cargan suficiente masa (calibración §3-4), eso empuja el TOTAL a 2×.

## 7. Plan de implementación (spec→plan→un subagente por tarea; áreas disjuntas)

| Tarea | Área | Qué |
|---|---|---|
| T1 | `behavior-model.ts` + `engine.ts` | Atención de dos niveles (§3) + journey endógeno home→PDP→cart (§4). Knob v4, bit-idéntico v3 si se omite. |
| T2 | `sim/sections.ts` + `sim/policy.ts` | Composición por-superficie (quitar slice global); resolvers PDP/cart espejo de prod; render por visita. |
| T3 | `sim/stats.ts` + `eval-harness.ts` + tests | Métrica + desglose Δ por superficie + A/A guard endurecido + invarianza del hero. |
| T4 | `runtime/` (nuevo `merchandiser-graph.ts`) | Agente adaptativo: BaseStore + detección de shift + Send por superficie; DeepAgents planning+critic; hero no-escribible. |
| T5 | `docs/.../calibration.md` | Pre-registro de calibración + cláusula de honestidad + justificación λ=0.85 dos niveles + journey endógeno. |

Cada tarea = un subagente, TDD, áreas disjuntas (sin solapamiento de archivos). T1-T3 son el mundo fiel; T4 es el agente; T5 el pre-registro. T1→T2→T3 secuencial (dependencias), T4 en paralelo a T1-T3, T5 primero (pre-registro antes de medir).

## 8. Tests (TDD, anti-regresión real)

- **A/A faithfulness:** sin-agente → Ĝ=1.0000 exacto (extender `harness-aa`). Bloquea amaño de atención.
- **Invarianza del hero:** P(examinar ítem i del hero) idéntico pre/post refactor (soberanía).
- **Surface-has-signal:** una sección demostrablemente mejor en PDP/cart sube el margen (prueba que la superficie ahora lleva señal — el test que HOY fallaría).
- **Anti-trampa preservadas:** los 3 ataques `holds` + verify-ledger + sovereignty-adversarial siguen verde.
- **Shift-adaptividad:** el agente re-merchandisa ante un shift simulado; el frozen no; el lift aparece en `since_change`.

## 9. Riesgos y guardarraíles

| Riesgo | Guardarraíl |
|---|---|
| Amañar atención para pasar | A/A=1.0000 + un solo λ=0.85 (sin constantes nuevas) + journey endógeno |
| Explosión de atención (recursión PDP) | Journey de profundidad 1 acotado (§4.4) |
| Romper soberanía | Hero atención idéntica + no-escribible por 4 capas |
| 2×-total no alcanzable honestamente | Cláusula pre-registrada §2: se reporta el lift real, no se infla |
| Coste (cada mock = $) | Prompts byte-estables (cache DeepSeek), caché write-once de transcripts, replanning pesado solo en shift detectado |

---

## 10. Notas de implementación — Build-A (el mundo fiel)

**Principio rector: ADITIVO, no destructivo.** Se AÑADE un modo de exposición nuevo; `exposurePolicy` y todo el comportamiento v1/v2/v3 (orgánico + cascade único) quedan **BIT-IDÉNTICOS e intocados**. Todos los tests existentes de `behavior-model` (incl. `behavior-model-v3.test.ts`) siguen verdes **sin editarlos**. El test bit-idéntico es el guardarraíl de que no se rompió el generador auditado.

**Nuevo knob en `BehaviorOpts` (`journeyPolicy`, opcional, mutuamente excluyente con `exposurePolicy`):**
```ts
journeyPolicy?: (ctx: ExposureContext) => {
  home: SurfaceSection[];                                      // secciones ordenadas vertical (hero = índice 0)
  resolvePdp: (anchorProductId: string) => SurfaceSection[];  // cross_sell (+ popular pdp_category) anclado
  resolveCart: (cartProductIds: string[]) => SurfaceSection[];// cart_addons anclado al carrito
} | null;
type SurfaceSection = { sectionType: string; placementId: string; placementVersion: number; items: ExposedItem[] };
```
Presente ⇒ régimen two-level + journey (abajo). Ausente ⇒ comportamiento idéntico a hoy.

**Atención de dos niveles (un solo λ), por superficie:** para secciones `S_0..S_m` ordenadas vertical:
- **Vertical = cascade:** se examina `S_0` siempre; tras examinar `S_v`, se continúa a `S_{v+1}` con prob λ (UNA draw rngV2 por paso vertical; stop en el primer fallo). ⇒ `P(alcanzar S_v)=λ^v`.
- **Horizontal = cascade:** dentro de una sección alcanzada, ítem `i` examinado con prob `λ^i` (UNA draw rngV2 por paso, exactamente como hoy).
- Hero = `S_0` del home ⇒ alcanzado con prob 1, ítem `i` a `λ^i` ⇒ **atención idéntica a hoy** (test de invarianza por Monte Carlo: `P(examinar hero[i]) ≈ λ^i`).

**Journey endógeno (profundidad 1):** (a) home two-level ⇒ ítems examinados ⇒ funnel (view→cart→buy con satisfaction/elasticity como hoy). (b) por cada ítem del home con `product_view`: visita PDP ⇒ `resolvePdp(id)` ⇒ two-level fresco ⇒ funnel. (c) si hubo ≥1 `add_to_cart` en la sesión: UNA visita carrito ⇒ `resolveCart(ids)` ⇒ two-level fresco ⇒ funnel. (d) los ítems de cross_sell/cart_addons NO generan nuevas visitas PDP (sin recursión). **Orden de draws rngV2 documentado y fijo** (home en orden; PDPs en el orden en que se examinaron los ítems del home; carrito al final) — determinismo reproducible, sin `Date.now`/`Math.random`.

**Ledger/atribución:** `SessionExposure` se extiende para registrar impresiones de TODAS las superficies (home/pdp/cart) con su `surface`+`section_id`+`placement_id`+`position`; `ingestEpoch` atribuye compras por-superficie (espejo de prod: última impresión del producto en la sesión). `attributed_placement_id` ya existe.

**`policy.ts`:** construye el retorno de `journeyPolicy`: `home` = hero + carruseles del agente ordenados por slot, **resolviendo y truncando POR SECCIÓN** (limit de cada placement) — se **elimina el `slice(0,SLATE_K)` global**; cap `MAX_PLACEMENTS_PER_SURFACE=8` por superficie; ε-greedy POR SECCIÓN. `resolvePdp`/`resolveCart` componen las superficies pdp/cart vía `selectPlacements(surface=...)` + resolvers espejo (cross_sell NPMI anclado al `anchorId`; cart_addons anclado a los `cartIds`).

**`engine.ts`:** pasa `journeyPolicy` (no `exposurePolicy`) a ambos brazos; frozen usa composición congelada.

**TDD (escribir tests PRIMERO):** (1) A/A sin-agente ⇒ ratio=1.0000 por seed; (2) invarianza hero `P(examinar hero[i])≈λ^i`; (3) truncado por-sección (sección limit L ⇒ ≤L ítems; sin slice-global-20); (4) journey (ítem visto del home ⇒ existe impresión `surface="pdp"`; ítem carteado ⇒ impresión `surface="cart"`); (5) surface-has-signal (un carrusel del agente / cross_sell con ítems de alta satisfaction sube el margen realizado vs frozen — el test que HOY falla); (6) los tests existentes de `behavior-model`/sim siguen verdes sin editarse.
