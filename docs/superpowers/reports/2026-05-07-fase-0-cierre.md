# Reporte de cierre — Fase 0 · Fundaciones

**Fecha:** 2026-05-07
**Branch:** `feat/fase-0-fundaciones` (29 commits sobre `main`)
**Spec:** `docs/superpowers/specs/2026-05-06-rebuild-mvp-ecommerce-cuba-design.md`
**Plan:** `docs/superpowers/plans/2026-05-06-fase-0-fundaciones.md`

---

## Hitos completados (todos los entregables del plan)

| # | Tarea | Commit |
|---|---|---|
| 1 | Next.js 16 + TS strict + Tailwind v4 manual scaffold | `f5b4d06` (+ fix `d79e822`) |
| 2 | Estructura de sectores y lib | `46ca820` |
| 3 | Test infra: vitest + playwright + AST anti-pattern checker | `495e156` (+ fix `5138509`) |
| 4 | Migration runner con checksum drift detection | `9355fb7` |
| 5 | Migraciones 0001-0002 (vector ext + test_schema) | `4dc3a6d` |
| 6 | Migración 0003 (users, anonymous_sessions, recipients) | `dd43a25` |
| 7 | Migración 0004 (products con vector(1024) + tsvector + HNSW) | `a3ee92d` |
| 8 | Migración 0005 (events con idempotencia + índices) | `18df373` |
| 9 | Migración 0006 (personalization tables) | `ca048b0` |
| 10 | Migración 0007 (co_occurrence) | `6c1656e` |
| 11 | Migraciones 0008-0010 (search, orders, eval) | `7512c52` |
| 12 | Migración 0011 + verify-supabase script | `59bbcbb` |
| 13 | Migración 0012 (test_schema replica) generada por script + parity test | `d8c5d10` |
| 14 | Clientes Supabase + pg con scope public/test | `c1e60c9` (+ fix `af2e899`) |
| 15 | Cliente Voyage (voyage-4, fetch-based, 1024 dim normalizado) | `5055d2a` |
| 16 | Cliente Anthropic con prompt caching opcional | `cc9c656` |
| 17 | Auth0 v4 middleware + página /profile + E2E test | `20271ae` |
| 18 | Clock inyectable | `316de89` |
| 19 | Math (normalize + cosine) con property tests + mutation testing | `159aeb7` |
| 20 | Mock fixture de 500 productos con distribución 40/20/15/10/10/5% | `8dc918b` |
| 21 | Mock aggregator 25/call, 2-4s jitter, 2% error | `48b2730` |
| 22 | Health endpoints + CLI script | `9fb6588` |
| 23 | GitHub Actions CI + README | `198c99e` |
| 24 | Triple revisión + fixes (Adversario `8625dc6`; final `4393d88`) | (esta task) |

## Tests escritos y estado final

- **Unit:** 3 archivos, **15 tests** (clock 4, normalize 4, cosine 7).
- **Integration:** 7 archivos.
  - migrations.test.ts: 11 tests (todos los esquemas verificados).
  - test-schema-parity.test.ts: 1 test (paridad columna por columna).
  - db.test.ts: 4 tests (Supabase scope='public' round-trip, throw en scope='test', search_path test/public).
  - voyage.test.ts: 4 tests (real API, dim 1024, norm ≈ 1, batch, query input_type, empty).
  - anthropic.test.ts: 2 tests (real API, prompt caching verifica `cache_read_input_tokens > 0`).
  - mock-aggregator.test.ts: 9 tests + 1 skipIf (long-run 200 calls gated en CI_FULL=1).
  - health.test.ts: 3 tests (skip por defecto; activos con `TEST_HEALTH_ENDPOINTS=1` + `pnpm dev` corriendo).
- **E2E:** 1 archivo, 1 test (skip cuando `E2E_TEST_USER_*` no configurados; flujo Auth0 universal real cuando sí).

**Mutation testing aplicado y documentado en commits:**
- `normalize.ts`: cambiar `inv = 1/Math.sqrt(s)` por `Math.sqrt(s)` → property test "norm == 1" falló como esperado.
- `cosine.ts`: cambiar `dot/Math.sqrt(sa*sb)` por `dot/(sa*sb)` → property test "cosine ∈ [-1,1]" falló como esperado.

