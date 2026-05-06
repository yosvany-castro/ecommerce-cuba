# Rebuild MVP E-commerce Cuba — Design Spec

**Fecha:** 2026-05-06
**Autor:** Claude Code session (brainstorming aprobado por el usuario)
**Estado:** Aprobado — listo para writing-plans
**Documentos fuente de verdad:** `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md` (lógica de negocio), `prompt-fase-0.md` y `prompt-fase-1-3.md` (criterios de aceptación originales por fase)

---

## 1. Contexto

Se perdieron 16 commits del proyecto. La BD en Supabase persiste pero los archivos de migración no. El usuario quiere reconstruir el MVP completo desde Fase 0 hasta Fase 5 con un enfoque TDD outside-in y **tests reales sin falsify** (ningún mock fuera del único permitido por diseño: la API agregadora).

## 2. Decisiones aprobadas durante brainstorming

| Decisión | Valor |
|---|---|
| Empezar desde | **Fase 0** (typo del usuario: "fase 4" → "fase 0") |
| Modelo de embedding | **`voyage-4`**, dimensión **1024**, dtype `float`, normalizado a norma 1 |
| BD de test | **`test_schema` separado** dentro del mismo proyecto Supabase |
| CI con tokens reales | **Sí desde Fase 0** (GitHub Actions) |
| Mutation testing | **Calibrado**: matemática crítica obligatoria + integration smoke 1× por fase |
| Triple revisión por fase | **3 subagentes separados** (Adversario / Auditor de Mocks / Probador de Comportamiento), no un mega-prompt |
| Modelos LLM | Sonnet 4.6 para query normalize, Haiku 4.5 para reranker y pipeline metadata |
| Stack | Next.js 16.2.5, Auth0 nextjs-auth0 4.20.0, anthropic-sdk 0.95.0, voyageai 0.2.1, supabase-js 2.105.3, vitest 4.1.5, playwright 1.59.1 |
| Package manager | pnpm |
| Schema en español | tsvector con `to_tsvector('spanish', ...)` |
| Índice vectorial | HNSW (`vector_cosine_ops`) |

## 3. Estructura de carpetas

```
ecommerce-cuba/
├── src/
│   ├── app/
│   │   ├── (public)/              # home, /products, /search, checkout simulado
│   │   ├── (auth)/                # rutas Auth0 v4
│   │   ├── (admin)/               # Sector E (Fase 4)
│   │   └── api/
│   │       ├── track/             # POST /track
│   │       ├── search/
│   │       ├── feed/
│   │       ├── cron/refresh-catalog/
│   │       └── health/{db,voyage,anthropic}
│   ├── sectors/
│   │   ├── a-tracking/
│   │   ├── b-catalog/
│   │   │   └── mock/              # ÚNICO mock del sistema
│   │   ├── c-search/
│   │   ├── d-personalization/
│   │   └── e-admin/
│   ├── lib/
│   │   ├── db/                    # cliente Supabase + cliente pg para migraciones
│   │   ├── auth/                  # Auth0 v4
│   │   ├── llm/                   # Anthropic con prompt caching
│   │   ├── embeddings/            # Voyage (voyage-4, 1024, normalizado)
│   │   ├── math/                  # funciones puras: normalize, cosine, rrf, mmr, npmi, decay, kmeans, shrinkage, hashQuery, weightForEventType
│   │   └── time/                  # Clock inyectable (TTL/decay testeable)
│   └── types/                     # tipos compartidos
├── supabase/
│   └── migrations/                # 0001-0012 SQL versionado
├── tests/
│   ├── unit/                      # vitest, sin BD ni red
│   ├── integration/               # vitest contra BD de test + servicios reales
│   └── e2e/                       # playwright
├── scripts/
│   ├── apply-migrations.ts
│   ├── verify-supabase.ts
│   ├── generate-test-schema-migration.ts
│   ├── seed-fixture.ts
│   ├── health-check.ts
│   └── check-test-quality.ts      # AST-based checker para anti-patterns
└── docs/superpowers/{specs,plans}/
```

## 4. Filosofía de testing — política dura

**Definición de test válido:**
> Un test es válido si y solo si (a) falla cuando el código bajo prueba está roto, y (b) verifica un comportamiento observable definido en el documento maestro.

