# Prompt inicial para Claude Code Web — Fase 0

> Pegar este prompt en la primera instrucción al iniciar la sesión en `claude.ai/code`.
> Adjuntar también el documento `MVP_Ecommerce_Personalizado_v1_2.md` como contexto.

---

## Contexto

Estoy iniciando un MVP de e-commerce personalizado con personalización vectorial multi-modo. El documento adjunto es la fuente de verdad del diseño completo (sectores A-E, modelo de datos, roadmap por fases). Tu trabajo en esta sesión es ejecutar **únicamente Fase 0 (Fundaciones)** del roadmap — no avances a Fase 1 sin que yo lo apruebe.

## Stack acordado (componentes — NO versiones)

- **Framework full-stack:** Next.js (App Router, TypeScript, Turbopack)
- **Base de datos:** Supabase (Postgres con extensión `vector` / pgvector habilitada)
- **Auth:** Auth0 con el SDK oficial `@auth0/nextjs-auth0`
- **LLM:** API de Anthropic con `@anthropic-ai/sdk`
- **Embeddings:** Voyage AI (`voyageai` package) — proveedor oficial recomendado por Anthropic
- **Hosting de desarrollo:** la VM de Claude Code Web; deploy futuro a Vercel

## REGLA INVIOLABLE — verificación de versiones y docs

**No instales ningún paquete ni escribas código contra ninguna API sin antes verificar cuál es la versión estable más reciente y leer la documentación oficial actual.** Tu base de conocimientos puede estar desactualizada. La fecha de hoy y los releases recientes mandan, no tu memoria.

Para cada componente del stack, antes de instalarlo o usarlo:

1. Hacer web search de "<paquete> latest version <año actual>"
2. Visitar la documentación oficial actual del producto
3. Confirmar la versión estable a usar y los patrones de API vigentes
4. Reportarme: nombre del paquete, versión que vas a instalar, URL de docs consultadas

Fuentes oficiales primarias para este proyecto (verifica la URL actual antes de visitar — pueden haber cambiado):

- Next.js: `nextjs.org` (docs y blog de releases)
- Supabase: `supabase.com/docs` — específicamente `supabase.com/docs/guides/database/extensions/pgvector` y `supabase.com/docs/guides/ai/vector-columns`
- Auth0 Next.js SDK: `github.com/auth0/nextjs-auth0` (releases) y `auth0.com/docs/quickstart/webapp/nextjs`
- Anthropic SDK TypeScript: `github.com/anthropics/anthropic-sdk-typescript` y `platform.claude.com/docs/en/api/sdks/typescript`
- Voyage AI: `docs.voyageai.com/docs/embeddings` y `platform.claude.com/docs/en/build-with-claude/embeddings`

**Atajo importante para Auth0:** Auth0 publica "agent skills" para integradores como tú. Verifica si están disponibles ejecutando `npx skills add auth0/agent-skills --skill auth0-quickstart --skill auth0-nextjs` antes de hacer la integración manual. Si están disponibles, úsalas — automatizan la creación de la app en Auth0, las env vars y las rutas.

Si en cualquier momento no encuentras docs oficiales actualizadas o tienes dudas sobre cuál es el patrón correcto, **detente y pregúntame** antes de inventar.

## Variables de entorno que voy a proporcionarte

Te las pediré tan pronto identifiques cómo se llaman exactamente según las docs actuales. No las hardcodees.

- Auth0: dominio, client ID, client secret, secret de cookies, app base URL
- Supabase: URL del proyecto, anon key, service role key, database URL directa
- Anthropic: API key
- Voyage AI: API key

## Entregables específicos de Fase 0

Según la sección "Roadmap por fases > Fase 0 · Fundaciones" del documento adjunto:

1. **Setup inicial del proyecto Next.js** con TypeScript, App Router, Tailwind, ESLint, src/, Turbopack. Usar `create-next-app` con la versión más reciente verificada.