**Anti-patterns prohibidos:** `pnpm test:quality` reporta `OK — scanned 11 files, 0 violations`.

## Bugs encontrados durante el desarrollo

(Encontrados y arreglados en esta misma fase — la realidad de TDD outside-in.)

1. **DB drift catastrófico:** la BD de Supabase tenía 18 tablas con schema en español de los 16 commits perdidos. Decisión autorizada por el usuario: drop schema completo + recrear desde migraciones limpias en inglés. Cleanup ejecutado vía `scripts/_one_off_cleanup.ts` (creado y borrado en la misma corrida; no committed).
2. **`@eslint/eslintrc` undeclared dep + `next lint` removido en Next 16:** ESLint completamente roto en commit inicial. Solución: reescribir `eslint.config.mjs` para usar flat config nativa de `eslint-config-next` (sin `FlatCompat`) y cambiar `lint` script a `eslint --no-error-on-unmatched-pattern src tests scripts`.
3. **Tailwind 4.0.0 incompatibilidad con Turbopack:** primera dep resolved con un bug de scanner; subido a 4.2.4.
4. **AST checker R1 false-negative:** la traversal de PropertyAccessExpression no subía suficiente, perdía `expect(x).not.toBeNull()`. Fix: walk-up loop completo.
5. **AST checker R7 false-positive:** flagueaba `myChain.skip()` (no test global). Fix: restringir a `["it","test","describe","fit","fdescribe","suite","context"]`.
6. **AST checker R7 false-positive en conditional skips:** flagueaba `it.skipIf` y `test.skip(condition, reason)`. Fix: solo flag cuando primer arg es string literal o no hay args.
7. **Vitest 4 deprecation:** `poolOptions.forks.singleFork: true` → `maxWorkers: 1`.
8. **`test_schema` vs `test`:** PostgREST en Supabase exponía un schema `test` (prototype con nombres en español de los 16 commits perdidos), no `test_schema`. El primer implementer pasó tests por la razón equivocada. Fix: drop `test` (mantener vacío con USAGE grant para PostgREST cache), `getSupabaseClient({ scope: "test" })` ahora throw con mensaje claro, integración tests usan `getPgClient` directo.
9. **`to_regclass` schema-qualified output:** assertion `.toBe('users')` falla cuando search_path no incluye public. Fix: usar `.toMatch(/(^|\.)tablename$/)`.
10. **`order_status` enum chequeo cross-schema:** DO block en migration 0009 chequeaba `pg_type` sin filtrar por namespace. Fix: agregar `JOIN pg_namespace n ON ... WHERE n.nspname='public'`.
11. **Generator de `0012_test_schema_replicate.sql` corrupting `order_status` references:** orden de regex causaba `test_schema.test_schema.order_status`. Fix: dedup + lookbehind + restore step.
12. **Anthropic prompt caching threshold:** plan decía 1024 tokens, real es 4096 para Haiku 4.5. Fix: `repeat(400)` → `repeat(1000)`.
13. **Aggregator empty pool returns 25 undefineds:** cuando `query` no matchea nada, `pool[Math.floor(Math.random()*0)]` → 25 undefineds. Fix: early return `products: []`.
14. **`migrate:test` script flag silently ignored:** removido del `package.json`.
15. **Anthropic SDK `as never` casts** quitados, replaceados con type guard correcto.
16. **`migrations.test.ts` connection leak:** sin `afterAll(client.end)`. Fix agregado.
17. **`health.test.ts` sin skip guard:** corría en CI sin dev server, fallaba con connection refused. Fix: `describe.skipIf(!RUN)` con `TEST_HEALTH_ENDPOINTS=1`.

---

## Output literal de los 3 revisores + final reviewer

### === AGENTE 1 (Adversario) ===

