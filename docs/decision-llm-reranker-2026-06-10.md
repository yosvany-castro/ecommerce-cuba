# Decisión: LLM reranker en el feed — 2026-06-10 (roadmap #9a)

**Contexto.** La auditoría destructiva F6 (docs/auditoria-destructiva-f6-2026-06-09.md, H7) señaló que
el LLM reranker estaba en producción **sin evidencia**: los 10 reportes F6 tenían `llm_enabled: false`.
El diseño (docs/diseno-como-hacer-que-funcione-2026-06-09.md, §2) exigía decisión con datos: o entra al
head-to-head limpio con coste y latencia medidos, o sale del feed. Esta es esa decisión.

## Medición (presupuesto duro: 40 casos)

Corrida: `f6-headtohead.ts --n 5000 --seed 123 --frame full --clean --llm --limit 40`
(dataset v2, artefactos train-only, evaluación sin fugas). Reporte:
`docs/superpowers/reports/2026-06-10-thesis-f6-llm-decision-n5000-v2-clean.{md,json}`.
f3-llm = DeepSeek listwise sobre el top-30 del pool RRF, fallback contado (no silencioso).

| Ranker | nDCG@10 | Recall@10 | MRR | Fallback |
|---|---|---|---|---|
| **f3-llm (DeepSeek)** | **0.000** | 0.000 | 0.0062 | **0/40 (0%)** |
| f3-rrf (baseline directo) | 0.000 | 0.000 | 0.0063 | — |
| f3-ltr | 0.017 | 0.050 | 0.0130 | — |
| popular-cohort (MVP naive) | 0.180 | 0.350 | 0.1414 | — |

Lectura: con 0 fallbacks (las 40 llamadas respondieron JSON válido), el LLM reordenó de verdad
(set-change@10 vs popular-cohort = 0.997) y **no movió ni una métrica de relevancia**: empata con
f3-rrf en 0.000 y queda a −100% de popular-cohort. No es un fallo de API — es que reordenar un pool
que no contiene la compra held-out no puede crear relevancia. Coherente con F3 (el estudio original
tampoco lo midió ganando) y con F6 (nunca participó).

## Coste (DeepSeek deepseek-chat, $0.14/M input · $0.28/M output, cache miss — src/lib/llm/deepseek.ts)

Prompt medido sobre el payload real (sistema 602 chars + JSON de 30 candidatos ≈ 7.3k chars;
salida ≈ 2.1k chars): **~2 250 tokens input + ~590 output por llamada** → **~$0.00048/llamada**.

- Corrida de 40 casos: **~$0.019** (dentro del presupuesto).
- **Por 1 000 feeds: ~$0.48** (~$14.4/mes a 1 000 feeds/día). Barato en absoluto, pero es 100% de
  coste variable por sesión para un lift medido de **0.000**.

## Latencia

La fase LLM tomó ~6 min para 40 llamadas secuenciales → **~8–10 s por llamada** (salida de ~590
tokens, sin streaming). La compuerta de Fase 3c es **p99 < 1.5 s**: el reranker listwise de 30 ítems
la viola por ~6×. No hay configuración razonable (menos candidatos, salida truncada) que lo baje a
1.5 s con un lift de 0.000 que lo justifique.

## Decisión: el LLM reranker SALE del feed por defecto

**Criterio explícito (pre-registrado en la tarea): si f3-llm no supera a f3-rrf en nDCG@10 limpio,
sale.** Resultado: 0.000 vs 0.000 — no supera. Además pierde la compuerta de latencia p99<1.5s y
añade ~$0.48/1 000 feeds de coste variable. F3 y F6 nunca lo midieron ganando; esta corrida limpia
confirma que tampoco gana cuando por fin participa.

**Qué se conserva.** El valor del LLM no está en reordenar un top-30 que ya viene ordenado por
señales de comportamiento; está donde el contexto textual es la señal dominante (diseño §2):

1. **Regalo explícito** — el usuario describe al destinatario en lenguaje natural.
2. **Búsqueda conversacional** — query libre que el retrieval léxico/vectorial no captura.
3. **Upsell argumentado** — generar la justificación de un complemento, no elegirlo.

Esos casos son de baja frecuencia (coste acotado), toleran >1.5 s (interacción explícita, no feed),
y el LLM aporta algo que el pipeline no tiene. Cada uno requiere su propia evaluación antes de
producción — esta decisión solo retira el reranker del camino por defecto del feed.

**Acción:** quitar la llamada a `llmRerank` del feed por defecto en producción (`feed.ts`) y dejar
`f3-llm` como variante experimental tras flag para los casos especiales listados.