**Tres capas:**

1. **Unit tests** (`tests/unit/`): solo `src/lib/math/*`. Datos sintéticos. Property-based con `fast-check` para invariantes. Mutation testing manual obligatorio para cada función matemática crítica con commit que documenta la mutación.
2. **Integration tests** (`tests/integration/`): vitest contra `test_schema` + Voyage real + Anthropic real. Reloj inyectable para TTL/decay. Cero mocks de servicios externos.
3. **E2E tests** (`tests/e2e/`): Playwright contra `next dev` + Auth0 real con usuario de test fijo + BD de test.

**Anti-patterns prohibidos** (validados por `scripts/check-test-quality.ts` en pre-commit):
1. `expect(x).toBeDefined()`/`not.toBeNull()` solos
2. Tests de existencia (`typeof fn === 'function'`)
3. Mocks de Supabase / Voyage / Anthropic / Auth0
4. Mocking circular del módulo bajo prueba
5. Snapshots sin contenido validado
6. `expect.anything()` / `expect.any(Object)` solos
7. `.skip`, `.only`, `xit`, TODO en tests
8. Una sola happy-path sin null/empty/invalid/edge
9. Validar implementación (`toHaveBeenCalledWith`, `internalState`)
10. `await sleep(...)` para ocultar race conditions
11. Tests duplicados (usar `test.each`)

## 5. Modelo de datos

**Migraciones SQL versionadas e idempotentes** en `supabase/migrations/`:

| # | Archivo | Contenido |
|---|---|---|
| 0001 | `0001_extensions.sql` | `CREATE EXTENSION vector, pg_trgm` |
| 0002 | `0002_test_schema.sql` | `CREATE SCHEMA IF NOT EXISTS test_schema` + `_migrations` table |
| 0003 | `0003_core_users_anon_recipients.sql` | `users`, `anonymous_sessions`, `recipients` |
| 0004 | `0004_products.sql` | `products` con `embedding vector(1024)`, `tsvector_es` GENERATED STORED, índice HNSW + GIN |
| 0005 | `0005_events.sql` | `events` con `client_event_id` UNIQUE parcial, índices por (anonymous_id, occurred_at), (user_id, occurred_at), (event_type, occurred_at), (session_id, occurred_at) |
| 0006 | `0006_personalization.sql` | `user_profiles`, `user_profile_modes` (con `vector_unnormalized` + `weight_sum`), `session_vectors`, `cohort_centroids`, `excluded_products` con `ttl_until` indexado |
| 0007 | `0007_co_occurrence.sql` | `co_occurrence` (a < b), `co_occurrence_top` |
| 0008 | `0008_search.sql` | `searches`, `product_query_cache`, `mock_calls` |
| 0009 | `0009_orders.sql` | `orders`, `order_items` con snapshot |
| 0010 | `0010_eval.sql` | `eval_holdout` |
| 0011 | `0011_indexes_and_views.sql` | índices remanentes |
| 0012 | `0012_test_schema_replicate.sql` | replica completa en `test_schema` (generada por script) |

**Aplicación:** `scripts/apply-migrations.ts` con tabla `_migrations(filename, applied_at, checksum)`. Aborta si checksum cambió desde aplicación previa (drift detection).

## 6. Roadmap de ejecución

Cada fase sigue: **pre-flight → test rojo → impl mínima → verde → refactor → commit pequeño → al cerrar: criterios + triple revisión + reporte**.

### Fase 0 · Fundaciones
- Setup Next.js + estructura de carpetas + tooling
- Migraciones 0001-0012 + scripts (apply, verify, generate-test-schema)
- Clientes: Supabase (con schema switch), Voyage v0.2.1 (con fallback a fetch directo si rompe), Anthropic con prompt caching, Auth0 v4
- Mock de API agregadora: 25 productos exactos, latencia 2-4s con jitter, error rate ~2%, contador de costo
- Fixture de 500 productos: 40% ropa, 20% electrónica, 15% hogar, 10% juguetes/bebé, 10% belleza, 5% otros
- Funciones puras iniciales: `normalize`, `cosine` con property tests + mutation
- Healthchecks `/api/health/*`
- CI GitHub Actions con tokens reales
- Triple revisión

