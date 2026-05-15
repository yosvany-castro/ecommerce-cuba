# Prompt para Claude Code Web — Fases 1, 2 y 3 con triple revisión anti-falsify

> **Cómo usar este prompt:**
> 1. Iniciar sesión nueva en `claude.ai/code` con el repositorio del proyecto.
> 2. Adjuntar como contexto el documento `MVP_Ecommerce_Personalizado_v1_2.md`.
> 3. Pegar este prompt completo como primer mensaje al agente.
> 4. **No saltar el pre-flight check.** Si Fase 0 está rota, esto se construye sobre arena.

---

## Contexto

Estás retomando un proyecto de e-commerce con personalización vectorial multi-modo. La Fase 0 (Fundaciones) supuestamente fue completada en una sesión anterior. Tu trabajo en esta sesión es:

1. Verificar el estado real de Fase 0 antes de tocar nada (no confíes en lo reportado).
2. Ejecutar Fase 1 (E-commerce básico + tracking).
3. Ejecutar Fase 2 (Búsqueda híbrida).
4. Ejecutar Fase 3 completa, subdividida en 3a, 3b, 3c (Personalización).

El documento maestro adjunto es la fuente de verdad del diseño. Lee la sección "Roadmap por fases" para los criterios de aceptación oficiales de cada fase. Este prompt los amplía con un régimen estricto de testing y revisión cruzada.

**Esto va a tomar tiempo y consumo significativo de tokens.** El usuario tiene plan Max. Si en algún punto detectas que estás cerca de un límite o que una fase no se puede cerrar correctamente en una sola sesión, **detente y reporta** — no falsifiques cierre solo para llegar al final.

---

## SECCIÓN A — Pre-flight check de Fase 0

Antes de escribir una sola línea de Fase 1, verificar que Fase 0 está realmente cerrada. La sesión anterior puede haber declarado "completada" cosas que no funcionan.

### Pasos del pre-flight (en orden)

1. **Lee `git log --oneline -50`** y reporta los commits encontrados. Identifica los hitos de Fase 0.

2. **Inspecciona la estructura de carpetas:** `ls -la src/sectors/` debe mostrar las 5 carpetas (`a-tracking`, `b-catalog`, `c-search`, `d-personalization`, `e-admin`). Si falta alguna, reportar.

3. **Lee `package.json`** y reporta:
   - Nombre y versión del proyecto
   - Dependencias instaladas con sus versiones reales
   - Scripts disponibles
   
4. **Verifica conexión a Supabase:**
   - Lee la configuración (`.env.local`, `lib/db/`, `supabase/config.toml` si existe)
   - Ejecuta una query de test: `SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';`
   - Si la extensión vector no está activa, **detente y reporta**.

5. **Verifica el modelo de datos completo en Supabase:**
   - Listar todas las tablas: `SELECT tablename FROM pg_tables WHERE schemaname = 'public';`
   - Comparar contra la lista en el documento maestro, sección "Modelo de datos". Toda tabla faltante = Fase 0 incompleta.
   - Para `products`, verificar que existe la columna `embedding` con tipo `vector(N)` y la columna `tsvector`. Reportar el valor de N.

6. **Verifica Auth0:**
   - Las env vars `AUTH0_*` están presentes (sin imprimir los valores).
   - Existe un cliente Auth0 instanciado en `lib/auth/`.
   - Las rutas `/auth/login`, `/auth/logout`, `/auth/callback` están alcanzables (puedes hacer un curl o leer las rutas del App Router).
   - **Hacer un test E2E real con Playwright** (instalar si no está): visitar `/auth/login`, llegar a la página de Auth0 universal, completar credenciales de test (preguntar al usuario si necesitas crearle un usuario de test en Auth0), volver a la app autenticado, verificar que `getSession()` devuelve datos.

7. **Verifica el mock de la API agregadora:**
   - Existe en `src/sectors/b-catalog/mock/` o similar.
   - Llamarlo con una categoría y verificar:
     - Devuelve **exactamente 25 productos** por petición (ni 5 ni 100, esto es spec)
     - Latencia es entre 2 y 4 segundos con jitter (ejecutarlo 5 veces y reportar el rango)
     - Tiene un contador de costo simulado que se incrementa
     - Tiene una probabilidad de error configurable (~2%)
     - Los productos tienen título, descripción, imagen URL, precio, marca, categoría cruda, atributos, fuente simulada (Amazon/AliExpress/Shein)
   - **Verifica que existen 500 productos seed** en el fixture, distribuidos según el documento (40% ropa, 20% electrónica, etc.).

8. **Verifica clientes de Anthropic SDK y Voyage AI:**
   - Hacer una llamada de test al Claude API: `messages.create` con un prompt corto. Reportar respuesta (sin contenido sensible).
   - Hacer una llamada de test a Voyage: generar embedding de "hola mundo". Reportar dimensión del vector resultante.
   - **Ese valor de dimensión debe coincidir con el N de la columna `vector(N)` en la tabla `products`**. Si no coincide, hay un bug crítico que arreglar antes de Fase 1.

9. **Reporta el estado completo al usuario** en formato:
   ```
   PRE-FLIGHT REPORT — FASE 0
   
   ✅ items que pasaron
   ⚠️ items con observaciones
   ❌ items que fallan
   
   RECOMENDACIÓN: [proceder / arreglar items X, Y, Z primero]
   ```

10. **Esperar confirmación del usuario** antes de empezar Fase 1. Si hay items rotos en Fase 0, no proceder hasta arreglarlos.

---

## SECCIÓN B — Filosofía de testing (INVIOLABLE)

Esta es la sección más importante del prompt. Léela tres veces.

### Por qué los tests reales importan

Los modelos de lenguaje tienden a generar tests que pasan sin probar nada útil. El usuario explícitamente exige **cero tests falsos**. Un test que pasa pero no detecta bugs reales es **peor que no tener test**: da falsa confianza y obstaculiza refactors futuros.

La definición de "test válido" en este proyecto:

> **Un test es válido si y solo si: (a) falla cuando el código bajo prueba está roto, y (b) verifica un comportamiento observable definido en el documento maestro.**

Cualquier test que no cumpla estas dos condiciones debe ser borrado o reescrito. Sin excepciones.

### Anti-patterns prohibidos (lista negra)

Tienes prohibido escribir tests con cualquiera de estos patrones. Antes de declarar una fase cerrada, revisa cada test contra esta lista.

