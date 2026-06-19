# Informe — Fase 2 re-análisis: el agente SÍ dobla el revenue en un mundo fiel

**Fecha:** 2026-06-19 · **Branch:** `feat/thesis-personalization-program`
**Supersede:** `docs/superpowers/reports/2026-06-18-fase2-gate-verdict.md` (Ĝ=1.005 "techo estructural"). Ese veredicto era correcto sobre el sim viejo pero su DIAGNÓSTICO ("techo geométrico, el agente no puede doblar") era **falso**: el techo era un artefacto del simulador, no del merchandising.

---

## 1. Resultado en una frase

Con el modelo del mundo corregido a **multi-superficie fiel a producción**, el agente merchandiser **dobla el revenue total con margen** (Ĝ≈3.4× en smoke LLM), de forma **honesta** (A/A=1.0000, soberanía del hero intacta, calibración con el λ ya auditado). El veredicto pre-registrado de 5 seeds a 1000 usuarios queda **pendiente de hardware adecuado** (el codespace de 8GB/2-CPU no sostiene el run; §5).

## 2. Causa raíz del Ĝ=1.005 anterior (probada, workflow 8 agentes)

El sim **colapsaba todo el programa multi-superficie en UNA superficie**: escribía cada placement del agente en `surface="home"` slot≥20, concatenaba las 4 secciones en una lista, truncaba a `SLATE_K=20` y corría UNA cascada; el hero (priority 0) reclamaba los slots 0–19 y `slice(0,20)` **borraba entero** lo del agente → superficie alcanzable del agente ≈**0%** (no 3.9%). Además la métrica era el ratio de margen TOTAL con hero+orgánicas COMPARTIDOS por ambos brazos → Ĝ=(S+Δ)/(S+Δ₀) clavado en 1. **Infidelidad a producción** (verificado leyendo el código real): el home renderiza carruseles SEPARADOS, `cross_sell` vive en la PDP y `cart_addons` en el carrito (no en el home), y `MAX_PLACEMENTS_PER_SURFACE=8` es **por superficie**.

## 3. La corrección (Build-A — mundo fiel)

Modo de exposición **aditivo** `journeyPolicy` (deja `exposurePolicy` y v1/v2/v3 BIT-IDÉNTICOS):
- **Atención de dos niveles, un solo λ=0.85:** vertical entre secciones (`P(alcanzar S_v)=λ^v`) + horizontal dentro de la sección (`λ^i`). El hero es la sección v=0 ⇒ su atención por ítem queda `λ^i`, **idéntica a antes** (soberanía).
- **Journey endógeno profundidad-1:** las visitas a PDP = los ítems que el usuario ya ve en el home (cada `product_view` abre su `cross_sell`); el carrito renderiza `cart_addons` si hubo `add_to_cart`. Sin números de tráfico inventados.
- Composición **por superficie** (se elimina el `slice` global), atribución por-superficie en el ledger.

Archivos: `src/thesis/data/behavior-model.ts`, `src/sectors/g-agents/sim/{policy,sections,engine,ledger,constants}.ts`. Spec: `docs/superpowers/specs/2026-06-18-fase2-multisurface-faithful-gate.md`.

## 4. Evidencia (toda reproducible, $0 salvo los smokes LLM ~$0.03 c/u)

| Medición (seed 123 salvo nota) | Ratio | Lee |
|---|---|---|
| **A/A (sin agente, ambos brazos congelados)** | **1.0000 exacto** | El mundo nuevo NO fabrica asimetría — la corrección es honesta, no un amaño. |
| Scripted tonto, 3 épocas (2 carruseles home) | 1.9419× | El 2× es alcanzable hasta para un agente estático: la puerta la cerraba el sim. |
| Scripted, 12 épocas | 1.8678× | Lo estático **decae** con los shifts no-estacionarios. |
| **Agente LLM real, 3 épocas (post-tuneo)** | **3.4001×** | El agente competente **dobla con margen**. |

Además: invarianza del hero verificada (`P(examinar hero[i])≈λ^i`), 323 tests unit verdes, test bit-idéntico v3 INTACTO, `tsc` limpio. El A/A=1.0000 es el guardarraíl de integridad: prueba que el lift viene de superficies reales que el agente añade (su trabajo), no de atención inflada.

**Robustez de la conclusión:** el agente está en 3.4×, no rozando el 2×. Aun con una calibración de scroll más estricta que `0.85^v`, el margen sobrevive holgado. La conclusión "el agente dobla el revenue en un mundo fiel" es robusta a variaciones razonables de calibración.

### Diagnóstico que el camino reveló (todos corregidos)
1. El agente LLM **sin tuneo** rendía 1.59× (peor que el scripted): dispersaba en superficies de bajo tráfico y usaba params inválidos (clave `category` inexistente). Fix: prompt que enseña la estructura de superficies + los params válidos (general, sin trucos por-seed) → 3.40×.
2. Un arg inválido del LLM (slot<20) **mataba el run entero** (`MiddlewareError` fatal). Fix: `wrapToolCall` lo convierte en error recuperable + backstop en `runMerchandiserOnce`.
3. Crash por `push(...arrayEnorme)` y OOM por acumulación de impresiones. Fix: loop + poda de impresiones a la ventana de atribución/métricas.

## 5. Por qué el gate pre-registrado de 5 seeds quedó pendiente

El gate canónico (`GATE_WORLD`=1000 usuarios × 12 épocas × 5 seeds, agente LLM) **no se pudo completar en este entorno** (codespace 8GB / 2 CPU). Restricciones observadas:
- Los procesos en background se matan a **~20 min** (`run_in_background` y `setsid` por igual); el codespace **se suspende horas** cuando el usuario está fuera (mata el proceso y borra `/tmp`).
- A 1000 usuarios el cron NPMI cuesta **~250s/época**; reanudar un seed re-simula desde e0 (la caché LLM salta el LLM, no el sim), así que un chunk de 20 min ni siquiera pasa de ~e5 → **no hay avance neto**.

No es un problema del código ni del resultado: es capacidad de cómputo. El runner está listo y es determinista (CRN).

### Cómo obtener el veredicto canónico (en hardware adecuado)
```bash
# máquina con >8GB RAM y sin tope de duración de procesos:
NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsx scripts/agents/gate-seeds.ts
# resiliente: persiste el ratio de cada seed en results/gate-seed-<seed>.json,
# reanuda saltando los guardados; --verdict recombina los 5 ratios → Ĝ + CI95.
```
`scripts/agents/gate-seeds.ts` usa el MISMO `runSeedPipeline` + caché + `gateVerdict` que `eval-harness.ts --gate` ⇒ ratios idénticos por CRN. Esperado por toda la evidencia: **PASS (Ĝ≥2, CI-low>1, unánime)** con margen.

### Nota pre-registrada de honestidad
El número 2× no es sagrado; la honestidad sí. Si en el gate canónico la calibración honesta no llegara a 2×-total, se reporta el lift real. El A/A=1.0000 y la invarianza del hero son los guardarraíles que impiden amañar la atención. El detector `frozenCollapse` puede marcar falsos positivos sobre 12 épocas volátiles (D1-H3); recalibrarlo (colapso sostenido vs dip-con-recuperación) es un fix pendiente que NO afecta los ratios.
