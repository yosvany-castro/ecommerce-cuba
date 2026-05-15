# E-commerce Cuba — MVP

MVP de e-commerce reseller con personalización vectorial multi-modo (modelo pagador-receptor).

## Stack

- **Framework:** Next.js 16 (App Router, TS strict, Turbopack)
- **UI:** Tailwind v4 (CSS-first config)
- **DB:** Supabase (Postgres + pgvector + tsvector + HNSW)
- **Auth:** Auth0 v4 (`@auth0/nextjs-auth0`)
- **LLM:** Anthropic SDK (Claude Sonnet 4.6 para query normalize, Haiku 4.5 para reranker)
- **Embeddings:** Voyage AI (`voyage-4`, 1024 dim, normalizado L2)
- **Tests:** Vitest + Playwright + fast-check
- **Package manager:** pnpm 10

## Setup local

```bash
pnpm install
cp .env.example .env.local   # luego rellenar valores reales
pnpm migrate                 # aplica migraciones a Supabase
pnpm verify:supabase         # verifica estado del schema
pnpm health-check            # smoke test contra Voyage + Anthropic + DB
pnpm dev                     # levanta el servidor en localhost:3000
```

## Tests

| Comando | Qué corre | Requiere |
|---|---|---|
| `pnpm test:unit` | Unit tests (`tests/unit/`) | Nada (offline, sin red) |
| `pnpm test:integration` | Integration tests (`tests/integration/`) | DB + Voyage + Anthropic reales |
| `pnpm test:e2e` | Playwright E2E (`tests/e2e/`) | `pnpm dev` corriendo + usuario test en Auth0 |
| `pnpm test:quality` | AST checker para anti-patterns | Nada |
| `pnpm test:all` | Todo lo anterior | Todo |

## Filosofía de tests

- **Único mock permitido:** la API agregadora en `src/sectors/b-catalog/mock/`. Todo lo demás (Supabase, Auth0, Voyage, Anthropic) es **real desde día 1**.
- Anti-patterns prohibidos validados por `scripts/check-test-quality.ts` en pre-commit y CI.
- Mutation testing manual obligatorio para funciones matemáticas críticas. El commit message documenta la mutación verificada.
- Ver el spec en `docs/superpowers/specs/2026-05-06-rebuild-mvp-ecommerce-cuba-design.md` para detalles.

## Estructura

```
src/
  app/                  # Next.js App Router
    api/health/{db,voyage,anthropic}/   # healthchecks públicos
    (auth)/profile/     # ejemplo de ruta protegida
  sectors/
    a-tracking/         # Sector A: captura de eventos (Phase 1+)
    b-catalog/
      mock/             # ÚNICO mock del sistema (fixture 500 productos)
    c-search/           # Sector C: búsqueda híbrida (Phase 2+)
    d-personalization/  # Sector D: motor multi-vector (Phase 3+)
    e-admin/            # Sector E: admin (Phase 4+)
  lib/
    db/{supabase,pg}.ts # clientes con scope público/test
    auth/index.ts       # Auth0 v4 client
    llm/anthropic.ts    # Claude con prompt caching
    embeddings/voyage.ts# voyage-4 fetch-based
    math/{normalize,cosine}.ts   # funciones puras (más en Phases 1+)
    time/clock.ts       # Clock inyectable para TTL/decay testeable
  types/
supabase/migrations/    # SQL versionado, runner con drift detection
scripts/                # apply-migrations, verify-supabase, health-check, seed-fixture, check-test-quality
tests/{unit,integration,e2e,helpers}/
docs/superpowers/{specs,plans}/  # spec maestro + planes por fase
```

## Auth0 setup (one-time, manual)

Para correr los E2E de Auth0 localmente:

1. Auth0 dashboard → **Applications** → tu app → **Settings**:
   - Add to **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
   - Add to **Allowed Logout URLs**: `http://localhost:3000`
   - Add to **Allowed Web Origins**: `http://localhost:3000`
2. Auth0 dashboard → **Users** → **Create User**: e.g. `e2e-test@cuba.dev` con password fuerte.
3. Add to `.env.local`:
   ```
   E2E_TEST_USER_EMAIL=e2e-test@cuba.dev
   E2E_TEST_USER_PASSWORD=<password>
   ```

## CI setup (one-time, manual)

GitHub Actions runs in `.github/workflows/ci.yml`. Configurar secrets en repo settings → Secrets and variables → Actions:

| Secret | Valor |
|---|---|
| `SUPABASE_DB_URL` | igual al `.env.local` |
| `NEXT_PUBLIC_SUPABASE_URL` | igual al `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | igual al `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | igual al `.env.local` |
| `ANTHROPIC_API_KEY_CI` | **key dedicado con cap mensual de gasto** |
| `VOYAGE_API_KEY_CI` | **key dedicado, idealmente tier de pago** (free es 3 RPM) |

Estimación de costos en CI: ~$5-10/mes con corridas razonables.

## Roadmap

- ✅ **Phase 0** — Fundaciones (este branch). Ver `docs/superpowers/plans/2026-05-06-fase-0-fundaciones.md`.
- 🔜 **Phase 1** — E-commerce básico + tracking
- 🔜 **Phase 2** — Búsqueda híbrida (BM25 + cosine + RRF + LLM normalize)
- 🔜 **Phase 3a/b/c** — Personalización (vector único → multi-vector + RRF → MMR + LLM reranker)
- 🔜 **Phase 4** — Admin completo
- 🔜 **Phase 5** — Validación con eval set + métricas Recall@k/nDCG@k

Documento maestro: `MVP_Ecommerce_Personalizado_Documento_Maestro v2.md`.