**1. Tautologías y assertions vacuas**
```typescript
// ❌ PROHIBIDO
expect(result).toBeDefined()  // weak: muchos bugs sobreviven
expect(result).not.toBeNull()  // weak
expect(true).toBe(true)  // ridículo
expect(arr.length).toBeGreaterThan(0)  // no valida contenido
```

**2. Tests que validan que el código existe, no que funciona**
```typescript
// ❌ PROHIBIDO
import { computeUserVector } from './personalization'
test('computeUserVector exists', () => {
  expect(typeof computeUserVector).toBe('function')
})
```

**3. Mocking circular (lo más común y peligroso)**
```typescript
// ❌ PROHIBIDO: mockear lo que estás probando
vi.mock('./computeRRF', () => ({ computeRRF: () => [productA, productB] }))
test('search returns RRF results', () => {
  const result = search('query')
  expect(result).toEqual([productA, productB])  // valida el mock, no el código
})

// ❌ PROHIBIDO: mockear toda la BD para que retorne lo esperado
vi.mock('./db', () => ({
  query: () => [{ id: 1, similarity: 0.95 }]
}))
// El test no prueba que el SQL es correcto, solo que el código procesa el mock
```

**4. Snapshots sin validación**
```typescript
// ❌ PROHIBIDO sin justificación
expect(result).toMatchSnapshot()  // primer run pasa siempre, después también
```

**5. Tests con sólo `expect.anything()` o `expect.any()`**
```typescript
// ❌ PROHIBIDO
expect(result).toEqual(expect.objectContaining({}))  // matchea cualquier objeto
expect(payload).toEqual({
  product_id: expect.anything(),  // si el id es null, también matchea
  user_id: expect.any(String)  // si es ""también matchea
})
```

**6. Tests con `it.skip`, `xit`, `describe.only` ocultos**

Antes de cerrar una fase, ejecuta:
```bash
grep -rn "\.skip\|xit\|\.only\|todo" src/ tests/
```
y reporta. Los tests skipped no cuentan. Cero excepciones.

**7. Tests que sólo prueban happy path**

Cada función crítica necesita al menos:
- 1 test de happy path
- 1 test de input vacío / null / undefined
- 1 test de input inválido (con expectativa de error)
- 1 test de edge case (valores extremos, límites)

**8. Tests que dependen de orden de ejecución**

Cada test debe ser ejecutable en aislamiento. Verificar:
```bash
npx vitest run --testNamePattern="<nombre del test>"
```
Si falla en aislamiento pero pasa en suite, hay dependencia oculta.

**9. Tests que validan implementación en lugar de comportamiento**
```typescript
// ❌ PROHIBIDO
expect(spyFn).toHaveBeenCalledWith(...)  // refactor lo rompe sin razón
expect(internalState).toEqual(...)  // acopla a implementación

// ✅ VÁLIDO
const result = await myFunction(input)
expect(result).toEqual(expectedOutput)
// O para side effects:
const dbState = await db.query(...)
expect(dbState).toEqual(expectedState)
```

**10. Tests con timeouts ridículos para evitar flaky**
```typescript
// ❌ PROHIBIDO ocultar race conditions con timeouts
await sleep(5000)  // si necesitas esto, hay un bug de timing real
```

**11. Tests duplicados / redundantes**

Si dos tests prueban exactamente lo mismo con datos diferentes, fusionarlos con `test.each()`. Los tests redundantes inflan el conteo sin agregar cobertura.

### Patterns válidos con ejemplos del dominio

**Test de comportamiento E2E con BD real:**
```typescript
// ✅ VÁLIDO — usa BD de test real, ejercita el flujo completo
test('product_view event is persisted with correct payload after navigation', async () => {
  const seedProduct = await seedProductInTestDb({ category: 'electronica' })
  
  // Real navigation with Playwright
  const { anonymousId } = await visitAsAnonymous(`/products/${seedProduct.id}`)
  
  // Wait for the async event tracking to complete
  await waitFor(async () => {
    const events = await testDb.query(
      'SELECT * FROM events WHERE anonymous_id = $1 AND event_type = $2',
      [anonymousId, 'product_view']
    )
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({
      product_id: seedProduct.id,
      source: expect.stringMatching(/^(home|category|search|direct)$/)
    })
    expect(events[0].occurred_at).toBeInstanceOf(Date)
  }, { timeout: 2000 })
})
```

**Test de propiedad matemática:**
```typescript
// ✅ VÁLIDO — verifica invariantes
import fc from 'fast-check'

test('vector normalization always produces unit vectors', () => {
  fc.assert(
    fc.property(
      fc.array(fc.float({ min: -100, max: 100, noNaN: true }), { minLength: 10, maxLength: 1024 }),
      (rawVector) => {
        if (rawVector.every(x => x === 0)) return true  // skip zero vector
        const normalized = normalize(rawVector)
        const norm = Math.sqrt(normalized.reduce((sum, x) => sum + x * x, 0))
        expect(Math.abs(norm - 1)).toBeLessThan(1e-9)
      }
    )
  )
})
```

**Test de comportamiento del motor de personalización:**
```typescript
// ✅ VÁLIDO — usuarios sintéticos con comportamientos contrastados,
// valida diversidad y coherencia en el output
test('users with distinct behavior get distinct feeds', async () => {
  const userA = await createSyntheticUserWithEvents([
    { type: 'product_view', category: 'ropa_mujer', count: 8 },
    { type: 'add_to_cart', category: 'ropa_mujer', count: 2 }
  ])
  const userB = await createSyntheticUserWithEvents([
    { type: 'product_view', category: 'electronica', count: 8 },
    { type: 'add_to_cart', category: 'electronica', count: 2 }
  ])
  
  const feedA = await generateFeed(userA.id, { limit: 20 })
  const feedB = await generateFeed(userB.id, { limit: 20 })
  
  // Diversity: feeds should differ significantly
  const overlap = intersection(feedA.map(p => p.id), feedB.map(p => p.id))
  expect(overlap.length / 20).toBeLessThan(0.3)
  
  // Coherence: each feed should reflect its user's interests
  const ropaInA = feedA.filter(p => p.metadata.category === 'ropa_mujer').length
  const electroInB = feedB.filter(p => p.metadata.category === 'electronica').length
  expect(ropaInA / 20).toBeGreaterThan(0.5)
  expect(electroInB / 20).toBeGreaterThan(0.5)
})
```