> **Verdict: NEEDS REWORK** (15 strong tests, 6 weak tests, 3 anti-pattern violations).
>
> Tests fuertes que sí cazan mutaciones plausibles: cosine identity/orthogonality/symmetry properties, normalize property test, clock.advance, co_occurrence ordered constraint, products vector/tsvector columns, _migrations checksum, mock aggregator filter+counter, test_schema parity columna por columna.
>
> Tests débiles flagueados:
> 1. `clock.test.ts` — `fixedClock.set()` totalmente no testeado.
> 2. `db.test.ts` — `toContain("test_schema")` pasa con search_path = sólo "test_schema" (sin "public" fallback).
> 3. `db.test.ts` — primer test no verifica el schema real configurado en el cliente Supabase.
> 4. `migrations.test.ts` — "core tables" sólo enumera columnas de `users`, no de `anonymous_sessions` ni `recipients`.
> 5. `migrations.test.ts` — "creates _migrations table on first run" tiene loophole: pasa por idempotencia accidental.
> 6. `mock-aggregator.test.ts` — "error rate" lower bound `>= 0` permite mutación `ERROR_RATE = 0`.
> 7. `health.test.ts` — `/api/health/anthropic` no asserta `input_tokens > 0`/`output_tokens > 0` (mutación de hardcoded JSON sobreviviría).
>
> Anti-pattern violations: tautología `expect(rate).toBeGreaterThanOrEqual(0)`; regex laxa `/float8|double_precision/`; assertion redundante de typeof seguido de toBe.
>
> **Recomendación:** rework 6 tests antes de cierre.