2. **Estructura de carpetas que refleje los 5 sectores** del documento:
   ```
   src/
     app/                  # rutas y páginas
     sectors/
       a-tracking/         # Sector A: captura de eventos
       b-catalog/          # Sector B: catálogo + co-ocurrencia + mock
       c-search/           # Sector C: búsqueda híbrida
       d-personalization/  # Sector D: motor de personalización
       e-admin/            # Sector E: admin
     lib/
       db/                 # cliente Supabase
       auth/               # cliente Auth0
       llm/                # cliente Anthropic
       embeddings/         # cliente Voyage
     types/                # tipos compartidos
   ```

3. **Conexión a Supabase con pgvector habilitado.** Verificar mediante una query simple que la extensión `vector` está activa.

4. **Modelo de datos completo en Supabase** — todas las tablas listadas en la sección "Modelo de datos" del documento. Crear como migraciones SQL versionadas en `supabase/migrations/`. Esto incluye:
   - Core: `users`, `anonymous_sessions`, `recipients`, `products` (con columna `embedding vector(d)` y `tsvector`), `events`
   - Personalización: `user_profiles`, `user_profile_modes`, `session_vectors`, `cohort_centroids`, `excluded_products`
   - Catálogo y búsqueda: `co_occurrence`, `co_occurrence_top`, `searches`, `product_query_cache`, `mock_calls`
   - Órdenes: `orders`, `order_items`
   - Eval: `eval_holdout`
   
   Para el tamaño del vector (`d`), preguntar a Voyage AI docs cuál es la dimensión por defecto del modelo elegido (probablemente `voyage-3.5` o el que sea actual). No asumas 1536 — es de OpenAI, no de Voyage.

5. **Auth0 funcionando end-to-end.** Login, logout, ruta protegida, sesión accesible desde el server. Si los agent skills de Auth0 están disponibles, úsalos.

6. **Mock funcional de la API agregadora** — sección 12 del documento. Fixture de 500 productos diversos generados localmente o con LLM al inicio. Distribución de categorías según el documento. Latencia simulada 2-4s con jitter, errores ~2%, contador de costo simulado, devolución de 25 productos por petición.

## Criterio de aceptación de Fase 0

Antes de marcar Fase 0 como completa, verificar que se cumple TODO esto:

- [ ] BD vacía pero con todas las tablas creadas (verificable con `supabase db diff` o equivalente)
- [ ] Extensión `vector` activa en Supabase
- [ ] Login con Auth0 funciona en localhost
- [ ] Mock devuelve 25 productos cuando se le invoca con una categoría
- [ ] Fixture de 500 productos diversos accesible
- [ ] Cliente de Anthropic SDK puede hacer una request básica (verificable con un endpoint de prueba)
- [ ] Cliente de Voyage AI puede generar un embedding básico (verificable con un endpoint de prueba)
- [ ] Estructura de carpetas creada según lo especificado
- [ ] README con instrucciones para correr el proyecto en local + variables de entorno necesarias

## Reglas de trabajo durante la sesión

1. **Antes de instalar cualquier paquete:** verifica versión actual y reporta.
2. **Antes de escribir código contra una API:** lee la doc oficial actual y reporta el patrón vigente.
3. **No avances a Fase 1** aunque te quede tiempo. Cierra Fase 0 con todos los criterios cumplidos.
4. **Si encuentras inconsistencias o dudas en el documento adjunto**, márcalas explícitamente y pregúntame antes de decidir.
5. **Si una librería que el documento sugiere ya no existe o cambió de nombre**, reportarlo y proponer alternativa con justificación.
6. **Commits frecuentes con mensajes claros**, agrupados por hito (setup inicial, BD, auth, mock, etc.).
7. **No mockes lo que no debe ser mock.** Solo la API agregadora es mock — Auth0, Supabase, Anthropic SDK y Voyage AI son reales desde el día 1.

## Primer paso

1. Confirma que recibiste y leíste el documento adjunto.
2. Resúmeme en 5 bullets los entregables de Fase 0 tal como tú los entiendes.
3. Antes de empezar a instalar nada, ejecuta las verificaciones de versión y reporta:
   - Next.js: versión estable más reciente
   - Supabase pgvector: cómo se habilita actualmente
   - Auth0 nextjs-auth0: versión más reciente y si los agent skills funcionan
   - Anthropic SDK TypeScript: versión más reciente
   - Voyage AI: modelo recomendado actualmente y dimensión de su vector
4. Espera mi confirmación para arrancar.