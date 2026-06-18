# Veredicto del gate ≥2× — Fase 2 (agente merchandiser LangGraph + DeepAgents)

**Fecha:** 2026-06-18 · **Branch:** `feat/thesis-personalization-program` · **Run:** `scripts/agents/results/gate-llm-2026-06-18T05-40-02-802Z.json` (commit `32e11b1`, transcripts + reporte inmutables)

---

## 1. El veredicto, literal

**El agente NO dobla al motor. Queda en paridad.**

| Métrica | Valor | Umbral del gate |
|---|---|---|
| Ĝ (media geométrica de ratios) | **1.005** | ≥ 2.00 |
| CI95 del ratio | **[0.981, 1.030]** | CI-low > 1.0 |
| Unanimidad (5/5 ratios > 1) | **no** (2 seeds < 1) | sí |
| **PASS** | **NO** | — |

Ratios por seed: `42=0.978 · 7=0.9995 · 2026=1.009 · 31337=1.009 · 777=1.032`.

El criterio pre-registrado era `PASA ⇔ Ĝ≥2.0 ∧ CI-low>1.0 ∧ unanimidad`. Falla las tres condiciones. No hay lectura en la que este run pase. Per la lectura pre-comprometida del blueprint (R1): **no se despliega como doblador de revenue.**

## 2. La invalidación (`RUN INVÁLIDO`) es un falso positivo conocido y no cambia nada

El reporte marca 3 seeds (2026, 31337, 777) con `frozenCollapse`. **Es el falso positivo que la Fase D ya había predicho y documentado (D1-H3)**, no el exploit que el detector buscaba:

- El detector (D1-H2) existía para cazar un brazo congelado **muerto** (margen→0), que daría ratio astronómico vía `÷max(1,frozenMargin)`.
- Aquí el brazo congelado está **vivo**: mínimos de 0.99–2.13M céntimos por época. Las caídas que disparan el flag son dips aislados de una sola época, justo bajo el umbral 0.5: seed 2026 e3 (0.488), seed 31337 e13 (0.287), seed 777 e3 (0.498). Es la volatilidad legítima del mundo no estacionario (un evento de categoría que termina, un agotamiento de bestsellers), no un brazo roto.
- Los seeds 42 y 7, **válidos** (sin collapse), dan 0.978 y 0.9995 — la misma historia de paridad.

**La conclusión es robusta a la invalidación:** con flag o sin flag, Ĝ=1.005 y CI-low=0.981 están a años luz del 2×. El detector es demasiado conservador para un mundo de 12 épocas volátiles (su recalibración principled está en el menú, §5-D), pero no rescata ni hunde el resultado: el agente no dobla.

## 3. Por qué — el techo estructural (3.9%), no falta de inteligencia

El agente **funcionó y respetó cada barrera**:

- 142 propuestas, 110 aceptadas a lo largo de 60 fronteras; esperó (0 propuestas) en 13/60 cuando las métricas venían flaggeadas — contención, no spam.
- **Todas** las aceptadas cayeron en slots 20–90. **Jamás tocó el hero (slot 10).** 105 low-tier + 5 medium, **cero high auto-aplicado.** La superficie de escritura aguantó exactamente como se diseñó.

Y aun con 110 placements colocados, el ratio es 1.005. La razón es geométrica, no de talento del modelo:

> El motor (campeón `rrf-sess-pop` de la Fase 1) ocupa el **hero**, el único inmueble de alto tráfico, con sus 20 ítems. La superficie soberana deja al agente **solo los slots ≥20**, que en el cascade de atención (λ=0.85) arrancan en la **posición 21**. La probabilidad de que una sesión examine esa posición es **0.85²⁰ ≈ 3.9%**.

Optimizar perfectamente secciones que ve el 3.9% de las sesiones no puede mover el revenue total ×2. El techo es estructural: lo fija la decisión —del usuario, vinculante— de que **el motor es soberano y el hero intocable**. La Fase D lo predijo al milímetro antes de quemar un solo seed del gate.

Dicho de otro modo: **el 2× era inalcanzable por diseño, y eso es una buena noticia sobre el motor.** El ranking de la Fase 1 es tan dominante en el inmueble que importa que no queda ×2 que arañar por encima de él sin cederle el hero al agente.

## 4. Qué SÍ quedó probado (no es trabajo perdido)

- **Infraestructura de agentes completa, soberana y verificada adversarialmente.** LangGraph 1.4 + DeepAgents 1.10 + DeepSeek v4; agente cron-only hermético; superficie de escritura con tier computado, caps e idempotencia; 312 tests unit + integración verde.
- **Soberanía del motor demostrada bajo ataque** (Fase D, 3 ataques `holds`): la tienda sirve idéntica sin agentes, con el agente muerto a mitad, o con propuestas pending. El agente jamás entra al request path.
- **El gate mide de verdad** (A/A = 1.0000 exacto; recuento independiente del ledger al céntimo). El honesto 1.005 es honesto.
- **El agente es seguro:** en 60 fronteras de mundo adversarial no rompió una sola barrera. Su peor daño posible (ratio 0.978) es ruido, no destrucción.

## 5. Menú de decisión

**A — Aceptar el FAIL honesto. No desplegar como doblador.** (Lectura pre-comprometida R1.) El motor sigue solo; la Fase 2 cierra con un resultado negativo bien medido y una tesis intacta: *el motor soberano ya está cerca de su techo en el inmueble de alto tráfico.* Cero riesgo, cero coste recurrente.

**B — Redefinir el valor del agente lejos del "2× revenue": asistente de merchandising continuo de bajo riesgo.** La infra está construida y es soberana. Desplegarlo en modo sombra/pending (propuestas high a aprobación humana, low con TTL) para los **slots largos** que el motor no gestiona, y medir el lift real con usuarios reales (no simulados) en `since_change`. No dobla, pero no daña (ratios ≥0.978) y aporta margen positivo en épocas volátiles. El gate ≥2× simplemente no era la vara correcta para esta propuesta de valor.

**C — Ceder inmueble: ampliar la superficie para que el agente compita por el hero / posiciones altas bajo guardarraíles.** Es el **único** camino que podría alcanzar 2×, porque es el único tráfico que mueve la aguja. Pero negocia directamente contra la garantía de soberanía que el usuario impuso ("la tienda debe funcionar sin ellos"). Requiere rediseño (A/B con holdout sobre el hero, rollback agresivo, tier high obligatoriamente humano) y un gate nuevo. Decisión de producto, no de ingeniería.

**D — (Higiene, casi gratis) Recalibrar el detector de colapso** para distinguir brazo-muerto (margen < piso relativo) de volatilidad legítima (caída puntual con recuperación) — está pre-flagged en D1-H3 — y re-correr el gate (todas las 60 fronteras ya cacheadas ⇒ replay en ~20 min, $0 LLM) para un **FAIL válido de registro** sin el asterisco de `INVÁLIDO`. No cambia el veredicto (1.005), solo lo deja limpio en el acta.

---

**Recomendación:** **A + B.** El número honesto (1.005×) dice que el agente no es un doblador y nunca podía serlo con el hero intocable — eso es un hallazgo, no un fracaso de ejecución. Pero la infra soberana y segura ya existe y no daña; reposicionarla como asistente de cola larga (B), medida con usuarios reales, es el siguiente experimento barato. **C** queda como decisión de producto explícita del usuario, no un default. **D** es opcional para dejar el acta limpia.