**Status post-fix (`8625dc6`):** 5 de los 6 reescritos. El restante (#5, "_migrations first run") deferido a Phase 1 — fix requiere setup destructivo con cross-test side effects.

### === AGENTE 2 (Auditor de Mocks) ===

> **Verdict: APPROVED**
>
> Total mock-like occurrences fuera del mock permitido: **0**.
>
> Único mock permitido: `src/sectors/b-catalog/mock/` (aggregator + fixture + types). Simula API agregadora externa con latencia 2-4s, 2% error rate, fixture de 500 productos seeded mulberry32 (seed 20260506).
>
> Tests que TODOS los archivos pasan limpios:
> - clock/cosine/normalize.test.ts: sin mocks, fast-check property testing.
> - anthropic/db/health/migrations/test-schema-parity/voyage.test.ts: APIs reales.
> - mock-aggregator.test.ts: solo ejercita el mock permitido (con sus propios `getCallCount`/`resetCallCount`).
> - auth.spec.ts: Playwright real, conditional skip permitido.
>
> Patrones tolerados confirmados limpios: `mulberry32` PRNG (no es mock, es PRNG determinista), `getCallCount` (state machine del propio mock), `Math.random()` (no es mock, es no-determinismo), `it.skipIf` y `test.skip(cond, reason)` (conditional skips permitidos).

### === AGENTE 3 (Probador de Comportamiento) ===

> **Verdict: APPROVED — 12/12 criterios verificables pasaron.**
>
> Verificaciones (resumen):
> 1. ✅ 19 tablas en `public` (18 spec + `_migrations`), todas vacías.
> 2. ✅ Extensión `vector` 0.8.0 + `pg_trgm` 1.6 activas.
> 3. ✅ `products.embedding` es `vector(1024)`.
> 4. ✅ `test_schema` paridad perfecta con `public`.
> 5. ✅ Anthropic responde "ok" con `claude-haiku-4-5-20251001` (32 input tokens, 4 output).
> 6. ✅ Voyage genera vector dim=1024 norm=1.0000.
> 7. ✅ Mock devuelve exactamente 25 productos por call, $0.04/call.
> 8. ✅ Latencias: 3528, 2021, 2424, 2685, 3620, 2037, 2038, 3488, 2598, 3295 ms — todas en [2000, 4000] ms con jitter real.
> 9. ⚠️ Error rate 2%: mecanismo correcto (`if (Math.random() < 0.02) throw`); 50 calls sin error es estadísticamente válido (P=0.36) — no se ejecutó las 200 calls del long-run test (gate CI_FULL=1).
> 10. ✅ Fixture distribución exacta: 200/100/75/50/50/25 = 40/20/15/10/10/5%.
> 11. ✅ Auth0: `curl /profile` → 307 redirect a `/auth/login`. Auth0 Universal Login HTML servido (cdn.auth0.com).
> 12. ✅ Estructura de carpetas: 5 sectores + 6 lib subdirs + types.
>
> Comportamientos no verificables (esperado):
> - Auth0 E2E completo (requiere `E2E_TEST_USER_*` que el tester no tiene — test skipea correctamente).
> - Tasa de error con N=200 (long-run gated, no ejecutado).
> - Costo simulado en admin (Sector E pertenece a Phase 4).

### === FINAL CODE REVIEWER ===

> **Assessment: APPROVED WITH FOLLOW-UPS**
>
> 84 archivos cambiados, +8191 / -1 líneas, 28 commits.
>
> Strengths: arquitectura limpia por sector y lib, migraciones idempotentes, math con property tests, mock determinista, runner con drift detection.
>
> Critical (deben fijar antes de merge): `health.test.ts` sin skip guard → CI rompe; aggregator empty pool → 25 undefineds.
>
> Important: `migrate:test` flag ignorado; `as never` casts en anthropic; `migrations.test.ts` afterAll faltante; verificar Haiku model ID.
>
> Phase 1 follow-ups: remove `voyageai@0.2.1` (dead dep), import normalize de math/normalize en voyage.ts (DRY), generator regex range dinámico, supabase lazy validation, escalar checker para wrappers.

**Status post-fix (`4393d88`):** ambos Critical + 4 Important arreglados. Haiku model ID confirmado válido por re-run del test integration. Phase 1 follow-ups documentados abajo.

---

## Métricas finales

- **Tablas en BD:** 19 en `public` + 19 en `test_schema` (paridad).
- **Productos en fixture:** 500 (40/20/15/10/10/5% por categoría).
- **Tests totales:** Unit 15 + Integration 33 + E2E 1 = **49 tests**.
- **Anti-pattern violations:** 0.
- **Tokens de tests reales gastados durante Phase 0:** ~$0.50 estimado (Voyage embeddings + Anthropic Haiku + caching).
- **Costo simulado del mock acumulado durante tests:** ~$1.20 (rough — depende de cuántas veces se corrieron los integration tests).

## Items pendientes / Setup manual del usuario

**Antes de runs locales completos:**
- Crear usuario test en Auth0 (`e2e-test@cuba.dev` o similar) + agregar `http://localhost:3000/auth/callback` a Allowed Callback URLs en la app de Auth0. Setear `E2E_TEST_USER_EMAIL`/`PASSWORD` en `.env.local`.

**Antes de habilitar CI con APIs reales:**
- Configurar GitHub Secrets: `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY_CI` (key dedicado con cap mensual), `VOYAGE_API_KEY_CI` (key con tier de pago — free 3 RPM rompe en CI con concurrencia).

**Para correr los healthchecks como integration tests:**
- `pnpm dev` corriendo + `TEST_HEALTH_ENDPOINTS=1 pnpm test:integration tests/integration/health.test.ts` (alternativa: `pnpm health-check` desde CLI sin necesitar dev server).

## Phase 1 follow-ups (track)

1. **`_migrations` first run idempotency loophole:** test que reescribe la asserción "drops + recreates _migrations explicitly" antes de migrate. Tiene side effects con otros tests, requiere isolation strategy.
2. **`generate-test-schema-migration.ts` regex range dinámico:** actualmente hardcoded a `0003-0011`; cuando lleguen migraciones de Phase 1+, modificar para detectar dinámicamente todas las migrations table-level except 0001/0002/0012.
3. **DRY math/normalize:** `voyage.ts` duplica `l2normalize` localmente; reemplazar por import de `@/lib/math/normalize`.
4. **`voyageai@0.2.1` dead dep:** removerlo del `package.json` (no se usa, todo va por `fetch`).
5. **`getSupabaseClient` lazy validation:** module-level throws en `src/lib/db/supabase.ts` rompen tests que importen transitivamente sin las env vars; cambiar a factory pattern.
6. **`config` module con zod:** centralizar acceso a `process.env` con validación tipada en lugar de los seis lugares actuales.
7. **AST checker para wrappers:** banned mock list solo cubre `@/lib/db|llm|embeddings|auth`. Cuando lleguen service-layer files en Phase 1, escalar para incluir indirección.
8. **CI E2E:** wirear Playwright + Auth0 test user en CI cuando deploy preview esté listo.
9. **Mocking strategy doc:** después de Phase 1, escribir un `docs/mocking-strategy.md` corto con la regla "el agregador es el único mock" para nuevos contributors.

## Decisión

✅ **Fase 0 cerrada. Listo para Fase 1.**

Pendiente de tu lado: setup manual de Auth0 + GitHub Secrets antes del primer push del branch a remote (o antes de la primera PR a main si ya está pusheado).