### Mutation testing manual (OBLIGATORIO)

Para cada test crítico que escribas, antes de marcarlo como verde:

1. Ejecuta el test → debe pasar
2. **Introduce intencionalmente un bug** en el código que prueba (cambia un `>` por `<`, retorna `null`, comenta una línea crítica, devuelve un array vacío)
3. Ejecuta el test de nuevo → **debe fallar**
4. Si el test sigue pasando con el código roto → **el test no sirve, reescríbelo**
5. Restaura el código, verifica que el test vuelve a pasar
6. Documenta en el commit message: "verified mutation: changed X to Y, test failed as expected"

Aplica esto al menos para:
- Cálculo de vector de usuario (Sector D)
- Cálculo de RRF (Sector D)
- NPMI del grafo de co-ocurrencia (Sector B)
- Búsqueda híbrida BM25+cosine (Sector C)
- Tracking de eventos críticos (Sector A)
- Cualquier función matemática del documento

No es necesario para tests triviales (CRUD básico, validación de inputs), pero sí para todo lo que toca lógica del motor.

---

## SECCIÓN C — Sistema de triple revisión

Antes de declarar una fase cerrada, lanzar 3 subagentes con roles definidos. Sus reportes literales (no resúmenes tuyos) deben acompañar el cierre de cada fase.

### Cómo invocar subagentes

Usa la **Task tool** disponible en Claude Code. Cada subagente recibe un prompt específico, opera en su propia ventana de contexto sin sesgo del trabajo previo, y reporta hallazgos. Si la Task tool no está disponible en tu entorno, simula el flujo: olvida deliberadamente todo lo que escribiste, asume el rol, y revisa con ojos frescos. Pero la Task tool real es muy preferible.

### Agente 1 — El Adversario

**Prompt para el subagente:**

> Eres un revisor adversarial de tests. Tu único objetivo es encontrar tests que NO atrapen bugs reales. Recibirás una lista de tests y los archivos de código que prueban. Para cada test:
> 
> 1. Lee el test y el código bajo prueba.
> 2. Imagina 3 mutaciones plausibles del código (cambios que un programador real podría hacer mal).
> 3. Para cada mutación, evalúa: ¿este test fallaría con esta mutación?
> 4. Si la respuesta es "no" para al menos una mutación plausible, marca el test como **DÉBIL**.
> 5. Marca también como **DÉBIL** cualquier test que use los anti-patterns conocidos: tautologías, mocking circular, snapshots sin contenido validado, `expect.anything()` con objeto vacío, dependencia de orden, etc.
> 
> Reporta:
> - Lista de tests débiles con la ubicación del archivo y línea
> - Para cada test débil: la mutación específica que no detectaría
> - Recomendación de cómo reescribirlo
> 
> No tienes piedad. Tu trabajo es encontrar tests basura.

**Cuándo invocarlo:** después de escribir todos los tests de la fase, antes de declararla cerrada.

### Agente 2 — El Auditor de Mocks

**Prompt para el subagente:**

> Eres un auditor de mocks. Tu trabajo es revisar cada `vi.mock`, `jest.mock`, `vi.spyOn`, mock manual o stub en el proyecto y validar su justificación.
> 
> El proyecto tiene UN SOLO mock permitido por diseño: la API agregadora de productos (en `src/sectors/b-catalog/mock/`). Cualquier otro mock requiere justificación escrita.
> 
> Para cada mock encontrado fuera del mock oficial:
> 
> 1. Identifica qué se está mockeando.
> 2. Pregunta: ¿qué se está probando realmente con este mock? ¿Lógica del sistema o solo aritmética del propio mock?
> 3. Marca como **INJUSTIFICADO** todo mock que:
>    - Mockea la BD de Supabase (debe usar BD de test real)
>    - Mockea el cliente de Anthropic SDK (debe usar API real, posiblemente con cassettes/recordings tipo VCR)
>    - Mockea el cliente de Voyage AI (igual)
>    - Mockea Auth0 client (puede mockear sólo en unit tests muy específicos, con justificación)
>    - Mockea funciones del propio módulo bajo prueba (siempre injustificado)
> 4. Marca como **JUSTIFICADO** mocks que:
>    - Aíslan tiempo (`vi.useFakeTimers()` para probar TTL, decay, expiración)
>    - Evitan side effects externos no deterministas (envío de emails reales, etc., aunque en este proyecto no hay)
> 
> Reporta:
> - Lista total de mocks (con archivo y línea)
> - Para cada uno: justificado o injustificado, y por qué
> - Recomendación de cómo eliminar los injustificados (qué reemplazar por integración real)

**Cuándo invocarlo:** después del Agente 1, sobre el conjunto de tests revisado.

### Agente 3 — El Probador de Comportamiento

**Prompt para el subagente:**

> Eres un probador externo. NO tienes acceso al código de producción ni a los tests existentes — sólo al documento de especificación adjunto (`MVP_Ecommerce_Personalizado_v1_2.md`) y al sistema corriendo localmente.
> 
> Tu trabajo es validar que el sistema cumple la especificación, sin mirar cómo está implementado.
> 
> Pasos:
> 
> 1. Lee la sección del documento correspondiente a la fase que se acaba de cerrar (Fase 1, 2, 3a, 3b, 3c — el agente principal te dirá cuál).
> 2. Identifica los comportamientos observables que el documento promete. Por ejemplo, para Fase 1: "anonymous_id se persiste en cookie", "eventos se registran en BD con timestamp", "el cron trae productos del mock con embeddings calculados", etc.
> 3. Para cada comportamiento, diseña tu propio caso de prueba ad-hoc:
>    - Define el setup (datos a sembrar, estado inicial)
>    - Define la acción (request HTTP, navegación, llamada al cron, etc.)
>    - Define el resultado esperado en términos del documento
> 4. Ejecuta cada caso contra el sistema corriendo (puedes usar curl, Playwright, queries SQL directas, etc.).
> 5. Reporta cada caso como **PASA**, **FALLA**, o **NO VERIFICABLE** (con explicación).
> 
> Reporta:
> - Lista de comportamientos esperados según el documento
> - Resultado de cada caso de prueba
> - Discrepancias entre lo que el documento promete y lo que el sistema hace
> - Comportamientos del documento que no pudiste verificar y por qué

**Cuándo invocarlo:** último, después de los otros dos.

### Compuerta de avance

