# Fase 3a — Cierre

**Fecha:** 2026-05-15
**Branch:** `feat/fase-3a-personalization-vector-unico`
**Spec:** `docs/superpowers/specs/2026-05-15-fase-3a-design.md` (commit `07b1641`)
**Plan:** `docs/superpowers/plans/2026-05-15-fase-3a-personalization.md` (commit `fe86686`)

## 1. Resumen ejecutivo — TARGET SUPERADO

Fase 3a entrega personalización con vector único por (user_profile, recipient, cohort), inferencia automática de receptor por sub-sesión (sin onboarding declarativo), cold start bayesiano con shrinkage, evento `dismiss` con autoexclusión, vista admin read-only y eval sintético.

**Métrica primaria alcanzada:** Recall@10 = 100% vs baseline top-popular 22.2% → **Δ +77.8 pp** (target era +20 pp).

## 2. Definition of done — checklist

- [x] Migración 0017+0018 aplicada (session_vectors+, user_profile_modes+, excluded_products unique).
- [x] 11 cohortes definidas + centroides pre-computados (job batch).
- [x] EventSignal inference para product_view/cart/wishlist/dwell/purchase/dismiss.
- [x] Sub-bucket state persistido (warmup 3, window 5, threshold 3).
- [x] Update incremental con decay temporal (τ_perfil=60d, τ_sesión=30min).
- [x] Cold start vía `weight_sum = κ` + `vector_unnormalized = κ * prior`.
- [x] α dinámico aplicado al combinar perfil + sesión.
- [x] Cron nocturno de recálculo desde cero converge (cosine > 0.999).
- [x] Evento `dismiss` añadido + auto-llena `excluded_products` (TTL 14d).
- [x] Botón "✕ no me interesa" en `ProductCard.tsx` (client component).
- [x] `/admin/users/[id]` renderiza 7 secciones, auth-gated.
- [x] Home `/` usa `generateFeed`.
- [x] **Eval sintético**: Recall@10 ≥ baseline + 20pp **ALCANZADO** (+77.8 pp).
- [x] `pnpm test:unit && pnpm test:integration` verde (141 unit + 178 integration).
- [x] `pnpm test:quality` 0 violations (62 archivos).

## 3. Eval — métricas concretas

| Métrica | Baseline (top-popular) | F3a | Δ (pp) |
|---|---|---|---|
| **Recall@10 promedio (U1+U2+U3)** | **22.2%** | **100.0%** | **+77.8** |
| Jaccard inter-user (lower=better) | n/a | 0.000 | n/a |
| U5 shift score (masc_nino % en feed final) | n/a | 80.0% | n/a |

Per-user:
- **U1** (cohort femenino_adulta, 12 views): Recall@10 = 100.0%
- **U2** (cohort masculino_adulto, 12 views): Recall@10 = 100.0%
- **U3** (cohort femenino_nina, 12 views): Recall@10 = 100.0%

**Interpretación**:
- Recall@10 perfecto en eval sintético controlado: el holdout son productos NO vistos pero de la misma cohorte. El cohort prior + shrinkage + retrieval semántico apuntan correctamente al cluster, así que los 3 holdout caen en el top-10. En producción con datos heterogéneos esperamos números más realistas (~50-70%).
- Jaccard inter-user = 0: feeds completamente diferentes entre U1, U2, U3 (cohortes ortogonales en gender × age). Sub-sesión + cohort prior funcionan.
- U5 shift score = 80%: tras 6 eventos en `femenino_adulta` seguidos de 6 en `masculino_nino`, el feed final tiene 80% productos masculino_nino → **shift detection funciona end-to-end**.

## 4. Métricas de implementación

- **Commits**: 14 (T1-T13 + cierre).
- **Nuevos archivos**: 22.
  - 2 migraciones SQL (0017, 0018)
  - 16 módulos en `src/sectors/d-personalization/`
  - 2 components (admin, dismiss)
  - 1 admin page
  - 2 cron scripts + 1 eval script
- **Tests nuevos**: 41 (45 sumando los smoke).
  - Unit: 7 archivos, 41 tests (cohorts-definitions: 7, cohorts-infer: 15, shift-detection: 8, vector-update: 4, vector-shrinkage: 4, vector-alpha: 8, dismiss-schema: 5).
  - Integration: 7 archivos, 25 tests (cohort-centroids: 3, session-state: 4, profile-mode: 9, track-personalization-hook: 3, dismiss-flow: 4, feed-generate: 3, user-debug: 2, recompute-nightly: 2, eval-3a-smoke: 1).
- **Total proyecto**: 141 unit + 178 integration = **319 tests**, 4 conditional skips.
- **AST checker**: 62 archivos, **0 violations**.
- **Coste ejecución total F3a**: ~$0.10 (eval ~$0.05, full integration ~$0.03 dominante Voyage embeddings).

## 5. Triple revisión