### Fase 1 · E-commerce básico + tracking
- Home + detalle de producto + búsqueda LIKE + carrito + checkout simulado
- Sector A: anonymous_id (cookie 1 año), session_id (timeout 30 min), schema fijo de eventos, `/api/track` idempotente, fusión de identidades
- Cron real + pipeline de enriquecimiento (LLM normaliza metadata → Voyage genera embedding → tsvector → dedup → last_refreshed_at)
- Triple revisión

### Fase 2 · Búsqueda híbrida
- LLM normaliza queries con prompt versionado
- Cache exacto + cache semántico (θ provisional 0.92, calibración real en Fase 5)
- BM25 + cosine en paralelo + RRF (k₀=60)
- Llamada al mock cuando hits<12 Y confidence>0.5
- Vista de búsquedas en admin
- Triple revisión

### Fase 3a · Personalización básica
- Vector único de perfil + sesión con α dinámico
- Actualización incremental con `vector_unnormalized` + `weight_sum`
- Lista de exclusión con TTL
- Cold start con prior por cohorte + shrinkage bayesiano (κ=10)
- Onboarding declarativo
- Recall@10 ≥ baseline + 20%
- Triple revisión

### Fase 3b · Multi-vector + co-ocurrencia + RRF
- Multi-vector usuario (0/1/2/3 modos según volumen)
- Grafo de co-ocurrencia + NPMI nocturno + top-50 por producto
- 3 fuentes paralelas (semántica multi-modo / co-ocurrencia / popularidad por cohorte) + RRF
- Recall@10 ≥ Fase 3a + 15%, nDCG@10 mejora
- Triple revisión

### Fase 3c · MMR + LLM reranker
- MMR (λ=0.7) sobre top-100 RRF → top-30
- LLM reranker contextual top-30 → top-10 con razones
- Latencia p99 < 1.5s
- Razones coherentes ≥ 80%
- Triple revisión

### Fase 4 · Admin completo
- Vistas operativas y de auditoría (incluyendo modos del usuario)
- Estados de excepción con sugerencias por similitud + co-ocurrencia
- Triple revisión

### Fase 5 · Validación
- Eval set con holdout temporal
- Recall@k, nDCG@k, MRR, Hit Rate@k vs baselines
- Calibración empírica de θ (10k queries + 200 etiquetadas, FPR ≤ 0.1%)
- Documento de respuesta a las 4 hipótesis P1-P4

## 7. Triple revisión al cierre de cada fase

3 subagentes invocados por separado (no mega-prompt). Cada uno con prompt enfocado:

- **Adversario:** revisa cada test, identifica los que sobrevivirían mutaciones plausibles.
- **Auditor de Mocks:** grep todos los mocks, valida que solo existe el mock de la API agregadora.
- **Probador de Comportamiento:** sin ver el código, diseña casos desde el documento maestro y los ejecuta contra el sistema corriendo.

Compuerta: si los 3 reportan limpio → fase cerrada. Reporte de fase incluye output literal de los 3.

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `voyageai` v0.2.1 inestable | Cliente aislado tras interfaz `VoyageClient`. Reemplazo por fetch directo en 30 min si rompe. |
| Costos de tokens en CI | API keys dedicadas con cap mensual. Estimación $5-10/mes. |
| Drift `public` ↔ `test_schema` | Migración 0012 generada por script + test que compara columnas/índices. |
| Auth0 cambia el flow E2E | Usuario de test fijo + flow grabado con codegen + CI lo detecta. |
| Recall@10 no supera baseline | No "ajustar números hasta que pase". Investigar pesos, cohort, decay, eval set. |
| LLM reranker latencia >1.5s | Plan B: cache de razones por (user, top30_hash). Plan C: cross-encoder destilado (adelantar de v2). |

## 9. Lo que está fuera de scope (deferred)

- Pasarela de pago real
- Logística física real
- App móvil
- Notificaciones (email/push)
- A/B testing infra (v2)
- Two-tower DPR, Item2vec, cross-encoder neural (v2)
- Multi-objective ranking con λ aprendido (v2)
- Multi-idioma
- Detección de fraude
- ORM (Prisma/Drizzle)
- Redis / Kafka / microservicios
- UI library externa (Tailwind plano hasta Fase 4)