Una fase NO se cierra hasta que:
- Agente 1 reporta cero tests débiles (o todos los reportados como débiles han sido reescritos y re-revisados)
- Agente 2 reporta cero mocks injustificados
- Agente 3 reporta todos los comportamientos verificables como **PASA**

Si alguno de los 3 reporta problemas críticos, arreglas y vuelves a invocar al revisor afectado. Iteras hasta que los 3 reporten limpio. Solo entonces avanzas a la siguiente fase.

### Reporte literal obligatorio

En tu mensaje al usuario al cerrar cada fase, incluye **el output literal de cada subagente**, no un resumen tuyo. Algo así:

```
=== AGENTE 1 (Adversario) — Output literal ===

[pegar exactamente lo que devolvió el subagente]

=== AGENTE 2 (Auditor de Mocks) — Output literal ===

[pegar exactamente]

=== AGENTE 3 (Probador de Comportamiento) — Output literal ===

[pegar exactamente]

=== Resumen y decisión ===

[tu interpretación, pero después de los outputs literales]
```

Si los reportas como resumen tuyo, el usuario no puede verificar que efectivamente los lanzaste.

---

## SECCIÓN D — Reglas inviolables del proyecto

1. **Verificación de versiones obligatoria.** Antes de instalar cualquier paquete nuevo o usar una API externa, web search la versión y docs actuales. Tu memoria está desactualizada. Esta regla viene heredada de Fase 0 y sigue vigente.

2. **Cero falsify de tests.** Definida en la Sección B. No negociable.

3. **Triple revisión obligatoria al cerrar cada fase.** Sección C.

4. **No avanzar a la siguiente fase sin haber cerrado la anterior con criterios cumplidos.** Si Fase 1 no cierra, no empiezas Fase 2.

5. **Si tienes una duda real sobre el documento o el diseño, pregunta al usuario.** No inventes interpretaciones. Mejor 5 minutos de pausa que 5 horas en dirección equivocada.

6. **Commits frecuentes con mensajes claros.** Idealmente uno por feature pequeño, con mensaje que indique:
   - Qué se construyó
   - Tests que cubren
   - Cualquier mutation testing realizado y su resultado

7. **Reporta uso de plan periódicamente.** Si percibes que estás cerca de un límite de tokens o tiempo, **detente y reporta** antes de cortar a la mitad un trabajo. El usuario tiene plan Max pero no es infinito.

8. **No mockes lo que no debe ser mock.** Solo la API agregadora es mock por diseño. Auth0, Supabase, Anthropic SDK y Voyage AI son siempre reales.

9. **Si una librería que el documento sugiere ya no existe o cambió radicalmente**, reportar y proponer alternativa con justificación.

10. **No declares "completado" lo que no funciona.** Si un test es flaky y "casi pasa", no es verde. Si un comportamiento "casi se cumple", no se cumple.

---

## SECCIÓN E — Fase 1: E-commerce básico + tracking

### Entregables específicos

Según el documento, sección "Roadmap > Fase 1":

1. **Home con grid de productos** ordenados por fecha de carga (sin personalización todavía)
2. **Página de detalle de producto** con todos los datos persistidos
3. **Búsqueda por texto plano** (LIKE en título y descripción) — la versión simple, antes del LLM
4. **Carrito y checkout simulado** — estado de la orden cambia, sin pago real
5. **Tracking completo de eventos** desde la primera visita:
   - `anonymous_id` en cookie persistente (1 año de TTL)
   - `session_id` con timeout de 30 min de inactividad
   - Eventos a capturar: `product_view`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `purchase`, `search`, `product_dwell` (>30s), `category_click`, `filter_applied`, `page_view`, `session_start`, `session_end`
   - Schema fijo de payload por `event_type`
   - Fusión de identidades: cuando el usuario anónimo se registra, todos sus eventos se asocian al `user_id`
6. **Cron que llama al mock periódicamente** (cada N minutos en dev, ejecutable manualmente para tests)
7. **Pipeline de enriquecimiento** completo para cada producto que llega del mock:
   - LLM normaliza categoría → JSON estructurado con metadata
   - Embedding generado vía Voyage AI y guardado en columna `embedding`
   - `tsvector` generado para BM25
   - Deduplicación por `source + source_product_id`
   - `last_refreshed_at` actualizado

### Tests obligatorios — ejemplos concretos

**Tracking de eventos:**

```typescript
test('anonymous_id is generated on first visit and persists', async () => {
  const { browser, anonymousId } = await visitFreshAsAnonymous('/')
  expect(anonymousId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)  // UUID format
  
  await browser.goto('/products')
  const cookieAfter = await browser.cookies.get('anonymous_id')
  expect(cookieAfter.value).toBe(anonymousId)  // same id
  
  // After 1 year the cookie should still be alive
  expect(cookieAfter.expires).toBeGreaterThan(Date.now() / 1000 + 364 * 86400)
})

test('product_view event has all required fields', async () => {
  const product = await seedProduct()
  const { anonymousId } = await visitAsAnonymous(`/products/${product.id}`)
  
  await waitFor(async () => {
    const events = await testDb.queryAsArray(
      `SELECT * FROM events WHERE anonymous_id = $1 AND event_type = 'product_view'`,
      [anonymousId]
    )
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e).toMatchObject({
      anonymous_id: anonymousId,
      user_id: null,
      session_id: expect.stringMatching(/^[0-9a-f-]+$/),
      event_type: 'product_view',
      occurred_at: expect.any(Date),
      payload: {
        product_id: product.id,
        source: expect.stringMatching(/^(home|category|search|direct)$/)
      }
    })
  })
})

test('identity merge: anonymous events become associated to user_id on signup', async () => {
  const { anonymousId, browser } = await visitFreshAsAnonymous('/')
  const product = await seedProduct()
  await browser.goto(`/products/${product.id}`)
  
  // Verify event is anonymous
  let events = await testDb.queryAsArray(
    'SELECT * FROM events WHERE anonymous_id = $1', [anonymousId]
  )
  expect(events.every(e => e.user_id === null)).toBe(true)
  
  // Sign up
  const userId = await signUpFlow(browser, { email: 'test@example.com' })
  
  // After merge, events should have user_id
  events = await testDb.queryAsArray(
    'SELECT * FROM events WHERE anonymous_id = $1', [anonymousId]
  )
  expect(events.length).toBeGreaterThan(0)
  expect(events.every(e => e.user_id === userId)).toBe(true)
})
```

**Pipeline de enriquecimiento:**