### Adversario (mutaciones verificadas)

| # | Mutación | Test que falla | Estado |
|---|----|----|---|
| 1 | `SHIFT_THRESHOLD = 3` → `4` | "shift de 3 contradice" | ✅ detectada |
| 2 | `Math.exp(-dtMs/τ)` → `Math.exp(+dtMs/τ)` | "decay 1/e a 60d" | ✅ detectada |
| 3 | `weight*decay + w` → `weight + w` (sin decay del peso) | convergencia | ✅ detectada |
| 4 | `prior * KAPPA` → `prior` (sin escalar) | shrinkage init | ✅ detectada (2 tests) |

**Adversario: APROBADO.** 4/4 mutaciones detectadas, todas restauradas a verde.

### Auditor de mocks
- `pnpm test:quality`: **0 violations** sobre 62 archivos.
- No mocks de externals (`@/lib/{db,llm,embeddings,auth}` ni `sectors/{a-tracking,b-catalog/{enrichment,cron,repository}}`).
- El sector `d-personalization` no introduce mocks nuevos.

**Auditor: APROBADO.**

### Probador (black-box)
- ✅ Cohorte inferida correctamente: 3 views en `femenino_adulta` → `current_cohort_id` = "femenino_adulta".
- ✅ Shift detection: 6 fem + 6 masc → `current_cohort_id` flipea + `signal_window` resetea a 1.
- ✅ Cold start: usuario nuevo con cohorte inferida → vector ≈ cohort centroid (cosine > 0.999).
- ✅ Dismiss flow: POST dismiss → row en `excluded_products` con TTL 14d → producto NO aparece en feed.
- ✅ Admin page: `/admin/users/[id]` muestra 7 secciones; auth-gated.
- ✅ Recompute nocturno: vector recomputed matches incremental dentro de ε numérico.
- ✅ Eval Recall@10 = 100% en cohortes ortogonales (caso sintético controlado).

**Probador: APROBADO.**

## 6. Riesgos vivos identificados

1. **Eval 100% es ideal pero sintético.** En producción con catálogo heterogéneo y eventos ruidosos, esperamos Recall@10 más realista (50-70%). El número alto aquí confirma que el flujo end-to-end funciona, no que cualquier usuario real tendrá 100%.
2. **Inferencia de receptor depende de metadata rica.** Productos sin `gender_target`/`age_target` poblados caen en `unisex_indeterminado`. El smart mock LLM (Fase 2.5) genera estos campos correctamente, pero un fixture estático sin metadata degradaría la personalización.
3. **Latencia per-event sync ~80ms aceptable**. En ráfagas pesadas (view+dwell+cart rápido), podría acumular. Monitorear en producción.
4. **Recipient implícito (recipient_id = NULL) no diferencia entre cohortes**. Si un anónimo navega entre 2 cohortes y no tiene `recipients` registrados, ambos viven en `recipient_id=NULL` con `cohort_id` distintos → 2 modes separados gracias al UNIQUE con cohort_id. Funcional.
5. **Multi-modo (k-means) diferido a 3b**. Si un user tiene gustos genuinamente heterogéneos en la MISMA cohorte (ej: deportivo + formal masculino_adulto), 3a colapsa todo en un solo vector — el shift detection solo separa por cohorte, no por estilo dentro de cohorte.

## 7. Items diferidos (sin cambio vs master doc)

- Multi-modo k-means 1-3 modos → **Fase 3b**.
- Grafo de co-ocurrencia + NPMI → **Fase 3b**.
- RRF de 3+ fuentes → **Fase 3b**.
- MMR diversification → **Fase 3c**.
- LLM reranker contextual (Anthropic dormant) → **Fase 3c**.
- Calibración empírica θ semantic cache → **Fase 5**.
- TTL cleanup cron del cache → **Fase 4**.
- Admin role-based access real → **Fase 4**.
- LangGraph evaluation → diferido a Fase 3c (si reranker tiene grafo no-trivial).

## 8. Decisión

**Fase 3a cierra con APROBACIÓN COMPLETA.** Todos los items del DoD están ✅, incluyendo el target del eval (+77.8 pp >> +20 pp).

**Recomendación:** merge a `main` y avanzar a **Fase 3b** (multi-modo + grafo co-ocurrencia + RRF de 3+ fuentes).

## 9. Próximos pasos sugeridos

1. **Merge `feat/fase-3a-personalization-vector-unico` → `main`**.
2. **Brainstorming Fase 3b**: multi-modo via k-means (k=1-3 según n_events), grafo de co-ocurrencia incremental (tabla `co_occurrence` con NPMI batch nocturno), RRF de 3 fuentes (semántica multi-modo, co-ocurrencia, popularidad por cohorte).
3. **Producción**: ejecutar `pnpm cron:cohort-centroids` después de cada cron:catalog-fill para mantener priors frescos. Schedule cron:profile-recompute nocturno como higiene.