```typescript
test('product from mock is enriched and persisted with embedding and tsvector', async () => {
  const productFromMock = await mockApi.fetch({ category: 'electronica', limit: 1 })
  
  await catalogPipeline.process(productFromMock[0])
  
  const stored = await testDb.queryOne(
    'SELECT * FROM products WHERE source_product_id = $1',
    [productFromMock[0].id]
  )
  
  // Metadata enriched by LLM
  expect(stored.metadata).toMatchObject({
    category: expect.any(String),
    style: expect.any(Array)
  })
  expect(stored.metadata.category).not.toBe(productFromMock[0].category)  // normalized, not raw
  
  // Embedding present and correct dimension
  expect(stored.embedding).toBeInstanceOf(Float32Array)  // or Array depending on driver
  expect(stored.embedding.length).toBe(VOYAGE_EMBEDDING_DIM)  // dim del modelo Voyage en uso
  
  // Embedding is normalized to unit norm
  const norm = Math.sqrt(stored.embedding.reduce((s, x) => s + x * x, 0))
  expect(Math.abs(norm - 1)).toBeLessThan(1e-6)
  
  // tsvector populated
  expect(stored.tsvector).toBeTruthy()
  expect(stored.tsvector.length).toBeGreaterThan(0)
})

test('cron run fills empty catalog with 25 products per call from mock', async () => {
  await testDb.query('TRUNCATE products CASCADE')
  
  const initialCallCount = await mockApi.getCallCount()
  await runCron({ categories: ['electronica'], maxCalls: 1 })
  const finalCallCount = await mockApi.getCallCount()
  
  expect(finalCallCount - initialCallCount).toBe(1)
  
  const persisted = await testDb.queryAsArray('SELECT id FROM products WHERE source = $1', ['mock'])
  expect(persisted.length).toBe(25)  // exact: 25 per call, all persisted
})
```

### Criterio de aceptación de Fase 1

Antes de invocar la triple revisión, verificar:

- [ ] Una persona puede entrar al sitio anónima, ver productos, hacer click, agregar al carrito, simular compra
- [ ] Todos los eventos correspondientes quedan en la tabla `events` con `anonymous_id`, `session_id`, `event_type`, `occurred_at`, `payload` correcto según schema
- [ ] El cron, ejecutándose, trae productos del mock y los persiste con embedding (norma unitaria, dimensión correcta) y `tsvector`
- [ ] La tienda muestra los productos traídos por el cron en el home y en detalle
- [ ] Búsqueda LIKE funciona y devuelve resultados consistentes
- [ ] Auth0 login funciona; al registrarse, los eventos previos del `anonymous_id` se asocian al `user_id` (verificable con query SQL)
- [ ] Mutation testing aplicado a las funciones críticas: tracking, pipeline de enriquecimiento, cron
- [ ] Todos los tests pasan ejecutados aislados (`npx vitest run --no-parallel`) y en suite

### Triple revisión Fase 1

Lanzar Agente 1 (Adversario), Agente 2 (Auditor), Agente 3 (Probador) según Sección C. Iterar hasta limpio.

---

## SECCIÓN F — Fase 2: Búsqueda híbrida

### Entregables específicos

1. **LLM normaliza queries** a JSON estructurado con prompt versionado:
   ```json
   {
     "intent": "regalo",
     "recipient_gender": "niña",
     "recipient_age_min": 7,
     "recipient_age_max": 9,
     "categories": ["juguetes"],
     "style": ["bonito"],
     "price_range": "bajo",
     "search_terms": "juguete niña 8 años regalo",
     "confidence": 0.9
   }
   ```
   Verificar el formato exacto en la sección 9 del documento.

2. **Cache de queries con hash exacto** (lowercase, sin acentos, palabras ordenadas alfabéticamente, hash). Verifica que dos queries equivalentes colisionan.

3. **Cache semántico con θ inicial** (documentar que está pendiente la calibración empírica de Fase 5).

4. **Búsqueda híbrida BM25 + cosine en paralelo:**
   - BM25 sobre `tsvector` con los `search_terms`
   - Cosine sobre `embedding` con el embedding del query
   - Ambas devuelven sus rankings independientes

5. **Fusión por RRF** con `k_0 = 60`:
   ```
   RRF(p) = 1/(60 + rank_BM25(p)) + 1/(60 + rank_cosine(p))
   ```

6. **Llamada al mock cuando hits locales < umbral** Y `confidence > 0.5`. Si `confidence < 0.5`, no llamar (query basura).

7. **Skeleton honesto durante la espera** de 2-4s al mock.

8. **Vista de búsquedas en admin** con: texto crudo, JSON normalizado, método (`bm25_only` / `cosine_only` / `hybrid_rrf`), número de resultados, hit/miss, eventual click.

### Tests obligatorios — ejemplos

```typescript
test('LLM normalizes "regalo para mi sobrina de 8 años" correctly', async () => {
  const result = await searchNormalizer.normalize('regalo para mi sobrina de 8 años')
  expect(result).toMatchObject({
    intent: 'regalo',
    recipient_gender: 'niña',
    recipient_age_min: expect.any(Number),
    recipient_age_max: expect.any(Number),
    categories: expect.arrayContaining([expect.any(String)]),
    confidence: expect.any(Number)
  })
  expect(result.recipient_age_min).toBeGreaterThanOrEqual(6)
  expect(result.recipient_age_max).toBeLessThanOrEqual(10)
  expect(result.confidence).toBeGreaterThan(0.5)
})

test('exact cache: same query twice does not invoke LLM second time', async () => {
  const llmSpy = vi.spyOn(anthropicClient.messages, 'create')
  
  const q = 'audifonos bluetooth baratos'
  await searchNormalizer.normalize(q)
  await searchNormalizer.normalize(q)
  
  expect(llmSpy).toHaveBeenCalledTimes(1)
})

test('order-invariant cache: word permutations hit the same cache entry', async () => {
  const llmSpy = vi.spyOn(anthropicClient.messages, 'create')
  
  await searchNormalizer.normalize('regalo niña 8 años')
  await searchNormalizer.normalize('niña 8 años regalo')
  await searchNormalizer.normalize('8 años niña regalo')
  
  expect(llmSpy).toHaveBeenCalledTimes(1)
})

test('low confidence query does NOT invoke mock', async () => {
  const mockSpy = vi.spyOn(mockApi, 'fetch')
  
  await search('asdfgh qwerty')  // garbage query → low confidence
  
  expect(mockSpy).not.toHaveBeenCalled()
})

test('BM25 ranks literal queries above semantic neighbors', async () => {
  // Seed: producto exacto 'Nike Air Max 270 talle 42' + productos de zapatillas semánticamente similares
  const targetProduct = await seedProduct({ title: 'Nike Air Max 270 talle 42' })
  await seedProduct({ title: 'Adidas Ultraboost talle 42' })
  await seedProduct({ title: 'Puma RS-X talle 42' })
  
  const results = await search('Nike Air Max 270 talle 42')
  expect(results[0].id).toBe(targetProduct.id)  // BM25 should put exact match first
})

test('cosine catches semantic queries that BM25 misses', async () => {
  const target = await seedProduct({ title: 'Auriculares inalámbricos Sony', description: 'tecnología noise-cancelling' })
  
  // Query con sinónimo: BM25 fallaría con "audifonos bluetooth" porque las palabras no aparecen
  const results = await search('audífonos bluetooth')
  expect(results.map(r => r.id)).toContain(target.id)
})

test('RRF fusion combines both rankings correctly', async () => {
  // Setup deliberado: producto X aparece bien en BM25 (rank 1), regular en cosine (rank 5)
  // Producto Y aparece regular en BM25 (rank 5), bien en cosine (rank 1)
  // RRF debe rankear ambos arriba de productos que solo aparecen en una lista
  // ...
  const results = await hybridSearch('query controlada')
  // Validar que el orden refleja la suma de rangos recíprocos
})
```

### Criterio de aceptación Fase 2

- [ ] Set de 30 queries reales (preguntar al usuario por su set, o generar 30 representativas y mostrárselas): hybrid search supera búsqueda LIKE plana en relevancia subjetiva en ≥70% de los casos
- [ ] Misma query dos veces: la segunda no gasta tokens (verificable por spy de LLM client en test)
- [ ] Query basura ("asdfgh"): no se llama al mock
- [ ] Tres permutaciones de palabras de la misma query → mismo cache hit
- [ ] Admin muestra el JSON normalizado de cada búsqueda
- [ ] Mutation testing aplicado al RRF, al cálculo de cache hash, al threshold de confidence
- [ ] Todos los tests pasan en aislamiento

### Triple revisión Fase 2

Igual que Fase 1.

---

## SECCIÓN G — Fase 3: Personalización (3a, 3b, 3c)

Esta es la fase más compleja del proyecto. Está subdividida y cada subfase tiene su propia compuerta de cierre con triple revisión.

### Fase 3a — Personalización básica (vector único)

**Entregables:**

1. Cálculo del vector de perfil con pesos por evento (purchase=5, add_to_cart=3, etc.) y decay exponencial (`τ_perfil = 60 días`)
2. Vector de sesión separado (`τ_sesión = 30 min`) con `α` dinámico
3. Actualización incremental usando `vector_unnormalized` + `weight_sum`
4. Lista de exclusión con TTL (`excluded_products`)
5. Cold start con prior por cohorte y shrinkage bayesiano:
   ```
   u^(n+1) = N( (n/(n+κ)) · u^(n) + (κ/(n+κ)) · u^(0) + w_e · p_e )
   ```
6. Retrieval simple top-K cercanos al vector
7. Mezcla con popularidad por cohorte (sin RRF aún)
8. Vista del usuario en admin (eventos, vector resumido, feed actual)

**Tests obligatorios — ejemplos críticos:**

```typescript
test('user vector reflects events with correct weights', async () => {
  const user = await createUser()
  const productElectronica = await seedProduct({ category: 'electronica' })
  const productRopa = await seedProduct({ category: 'ropa_mujer' })
  
  await registerEvent({ user, type: 'purchase', product: productElectronica })  // peso 5
  await registerEvent({ user, type: 'product_view', product: productRopa })  // peso 1
  
  const vector = await getUserProfileVector(user.id)
  
  // El vector debe estar más cerca del vector de electronica que de ropa
  expect(cosine(vector, productElectronica.embedding))
    .toBeGreaterThan(cosine(vector, productRopa.embedding))
  
  // El vector debe ser unitario
  expect(Math.abs(norm(vector) - 1)).toBeLessThan(1e-6)
})

test('decay temporal reduces weight of old events', async () => {
  const user = await createUser()
  const product = await seedProduct({ category: 'electronica' })
  
  // Evento de hace 60 días
  await registerEventAtTime({ user, type: 'product_view', product, ago: '60 days' })
  const vectorOld = await computeUserProfileVector(user.id)
  
  // Mismo evento, hoy
  await testDb.query('TRUNCATE events CASCADE')
  await registerEventAtTime({ user, type: 'product_view', product, ago: '0 days' })
  const vectorRecent = await computeUserProfileVector(user.id)
  
  // El peso del evento de hoy debe ser ~e^1 ≈ 2.72 mayor que el de hace 60 días (τ=60)
  // Eso se refleja en el weight_sum
  const weightOld = await getUserProfileWeightSum(user.id)
  // ... validar matemática del decay
})

test('cold start: user with no events but onboarding gets coherent feed', async () => {
  const user = await createUserWithOnboarding({
    interestedCategories: ['ropa_mujer', 'belleza']
  })
  
  const feed = await generateFeed(user.id, { limit: 20 })
  
  // El feed debe sesgarse hacia las categorías declaradas
  const matchingCount = feed.filter(p => 
    ['ropa_mujer', 'belleza'].includes(p.metadata.category)
  ).length
  expect(matchingCount / 20).toBeGreaterThan(0.6)
})

test('excluded products with TTL do NOT appear in feed', async () => {
  const user = await createUserWithEventsInCategory('ropa_mujer', 10)
  const productToExclude = await seedProduct({ category: 'ropa_mujer' })
  
  // Producto debería aparecer en el feed normalmente
  let feed = await generateFeed(user.id, { limit: 50 })
  expect(feed.map(p => p.id)).toContain(productToExclude.id)
  
  // Excluir con TTL 14 días
  await excludeProduct({ userId: user.id, productId: productToExclude.id, ttlDays: 14 })
  
  feed = await generateFeed(user.id, { limit: 50 })
  expect(feed.map(p => p.id)).not.toContain(productToExclude.id)
  
  // Después del TTL (simular avance de tiempo), el producto vuelve
  await advanceTime({ days: 15 })
  feed = await generateFeed(user.id, { limit: 50 })
  expect(feed.map(p => p.id)).toContain(productToExclude.id)
})
```

**Criterio de aceptación 3a:**

- [ ] Vector de perfil se calcula correctamente desde eventos (mutation testing aplicado)
- [ ] Decay temporal verificable: evento de hace 60 días pesa ~37% del de hoy
- [ ] α dinámico: usuario con 10 eventos en sesión hace que sesión domine el ranking
- [ ] Cold start con onboarding produce feed coherente desde evento 1 (mejora medible vs random)
- [ ] Lista de exclusión con TTL funciona: producto excluido no aparece, vuelve después del TTL
- [ ] Retrieval top-K usando `pgvector` con norma unitaria es correcto
- [ ] Mezcla con popularidad por cohorte: usuario sin historial ve casi solo populares
- [ ] **Recall@10 medible** sobre un eval set sintético supera baseline (top-popular puro) en al menos +20%

**Triple revisión 3a.** No avanzar a 3b sin pasar.

---

### Fase 3b — Multi-vector + grafo de co-ocurrencia + RRF

**Entregables:**

1. **Multi-vector usuario:**
   - 0-4 eventos: 0 modos (solo prior)
   - 5-19: 1 vector
   - 20-99: 2 vectores (k-means con k=2 sobre embeddings de productos visitados, pesos `w·δ`)
   - ≥100: 3 vectores
   - Recálculo de clusters semanal en batch
   - Eventos nuevos durante la semana asignados al cluster más cercano + actualización incremental

2. **Grafo de co-ocurrencia con NPMI:**
   - Tabla `co_occurrence` con counts incrementales por par (a, b) con `a < b`
   - Pesos: co-purchase=5, co-cart=3, co-view=1
   - Ventana temporal: 30 minutos
   - Job nocturno calcula NPMI y persiste top-50 por producto en `co_occurrence_top`
   - Cold start del grafo: opcional sembrar con co-categoría débil

3. **Fuente B integrada al pipeline:** cuando hay último producto visto en sesión, agregar candidatos de `co_occurrence_top[lastViewed]`

4. **Fusión por RRF de las 3+ fuentes:**
   - Fuente A (semántica multi-modo): por cada modo, top-50 de pgvector
   - Fuente B (co-ocurrencia): top-30 por NPMI
   - Fuente C (popularidad por cohorte): top-20 por score logarítmico
   - RRF con `k_0 = 60`

5. **Vistas de admin:**
   - Modos del usuario (cuántos clusters, qué categorías domina cada uno)
   - NPMI top (verificación de calidad del grafo)

**Tests obligatorios — ejemplos:**

```typescript
test('user with 2 distinct interest clusters gets 2 vectors', async () => {
  const user = await createUser()
  // 30 eventos: 15 en electronica, 15 en ropa_mujer (clusters ortogonales)
  await seedEvents(user.id, [
    ...Array(15).fill({ type: 'product_view', category: 'electronica' }),
    ...Array(15).fill({ type: 'product_view', category: 'ropa_mujer' })
  ])
  
  await runWeeklyClusterRecompute()
  
  const modes = await getUserModes(user.id)
  expect(modes).toHaveLength(2)
  
  // Cada modo debe estar cerca de su cluster correspondiente
  const electroProduct = await getSampleProduct({ category: 'electronica' })
  const ropaProduct = await getSampleProduct({ category: 'ropa_mujer' })
  
  const closestModeToElectro = modes.reduce((best, m) => 
    cosine(m.vector, electroProduct.embedding) > cosine(best.vector, electroProduct.embedding) ? m : best
  )
  const closestModeToRopa = modes.reduce((best, m) => 
    cosine(m.vector, ropaProduct.embedding) > cosine(best.vector, ropaProduct.embedding) ? m : best
  )
  expect(closestModeToElectro.id).not.toBe(closestModeToRopa.id)  // distintos modos
})

test('NPMI captures cross-sell relationships ignored by cosine', async () => {
  // Sembramos eventos sintéticos donde iPhone y funda iPhone co-ocurren
  const iphone = await seedProduct({ title: 'iPhone 15 Pro' })
  const funda = await seedProduct({ title: 'Funda silicona compatible iPhone 15' })
  
  // Cosine entre estos dos debe ser bajo (descripciones distintas)
  expect(cosine(iphone.embedding, funda.embedding)).toBeLessThan(0.7)
  
  // Pero registramos co-vistas entre ellos en muchas sesiones
  for (let i = 0; i < 50; i++) {
    const sessionId = generateSessionId()
    await registerEvent({ sessionId, type: 'product_view', product: iphone })
    await registerEvent({ sessionId, type: 'product_view', product: funda, withinMinutes: 5 })
  }
  
  await runNightlyNpmiRecompute()
  
  const top = await getCoOccurrenceTop(iphone.id)
  expect(top.map(t => t.related_product_id)).toContain(funda.id)
  
  // El NPMI entre estos debe ser positivo y alto
  const fundaEntry = top.find(t => t.related_product_id === funda.id)
  expect(fundaEntry.npmi_score).toBeGreaterThan(0.3)
})

test('RRF correctly fuses 3 sources', async () => {
  // Setup determinista
  const user = await createUserWithKnownState()
  const lastViewed = await getLastViewedProduct(user.id)
  
  const fuenteA = await retrieveSemanticMultiMode(user.id)
  const fuenteB = await retrieveCoOccurrence(lastViewed.id)
  const fuenteC = await retrievePopularByCohort(user.cohort)
  
  const fused = rrf({ A: fuenteA, B: fuenteB, C: fuenteC, k0: 60 })
  
  // Producto que aparece en las 3 fuentes en rango bajo debe rankear arriba de uno solo en una
  const productInAll = findProductInAllLists(fuenteA, fuenteB, fuenteC)
  const productInOne = findProductInOnlyOne(fuenteA, fuenteB, fuenteC)
  
  expect(fused.findIndex(p => p.id === productInAll.id))
    .toBeLessThan(fused.findIndex(p => p.id === productInOne.id))
})
```

**Criterio de aceptación 3b:**

- [ ] Multi-vector funciona según volúmenes (0/1/2/3 modos según eventos)
- [ ] k-means semanal recalcula correctamente; eventos intermedios se asignan al modo más cercano
- [ ] Grafo de co-ocurrencia se llena con eventos reales y NPMI se calcula correctamente
- [ ] **NPMI captura cross-sell** que cosine no captura (test con iPhone↔funda u otro par equivalente)
- [ ] RRF fusiona las 3 fuentes con la fórmula correcta y `k_0 = 60`
- [ ] **Recall@10 mejora respecto a 3a en al menos +15%**
- [ ] **nDCG@10 mejora** respecto a 3a
- [ ] Diversidad inter-usuario (Jaccard guardrail) en rango [0.05, 0.40]

**Triple revisión 3b.** No avanzar a 3c sin pasar.

---

### Fase 3c — MMR + LLM reranker contextual

**Entregables:**

1. **MMR sobre top-100 del RRF** → top-30:
   ```
   MMR(p) = λ · s_RRF(p) - (1-λ) · max_{p' ∈ S} sim(p, p')
   ```
   con λ=0.7

2. **LLM reranker contextual** top-30 → top-10 con:
   - Resumen del perfil del usuario en lenguaje natural
   - Contexto temporal (hora, día)
   - Última interacción
   - Query reciente si la hubo
   - Los 30 candidatos
   - Output: top-10 ordenado + razón corta para cada uno

3. **Razones generadas por el LLM** en cada tarjeta del feed

4. **Métrica de latencia del feed** (p50, p99 medibles)

**Tests obligatorios:**

```typescript
test('MMR diversifies top-30 from a homogeneous top-100', async () => {
  // Top-100 deliberadamente homogéneo (todas zapatillas casi idénticas)
  const homogeneous = await seedHomogeneousProducts(100, { category: 'zapatillas', similarity: 0.95 })
  const rrfRanking = homogeneous.map((p, i) => ({ id: p.id, score: 1 / (i + 1) }))
  
  const diversified = mmr(rrfRanking, { lambda: 0.7, limit: 30, allEmbeddings })
  
  // La diversidad media entre productos seleccionados debe ser mayor que en el top-30 puro
  const meanDiversityMmr = computeMeanPairwiseDistance(diversified)
  const meanDiversityRaw = computeMeanPairwiseDistance(rrfRanking.slice(0, 30))
  expect(meanDiversityMmr).toBeGreaterThan(meanDiversityRaw)
})

test('LLM reranker produces 10 results with non-empty reasons', async () => {
  const top30 = await getRrfMmrCandidates(testUser.id)
  const reranked = await llmRerank(top30, { user: testUser, context: { hour: 9, day: 'monday' } })
  
  expect(reranked).toHaveLength(10)
  for (const item of reranked) {
    expect(item.product_id).toBeTruthy()
    expect(item.reason).toBeTruthy()
    expect(item.reason.length).toBeGreaterThan(10)
    expect(item.reason).not.toMatch(/^\s*$/)
    // No debe ser placeholder genérico
    expect(item.reason).not.toMatch(/^(producto recomendado|para ti|popular)$/i)
  }
})

test('feed latency p99 is below 1.5s', async () => {
  const latencies = []
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    await generateFeed(testUser.id, { limit: 10 })
    latencies.push(performance.now() - start)
  }
  
  const p99 = percentile(latencies, 99)
  expect(p99).toBeLessThan(1500)
})
```

**Criterio de aceptación 3c:**

- [ ] MMR diversifica top-100 → top-30 (mayor diversidad media de pares que el top-30 puro del RRF)
- [ ] LLM reranker devuelve 10 con razones no vacías ni placeholder
- [ ] Las razones son auditadas manualmente (preguntar al usuario, mostrar 50 casos): coherencia ≥ 80%
- [ ] **nDCG@10 mejora** respecto a 3b
- [ ] Latencia p99 del feed < 1.5s
- [ ] Costo simulado del LLM rerank por feed: medirlo y reportarlo

**Triple revisión 3c.** Cierre de Fase 3 completa.

---

## SECCIÓN H — Reporte por fase

Al cerrar cada fase (1, 2, 3a, 3b, 3c) entregar al usuario un reporte con esta estructura:

```
# Reporte de Fase X

## Hitos completados
- [...]

## Tests escritos
- N tests en total
- M de ellos con mutation testing aplicado y verificado
- 0 con anti-patterns prohibidos

## Bugs encontrados durante el desarrollo
1. [descripción] — fix en commit [hash]
2. [...]

(Si dices que no encontraste bugs, eso es sospechoso y el usuario lo va a notar.
 La realidad es que TDD agarra muchos. Reporta los reales.)

## Output literal de los 3 revisores

=== AGENTE 1 (Adversario) — output literal ===
[...]

=== AGENTE 2 (Auditor de Mocks) — output literal ===
[...]

=== AGENTE 3 (Probador de Comportamiento) — output literal ===
[...]

## Métricas relevantes (si aplican)
- Recall@10 sobre eval set sintético: X
- nDCG@10: Y
- Latencia p99: Z ms
- Diversidad inter-usuario (Jaccard): W
- Costo simulado del mock acumulado: $X

## Items conocidos pendientes
- [...]

## Decisión
✅ Fase X cerrada. Listo para Fase X+1.
o
⚠️ Fase X tiene items pendientes que requieren decisión del usuario antes de avanzar:
  1. [...]
```

---

## SECCIÓN I — Primer paso

1. Confirma que recibiste y leíste el documento maestro `MVP_Ecommerce_Personalizado_v1_2.md` y este prompt completo.

2. Resúmeme en 8-10 bullets lo que vas a hacer en orden cronológico (pre-flight → Fase 1 → triple revisión → Fase 2 → triple revisión → 3a → triple revisión → 3b → triple revisión → 3c → triple revisión → reporte final).

3. Confirma que entendiste:
   - La regla de verificación de versiones
   - La filosofía de testing y los anti-patterns prohibidos
   - El sistema de triple revisión con sus 3 agentes
   - Que NO avanzas a la siguiente fase sin pasar las 3 revisiones de la actual
   - Que el output literal de los subagentes va en cada reporte

4. Empieza por el pre-flight check de Fase 0 (Sección A). Reporta el `PRE-FLIGHT REPORT` y espera mi confirmación.

5. Si en cualquier momento detectas que algo no está bien o tienes dudas reales, **pregunta**. Es preferible una pausa que avanzar en dirección equivocada.

---

**Nota final:** este es un trabajo serio, largo, y técnicamente exigente. No es una demo. Lo que construyas aquí es la base sobre la que se montará la versión productiva con APIs reales en el futuro. Tómate el tiempo necesario.