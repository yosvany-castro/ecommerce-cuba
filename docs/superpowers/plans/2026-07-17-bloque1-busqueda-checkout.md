# Bloque 1 — Búsqueda confiable + Checkout honesto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar la búsqueda por URL (async con fallback) y por título literal, hacer visible la ingesta en vivo, y pasar el checkout a envío por libra + taxes + buffer, con títulos truncados y link a la tienda.

**Architecture:** La rama URL de búsqueda pasa de "1 llamada o 422" a "intento inmediato → 202 pending → reintentos de fondo → fallback a búsqueda por slug". El cálculo de envío/tax vive en UN módulo puro compartido cliente/servidor (`src/lib/shipping.ts`, mismo patrón que `src/lib/weight.ts`) para que cobro = mostrado. El server del checkout recalcula todo y responde 409 si difiere.

**Tech Stack:** Next.js App Router, TypeScript, pg crudo con `withPg`/`withPgDirect`, zod, vitest (`pnpm test:unit`). Spec: `docs/superpowers/specs/2026-07-17-bloque1-busqueda-checkout-design.md`.

## Global Constraints

- Rama de trabajo: `feat/bloque1-busqueda-checkout` (ya existe, spec commiteado).
- REGLA DE ORO: el precio/total mostrado jamás cambia en silencio; el server recalcula y rechaza con 409 visible.
- El spinner sagrado del agente y sus velocidades (1100/2200/4200 ms en `useTukiSearch.ts:61-65`) NO se tocan.
- Knobs (añadir a `.env.example`): `NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB=350`, `NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB=` (vacío = vía oculta), `NEXT_PUBLIC_SALES_TAX_PCT=7.5`. Son `NEXT_PUBLIC_` porque el mismo número se usa en cliente y server.
- Tests: `pnpm test:unit` (vitest, `tests/unit/*.test.ts`). Typecheck: `pnpm typecheck`. No llamar red en tests.
- Los tests unitarios nuevos siguen el patrón de `tests/unit/url-resolver.test.ts` (describe/test/expect, imports con `@/`).
- Commits frecuentes, mensajes `feat(...)/fix(...)` en español como el historial, con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Parser AliExpress — leer el ID real del query string

**Files:**
- Modify: `src/sectors/b-catalog/url-resolver.ts:60-63`
- Test: `tests/unit/url-resolver.test.ts`

**Interfaces:**
- Produces: `parseProductUrl(raw)` devuelve para AliExpress el `x_object_id`/`object_id` del query si existe (formato `1005…`, el productId real), y si no el ID del path (`3256…`, SEO/legacy).

- [ ] **Step 1: Write the failing tests** (añadir al describe de aliexpress en `tests/unit/url-resolver.test.ts`)

```ts
test("aliexpress.us con x_object_id en query → gana el ID del query (el del path es SEO)", () => {
  expect(
    parseProductUrl(
      "https://www.aliexpress.us/item/3256812204334285.html?spm=a2g0o.productlist.main.18&x_object_id=1005012390649037&gatewayAdapt=glo2usa",
    ),
  ).toEqual({ source: "aliexpress", source_product_id: "1005012390649037" });
});

test("aliexpress con object_id (variante del param) también gana al path", () => {
  expect(
    parseProductUrl("https://es.aliexpress.com/item/3256812204334285.html?object_id=1005012390649037"),
  ).toEqual({ source: "aliexpress", source_product_id: "1005012390649037" });
});

test("aliexpress sin params de query → ID del path como siempre", () => {
  expect(parseProductUrl("https://www.aliexpress.com/item/1005012345678901.html")).toEqual({
    source: "aliexpress",
    source_product_id: "1005012345678901",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/url-resolver.test.ts`
Expected: FAIL — el primero devuelve `3256812204334285` en vez de `1005012390649037`.

- [ ] **Step 3: Implement** — en `url-resolver.ts`, reemplazar el bloque aliexpress de `parseProductUrl`:

```ts
  if (hostMatches(host, "aliexpress")) {
    // El path suele traer un ID SEO/legacy (3256…) que el detalle de DataHub
    // NO resuelve; el productId real (1005…) viaja en el query como
    // x_object_id / object_id (verificado en vivo 2026-07-17). Query primero.
    const queryId = url.searchParams.get("x_object_id") ?? url.searchParams.get("object_id");
    if (queryId && /^\d+$/.test(queryId)) return { source: "aliexpress", source_product_id: queryId };
    const m = path.match(ALIEXPRESS_ITEM);
    return m ? { source: "aliexpress", source_product_id: m[1] } : null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/url-resolver.test.ts`
Expected: PASS (todos, incluidos los viejos).

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/url-resolver.ts tests/unit/url-resolver.test.ts
git commit -m "fix(search): URL AliExpress — el ID real viene en x_object_id del query, no en el path"
```

---

### Task 2: `slugQueryFromUrl` — palabras del slug para el fallback

**Files:**
- Modify: `src/sectors/b-catalog/url-resolver.ts` (añadir función al final)
- Test: `tests/unit/url-resolver.test.ts`

**Interfaces:**
- Produces: `slugQueryFromUrl(raw: string): string | null` — palabras legibles del slug del pathname (máx 10), o `null` si el path no trae título (p. ej. AliExpress `/item/123.html`). La consumen Task 4 (route, `fallback_query`) y Task 5 (cliente).

- [ ] **Step 1: Write the failing tests**

```ts
import { parseProductUrl, slugQueryFromUrl } from "@/sectors/b-catalog/url-resolver";

describe("slugQueryFromUrl", () => {
  test("shein: slug largo → primeras 10 palabras sin ids ni stopwords de URL", () => {
    expect(
      slugQueryFromUrl(
        "https://us.shein.com/24pcs-Random-Color-Women-s-Men-s-Multi-Color-Minimalist-Comfortable-Elastic-Sports-Headbands-Sweat-Absorbent-Durable-p-423099565.html",
      ),
    ).toBe("24pcs Random Color Women s Men s Multi Color Minimalist");
  });

  test("amazon con slug de título", () => {
    expect(slugQueryFromUrl("https://www.amazon.com/Levis-505-Regular-Fit-Jeans/dp/B0018QS5HU")).toBe(
      "Levis 505 Regular Fit Jeans",
    );
  });

  test("aliexpress /item/ID.html no trae título → null", () => {
    expect(slugQueryFromUrl("https://www.aliexpress.us/item/3256812204334285.html?x_object_id=1005012390649037")).toBeNull();
  });

  test("texto que no es URL → null", () => {
    expect(slugQueryFromUrl("mini camera 1080p")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/url-resolver.test.ts`
Expected: FAIL — `slugQueryFromUrl` no existe.

- [ ] **Step 3: Implement** — añadir al final de `url-resolver.ts`:

```ts
// Palabras que aparecen en paths de tienda y no describen el producto.
const SLUG_NOISE = new Set(["dp", "gp", "product", "item", "ip", "html", "p", "cat", "ref"]);

/** Slug del pathname → query de texto para el fallback cuando el detalle del
 * proveedor no resuelve (p. ej. OTAPI shein "ItemIsNotComplete"). null si el
 * path no trae título legible (aliexpress /item/ID.html). Máx 10 palabras. */
export function slugQueryFromUrl(raw: string): string | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  const words = url.pathname
    .split(/[/\-_.]+/)
    .filter((w) => w.length > 0 && !SLUG_NOISE.has(w.toLowerCase()) && !/^\d{6,}$/.test(w) && !/^[A-Z0-9]{10}$/.test(w));
  if (words.length < 2) return null;
  return words.slice(0, 10).join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/url-resolver.test.ts`
Expected: PASS. Si el literal exacto del primer test difiere (stopwords), ajustar el `expect` al output real SOLO si sigue siendo un query razonable de ≤10 palabras del título.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/url-resolver.ts tests/unit/url-resolver.test.ts
git commit -m "feat(search): slugQueryFromUrl — palabras del slug como query de fallback"
```

---

### Task 3: `classifyDetail` — distinguir "pendiente de indexar" de "falló"

**Files:**
- Modify: `src/sectors/b-catalog/revalidate.ts` (añadir función pura junto a los parsers)
- Test: `tests/unit/revalidate.test.ts`

**Interfaces:**
- Consumes: los parsers existentes (`parseSheinDetail`, `parseAliexpressDetail`, …).
- Produces: `classifyDetail(source: string, json: unknown): "ok" | "pending" | "failed"` — `"pending"` = el proveedor puede resolver más tarde (OTAPI `NotAvailable/ItemIsNotComplete`, DataHub `code 205/5040`). La consumen Task 4 (route → 202) y el job de reintentos.

- [ ] **Step 1: Write the failing tests** (añadir a `tests/unit/revalidate.test.ts`)

```ts
import { classifyDetail } from "@/sectors/b-catalog/revalidate";

describe("classifyDetail", () => {
  test("shein ItemIsNotComplete → pending (OTAPI indexa perezoso, verificado 2026-07-17)", () => {
    const json = { ErrorCode: "NotAvailable", SubErrorCode: { Value: "ItemIsNotComplete" } };
    expect(classifyDetail("shein", json)).toBe("pending");
  });

  test("aliexpress code 205 no results → pending", () => {
    expect(classifyDetail("aliexpress", { result: { status: { code: 205 } } })).toBe("pending");
  });

  test("aliexpress code 5040 endpoint caído → pending", () => {
    expect(classifyDetail("aliexpress", { result: { status: { code: 5040 } } })).toBe("pending");
  });

  test("shein Ok con precio → ok", () => {
    const json = {
      ErrorCode: "Ok",
      Result: { Item: { MasterQuantity: 3, Price: { ConvertedPriceList: { Internal: { Price: "9.99" } } } } },
    };
    expect(classifyDetail("shein", json)).toBe("ok");
  });

  test("json irreconocible → failed", () => {
    expect(classifyDetail("shein", { basura: true })).toBe("failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/revalidate.test.ts`
Expected: FAIL — `classifyDetail` no existe.

- [ ] **Step 3: Implement** — en `revalidate.ts`, después de `parseSheinDetail`:

```ts
const PENDING_DATAHUB_CODES = new Set([205, 5040]); // no-results-aún / endpoint caído temporal

/** ¿El detalle vivo está OK, pendiente de que el proveedor lo indexe, o roto?
 * "pending" es la clase que justifica REINTENTAR (OTAPI shein indexa perezoso:
 * la 1ª llamada dispara el indexado y pide "try again later" — verificado en
 * vivo 2026-07-17; DataHub 205/5040 son transitorios del tier gratis). */
export function classifyDetail(source: string, json: unknown): "ok" | "pending" | "failed" {
  if (source === "shein") {
    const code = (json as { ErrorCode?: unknown } | null)?.ErrorCode;
    if (code === "NotAvailable") return "pending";
    return parseSheinDetail(json) ? "ok" : "failed";
  }
  if (source === "aliexpress") {
    const code = toNumber(asRecord(asRecord(asRecord(json)?.result)?.status)?.code);
    if (code !== null && PENDING_DATAHUB_CODES.has(code)) return "pending";
    return parseAliexpressDetail(json) ? "ok" : "failed";
  }
  if (source === "amazon") return parseAmazonDetail(json) ? "ok" : "failed";
  if (source === "walmart") return parseWalmartDetail(json) ? "ok" : "failed";
  return "failed";
}
```

(`asRecord`/`toNumber` ya están importados en `revalidate.ts` — verificar y reutilizar.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/revalidate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/b-catalog/revalidate.ts tests/unit/revalidate.test.ts
git commit -m "feat(search): classifyDetail — pending vs failed para el detalle vivo"
```

---

### Task 4: Resolve por URL asíncrono — 202 pending + reintentos de fondo

**Files:**
- Create: `src/sectors/b-catalog/resolve-retry.ts`
- Modify: `src/app/api/products/resolve-url/route.ts`

**Interfaces:**
- Consumes: `classifyDetail` (Task 3), `slugQueryFromUrl` (Task 2), `fetchDetailJson`/`parseDetailTitleImage`/`processProduct` (existentes), `singleFlight` (`src/sectors/c-search/decide/single-flight.ts`), `withPgDirect`.
- Produces: respuesta del endpoint pasa a ser `200 {product_id}` | `202 {status:"pending", fallback_query: string|null}` | `422 {error}` | `429 {error:"quota"}`. `queueResolveRetry(input)` corre de fondo y upserta el producto si el proveedor termina de indexar.

- [ ] **Step 1: Create `src/sectors/b-catalog/resolve-retry.ts`**

```ts
// src/sectors/b-catalog/resolve-retry.ts — reintentos de fondo del resolve por
// URL. OTAPI shein indexa perezoso ("try again later", verificado en vivo
// 2026-07-17: 6 intentos/2min aún incompleto) y DataHub aliexpress da 205/5040
// transitorios — una sola llamada síncrona nunca alcanza. Mismo patrón
// fire-and-forget + searchPath de c-search/ingest-async.ts.
import { withPgDirect } from "@/lib/db/helpers";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";
import { fetchDetailJson, classifyDetail, type ProviderRef } from "./revalidate";
import { parseDetailTitleImage } from "./detail-title-image";
import {
  parseAmazonDetail,
  parseAliexpressDetail,
  parseWalmartDetail,
  parseSheinDetail,
  type DetailResult,
} from "./revalidate";
import { processProduct } from "./enrichment/pipeline";
import type { MockProduct } from "./mock/types";

// ponytail: backoff fijo — 3 reintentos en ~2 min tras el intento inmediato de
// la ruta. Si OTAPI tarda más, el fallback por slug ya cubrió al usuario.
const RETRY_DELAYS_MS = [20_000, 40_000, 60_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseDetail(source: string, json: unknown): DetailResult | null {
  switch (source) {
    case "amazon": return parseAmazonDetail(json);
    case "aliexpress": return parseAliexpressDetail(json);
    case "walmart": return parseWalmartDetail(json);
    case "shein": return parseSheinDetail(json);
    default: return null;
  }
}

export interface ResolveRetryInput {
  ref: ProviderRef;
  searchPath: string;
}

/** Reintenta el detalle del proveedor y, si al fin resuelve, upserta el
 * producto por el pipeline normal. El cliente NO espera esto: hace poll al
 * endpoint, que encuentra el producto en catálogo cuando este job termina.
 * Nota cuota: los reintentos de aliexpress viajan sobre la reserva que ya
 * hizo la ruta (no re-reservan). */
export function queueResolveRetry(input: ResolveRetryInput): Promise<void> {
  const key = `resolve-retry:${input.ref.source}:${input.ref.source_product_id}`;
  const p = singleFlight(key, async () => {
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      try {
        const fetched = await fetchDetailJson(input.ref);
        if (!fetched) return;
        const cls = classifyDetail(input.ref.source, fetched.json);
        if (cls === "failed") return;
        if (cls === "pending") continue;
        const detail = parseDetail(input.ref.source, fetched.json);
        const titleImage = parseDetailTitleImage(input.ref.source, fetched.json);
        if (!detail || !titleImage) return;
        const raw: MockProduct = {
          id: `${input.ref.source}:${input.ref.source_product_id}`,
          source: input.ref.source,
          source_product_id: input.ref.source_product_id,
          title: titleImage.title,
          description: titleImage.title,
          image_url: titleImage.image_url,
          price_cents: detail.price_cents,
          brand: "",
          raw_category: "",
          attributes: {},
          url: input.ref.url,
        };
        await withPgDirect(async (pg) => {
          await pg.query(`SET search_path TO ${input.searchPath}`);
          await processProduct(raw, pg);
        });
        return;
      } catch {
        // red/proveedor caído: el próximo delay reintenta; agotados, se rinde
      }
    }
  });
  p.catch(() => {}); // fire-and-forget: jamás unhandled rejection
  return p;
}
```

(Si `MockProduct.source` exige el union type `MockProductSource`, tipar `ResolveRetryInput.ref` con `{ source: MockProductSource; source_product_id: string; url: string | null }` y ajustar — mirar cómo lo hace la ruta actual, que ya construye un `MockProduct` igual.)

- [ ] **Step 2: Reescribir el flujo de `resolve-url/route.ts`** — mantener parse/catálogo/cuota tal cual; cambiar el tramo del fetch (líneas 71-99) por:

```ts
    try {
      const ref: ProviderRef = { source, source_product_id, url: absoluteUrl };
      const fetched = await fetchDetailJson(ref);
      const cls = fetched ? classifyDetail(source, fetched.json) : "failed";

      if (cls === "ok") {
        const detail = parseDetail(source, fetched!.json);
        const titleImage = parseDetailTitleImage(source, fetched!.json);
        if (detail && titleImage) {
          const raw: MockProduct = {
            id: `${source}:${source_product_id}`,
            source,
            source_product_id,
            title: titleImage.title,
            description: titleImage.title,
            image_url: titleImage.image_url,
            price_cents: detail.price_cents,
            brand: "",
            raw_category: "",
            attributes: {},
            url: absoluteUrl,
          };
          const result = await processProduct(raw, pg);
          return NextResponse.json({ product_id: result.productId });
        }
      }

      if (cls === "pending") {
        // El proveedor puede indexar en 1-2 min: reintentos de fondo + el
        // cliente hace poll a ESTE endpoint (el hit de catálogo de arriba
        // responde cuando el job termina). Cooldown en queueResolveRetry via
        // singleFlight: N polls = 1 job.
        const searchPath = (await pg.query(`SHOW search_path`)).rows[0].search_path as string;
        queueResolveRetry({ ref, searchPath });
        return NextResponse.json(
          { status: "pending", fallback_query: slugQueryFromUrl(body.url) },
          { status: 202 },
        );
      }

      return NextResponse.json(
        { error: "parse_failed", fallback_query: slugQueryFromUrl(body.url) },
        { status: 422 },
      );
    } catch {
      return NextResponse.json(
        { error: "fetch_failed", fallback_query: slugQueryFromUrl(body.url) },
        { status: 422 },
      );
    }
```

Imports nuevos en la ruta: `classifyDetail` (de revalidate), `slugQueryFromUrl` (de url-resolver), `queueResolveRetry` (de resolve-retry).

**Cuota AliExpress en polls:** mover el `reserveAliexpressQuota` para que solo se cobre cuando de verdad vamos a pegarle al proveedor Y no hay un retry en vuelo. Regla simple: dejar la reserva donde está, pero en los polls subsecuentes (mismo `source:id` con retry en vuelo) NO se re-fetchea: añadir antes de la reserva:

```ts
    // Poll de un resolve pendiente: si ya hay retry en vuelo para este
    // producto, no re-fetchear ni re-reservar cuota — 202 directo.
    if (resolveInFlight(source, source_product_id)) {
      return NextResponse.json(
        { status: "pending", fallback_query: slugQueryFromUrl(body.url) },
        { status: 202 },
      );
    }
```

y en `resolve-retry.ts` exportar el helper:

```ts
const inFlight = new Set<string>();
export function resolveInFlight(source: string, id: string): boolean {
  return inFlight.has(`${source}:${id}`);
}
// dentro de queueResolveRetry: inFlight.add(k) al arrancar el job y
// inFlight.delete(k) en un finally al terminar.
// ponytail: Set en memoria por instancia — suficiente en single-node; si un
// día hay N instancias, el peor caso es un fetch de más, no un error.
```

- [ ] **Step 3: Typecheck + tests existentes**

Run: `pnpm typecheck && pnpm test:unit`
Expected: PASS (no hay test unit de la ruta; los de parsers/url-resolver siguen verdes).

- [ ] **Step 4: Commit**

```bash
git add src/sectors/b-catalog/resolve-retry.ts src/app/api/products/resolve-url/route.ts
git commit -m "feat(search): resolve por URL asíncrono — 202 pending + reintentos de fondo con singleFlight"
```

---

### Task 5: Cliente — poll del pending y fallback a búsqueda por slug

**Files:**
- Modify: `src/components/tuki/useTukiSearch.ts` (rama URL, líneas 142-187)

**Interfaces:**
- Consumes: respuesta 200/202/422 de Task 4 (con `fallback_query`).
- Produces: `meta.method` gana dos valores nuevos que Task 7 pinta: `"url_pending_failed"` (no se pudo y no había slug) y `"url_fallback_search"` (se cayó al texto del slug). El fallback llama `/api/search?q=<slug>&force=1` (el `force` lo implementa Task 6).

- [ ] **Step 1: Reemplazar la rama URL** de `run()` (el bloque `if (parsedUrl) { ... }`) por:

```ts
      const parsedUrl = parseProductUrl(q);
      if (parsedUrl) {
        setPhase("loading");
        setResolvingUrl(true);
        let p = 0.15;
        setProgress(p);
        animTimer.current = setInterval(() => {
          if (myId !== runId.current) return clearAnim();
          p = Math.min(0.9, p + 0.03); // más lento: el resolve puede tardar ~1 min
          setProgress(p);
        }, 400);

        // Fallback a búsqueda de texto con las palabras del slug (Task 6 fuerza
        // la ingesta con force=1). Si no hay slug (aliexpress /item/ID.html),
        // empty state honesto.
        const fallbackToSlug = (fallbackQuery: string | null) => {
          if (myId !== runId.current) return;
          clearAnim();
          setResolvingUrl(false);
          if (!fallbackQuery) {
            setCards([]);
            setMeta({ hit_cache: false, called_mock: false, method: "url_pending_failed" });
            setProgress(1);
            setPhase("results");
            return;
          }
          fetch(`/api/search?q=${encodeURIComponent(fallbackQuery)}&force=1`)
            .then((r) => r.json() as Promise<ApiResp>)
            .then((r1) => {
              if (myId !== runId.current) return;
              setCards(toCards(r1.products));
              setMeta({ hit_cache: false, called_mock: r1.called_mock, method: "url_fallback_search" });
              setProgress(1);
              setPhase("results");
              if (r1.called_mock) {
                setPolling(true);
                pollForMoreUrl(fallbackQuery, 0, r1.products.length);
              }
            })
            .catch(() => {
              if (myId !== runId.current) return;
              setCards([]);
              setMeta({ hit_cache: false, called_mock: false, method: "url_pending_failed" });
              setProgress(1);
              setPhase("results");
            });
        };

        // Poll del resolve pendiente: el server reintenta de fondo; nosotros
        // re-preguntamos hasta ~65s y después caemos al slug.
        const RESOLVE_POLL_MS = [5_000, 10_000, 15_000, 15_000, 20_000];
        const pollResolve = (attempt: number, lastFallback: string | null) => {
          if (myId !== runId.current) return;
          if (attempt >= RESOLVE_POLL_MS.length) return fallbackToSlug(lastFallback);
          pollTimer.current = setTimeout(() => {
            if (myId !== runId.current) return;
            postResolve().then(handleResolve(attempt + 1)).catch(() => fallbackToSlug(lastFallback));
          }, RESOLVE_POLL_MS[attempt]);
        };

        const postResolve = () =>
          fetch("/api/products/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: q }),
          });

        const handleResolve = (attempt: number) => async (r: Response) => {
          if (myId !== runId.current) return;
          const body = (await r.json().catch(() => null)) as
            | { product_id?: string; status?: string; fallback_query?: string | null }
            | null;
          if (r.ok && body?.product_id) {
            clearAnim();
            router.push(`/products/${body.product_id}`);
            return;
          }
          if (r.status === 202) {
            pollResolve(attempt, body?.fallback_query ?? null);
            return;
          }
          fallbackToSlug(body?.fallback_query ?? null); // 422/429/otro: al slug ya
        };

        postResolve().then(handleResolve(0)).catch(() => fallbackToSlug(null));
        return;
      }
```

y añadir (junto a `pollForMore`) la variante para el fallback, que re-consulta la query del slug en vez de `q`:

```ts
      // Igual que pollForMore pero contra la query del slug del fallback.
      const pollForMoreUrl = (fq: string, attempt: number, knownCount: number) => {
        if (myId !== runId.current || attempt >= POLL_SCHEDULE_MS.length) {
          if (myId === runId.current) setPolling(false);
          return;
        }
        pollTimer.current = setTimeout(() => {
          if (myId !== runId.current) return;
          fetch(`/api/search?q=${encodeURIComponent(fq)}`)
            .then((r) => r.json() as Promise<ApiResp>)
            .then((rN) => {
              if (myId !== runId.current) return;
              if (rN.products.length > knownCount) {
                setCards(toCards(rN.products));
                knownCount = rN.products.length;
                setNewCount((c) => c + 1); // Task 7 lo pinta; si aún no existe, omitir esta línea aquí y añadirla en Task 7
              }
              pollForMoreUrl(fq, attempt + 1, knownCount);
            })
            .catch(() => pollForMoreUrl(fq, attempt + 1, knownCount));
        }, POLL_SCHEDULE_MS[attempt]);
      };
```

Nota de orden: `pollForMoreUrl` referencia `setNewCount` de Task 7 — si se ejecuta esta task antes, dejar la línea fuera y Task 7 la añade. `pollForMoreUrl` debe declararse ANTES de la rama URL (const hoisting no aplica a arrow functions) — declararla arriba de `const parsedUrl`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/tuki/useTukiSearch.ts
git commit -m "feat(search): cliente espera el resolve pendiente y cae a búsqueda por slug — nunca vacío seco"
```

---

### Task 6: `force=1` + regla de título largo (>8 palabras)

**Files:**
- Modify: `src/sectors/c-search/decide/shouldCallMock.ts` (helper puro)
- Modify: `src/sectors/c-search/search.ts` (wiring, bloque `if (normalized)` líneas ~305-326)
- Modify: `src/app/api/search/route.ts` (leer `force=1` y pasarlo)
- Test: `tests/unit/decide-mock.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `isTitleLikeQuery(q: string): boolean` en shouldCallMock.ts; `hybridSearch(rawQuery, pg, opts)` acepta `opts.forceIngest?: boolean`; `/api/search?q=…&force=1` fuerza la ingesta. Con título largo o force: el corte `low_confidence` NO aplica (el resto de los frenos — presupuesto diario, freshness, async — quedan igual).

- [ ] **Step 1: Write the failing test** (añadir a `tests/unit/decide-mock.test.ts`)

```ts
import { isTitleLikeQuery } from "@/sectors/c-search/decide/shouldCallMock";

describe("isTitleLikeQuery", () => {
  test("título pegado de shein (30 palabras) → true", () => {
    expect(
      isTitleLikeQuery(
        "24pcs Random Color Women's & Men's Multi-Color Minimalist Comfortable Elastic Sports Headbands, Sweat-Absorbent & Durable, Suitable For Yoga",
      ),
    ).toBe(true);
  });
  test("query corta normal → false", () => {
    expect(isTitleLikeQuery("mini camera 1080p")).toBe(false);
  });
  test("9 palabras justas → true, 8 → false", () => {
    expect(isTitleLikeQuery("a b c d e f g h i")).toBe(true);
    expect(isTitleLikeQuery("a b c d e f g h")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/decide-mock.test.ts`
Expected: FAIL — no existe.

- [ ] **Step 3: Implement** — en `shouldCallMock.ts`:

```ts
/** Un query de >8 palabras es casi seguro un TÍTULO pegado (spec Bloque 1):
 * el usuario busca ESE producto — la duda del normalizador (low_confidence)
 * no debe frenar la ingesta en vivo. */
export function isTitleLikeQuery(q: string): boolean {
  return q.trim().split(/\s+/).length > 8;
}
```

En `search.ts`: la firma de `hybridSearch` gana `forceIngest` en sus opts (localizar la interfaz de opts existente — la que trae `trace` — y añadir `forceIngest?: boolean`). En el bloque de decisión (`if (normalized) { let should = shouldCallMock(...) }`):

```ts
    const titlePaste = isTitleLikeQuery(rawQuery) || opts?.forceIngest === true;
    // Título pegado/force: la confianza del LLM no veta (spec B1) — se pasa 1.
    let should = shouldCallMock(strongHits, titlePaste ? 1 : normalized.confidence, lastRefreshedAt);
    if (!should) {
      if (strongHits >= LOCAL_HITS_THRESHOLD) decisionReason = "enough_local_hits";
      else if (!titlePaste && normalized.confidence <= 0.5) decisionReason = "low_confidence";
      // (resto del else-if igual que hoy)
```

Import de `isTitleLikeQuery` junto a los demás imports de `./decide/shouldCallMock`.

En `src/app/api/search/route.ts`: leer el flag y pasarlo (localizar dónde llama `hybridSearch(q, pg, {...})` y añadir `forceIngest: req.nextUrl.searchParams.get("force") === "1"`).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:unit && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sectors/c-search/decide/shouldCallMock.ts src/sectors/c-search/search.ts src/app/api/search/route.ts tests/unit/decide-mock.test.ts
git commit -m "feat(search): títulos pegados (>8 palabras) y force=1 fuerzan la ingesta en vivo"
```

---

### Task 7: Ingesta en vivo VISIBLE — banner + badge de nuevos + avisos de URL

**Files:**
- Modify: `src/components/tuki/SearchView.tsx` (chips, líneas 86-141)
- Modify: `src/components/tuki/useTukiSearch.ts` (estado `newCount`)

**Interfaces:**
- Consumes: `meta.method` de Task 5 (`url_fallback_search`, `url_pending_failed`), `polling` existente.
- Produces: `TukiSearch.newCount: number` (resultados añadidos por poll desde que se pintó r1).

- [ ] **Step 1: `useTukiSearch.ts`** — añadir estado y exponerlo:

```ts
const [newCount, setNewCount] = useState(0);
```

- En `run()`, tras `clearPoll()` inicial: `setNewCount(0);`
- En `pollForMore` (y `pollForMoreUrl` de Task 5), dentro del `if (rN.products.length > knownCount)`, antes de actualizar `knownCount`:

```ts
setNewCount((c) => c + (rN.products.length - knownCount));
```

- Añadir `newCount` al interface `TukiSearch` y al objeto retornado.

- [ ] **Step 2: `SearchView.tsx`** — reemplazar `pollingChip` y `urlFailedNotice` por:

```tsx
// Búsqueda en vivo VISIBLE (spec B1-C): banner claro mientras el poll sigue
// trayendo de las tiendas — el chip sutil anterior pasaba desapercibido.
function LiveSearchBanner({ newCount }: { newCount: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "12px 16px", borderRadius: 14, border: "1px solid #ECECE7", background: "#fff" }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1C1D20", animation: "sparkPulse 1.3s ease-in-out infinite" }} />
      <div style={{ fontSize: 13, color: "#1C1D20", fontWeight: 600 }}>
        buscando en Amazon, AliExpress y Shein en vivo…
        <span style={{ fontWeight: 500, color: "#8E8F94" }}> los resultados nuevos aparecen solos</span>
      </div>
      {newCount > 0 && (
        <div style={{ marginLeft: "auto", background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 700 }}>
          +{newCount} nuevos
        </div>
      )}
    </div>
  );
}

const urlFailedNotice = (
  <div style={{ display: "inline-flex", alignItems: "center", marginBottom: 14, padding: "5px 13px", borderRadius: 999, border: "1px solid #ECECE7", background: "#fff", fontSize: 11.5, color: "#55565B" }}>
    no pudimos leer ese enlace
  </div>
);

const urlFallbackNotice = (
  <div style={{ display: "inline-flex", alignItems: "center", marginBottom: 14, padding: "5px 13px", borderRadius: 999, border: "1px solid #ECECE7", background: "#FBEFE2", fontSize: 11.5, color: "#A2683B" }}>
    no pudimos traer el producto exacto del enlace — esto es lo más parecido
  </div>
);
```

y en el `notice={...}` del return:

```tsx
      notice={
        !loading && (meta?.hit_cache || polling || meta?.method === "url_resolve_failed" || meta?.method === "url_pending_failed" || meta?.method === "url_fallback_search") ? (
          <>
            {meta?.hit_cache && cacheBadge}
            {(meta?.method === "url_resolve_failed" || meta?.method === "url_pending_failed") && urlFailedNotice}
            {meta?.method === "url_fallback_search" && urlFallbackNotice}
            {polling && <LiveSearchBanner newCount={search.newCount} />}
          </>
        ) : undefined
      }
```

Además, en `Loader`, las frases de `resolvingUrl` cambian a algo honesto del pending largo:

```ts
  const searchPhrases = resolvingUrl
    ? ["leyendo el enlace…", "pidiéndole el producto a la tienda…", "la tienda está preparando los datos…", "casi — dándole unos segundos más…"]
    : [ /* igual que hoy */ ];
```

- [ ] **Step 3: Typecheck + vistazo manual**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/tuki/SearchView.tsx src/components/tuki/useTukiSearch.ts
git commit -m "feat(search): banner visible de búsqueda en vivo + badge de resultados nuevos + avisos de URL honestos"
```

---

### Task 8: `src/lib/shipping.ts` — envío por libra + tax, puro y compartido

**Files:**
- Create: `src/lib/shipping.ts`
- Modify: `.env.example` (knobs)
- Test: `tests/unit/shipping.test.ts`

**Interfaces:**
- Produces (las consumen Tasks 9-12):

```ts
export interface ShipQuote { est_lb: number; buffer_lb: number; chargeable_lb: number; rate_cents_per_lb: number; ship_cents: number; }
export function shipRateCentsPerLb(via: "aereo" | "maritimo"): number | null; // null = vía sin tarifa → oculta
export function shipQuote(estLb: number, via: "aereo" | "maritimo"): ShipQuote | null;
export function taxCents(productSubtotalCents: number): number;
export function taxPct(): number;
```

- [ ] **Step 1: Write the failing tests** — `tests/unit/shipping.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { shipQuote, taxCents, taxPct, shipRateCentsPerLb } from "@/lib/shipping";

describe("shipQuote (aéreo $3.50/lb default, buffer max(15%, 1 lb), ceil)", () => {
  test("0.4 lb estimadas → buffer 1 lb → ceil(1.4)=2 lb → $7.00", () => {
    const q = shipQuote(0.4, "aereo")!;
    expect(q.buffer_lb).toBe(1);
    expect(q.chargeable_lb).toBe(2);
    expect(q.ship_cents).toBe(700);
  });
  test("10 lb → buffer 1.5 → ceil(11.5)=12 lb → $42.00", () => {
    const q = shipQuote(10, "aereo")!;
    expect(q.buffer_lb).toBe(1.5);
    expect(q.chargeable_lb).toBe(12);
    expect(q.ship_cents).toBe(4200);
  });
  test("carrito vacío (0 lb) → 0 en todo", () => {
    const q = shipQuote(0, "aereo")!;
    expect(q.chargeable_lb).toBe(0);
    expect(q.ship_cents).toBe(0);
  });
  test("marítimo sin tarifa configurada → null (vía oculta)", () => {
    expect(shipRateCentsPerLb("maritimo")).toBeNull();
    expect(shipQuote(3, "maritimo")).toBeNull();
  });
});

describe("taxCents (7.5% Hillsborough default)", () => {
  test("$100.00 → $7.50", () => expect(taxCents(10000)).toBe(750));
  test("redondeo: $9.99 → 75¢ (749.25 → 749? no: Math.round=749)", () => expect(taxCents(999)).toBe(75));
  test("0 → 0", () => expect(taxCents(0)).toBe(0));
  test("pct default", () => expect(taxPct()).toBe(7.5));
});
```

(OJO al test de redondeo: `999 × 0.075 = 74.925` → `Math.round` = **75**. Dejar el expect en 75 y el nombre del test claro.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/shipping.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implement `src/lib/shipping.ts`**

```ts
// src/lib/shipping.ts — envío a Cuba POR LIBRA + sales tax. Puro y compartido
// cliente/servidor (mismo patrón que src/lib/weight.ts): el checkout del
// cliente y el recálculo del server usan EXACTAMENTE esta aritmética
// (regla: cobro = lo mostrado). Decisiones del spec Bloque 1 (2026-07-17):
// aéreo $3.50/lb; buffer max(15%, 1 lb) que cubre caja+protección — si al
// pesar real sobra, se acredita al saldo (flujo de pesaje llega en B2);
// tax 7.5% (Tampa/Hillsborough: 6% FL + 1.5% county) sobre productos.
// Knobs NEXT_PUBLIC_ para que cliente y server vean el mismo número.

export type ShipVia = "aereo" | "maritimo";

const DEFAULT_AEREO_CENTS_PER_LB = 350;
const DEFAULT_TAX_PCT = 7.5;

function envInt(name: string): number | null {
  const v = process.env[name];
  if (v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function shipRateCentsPerLb(via: ShipVia): number | null {
  if (via === "aereo") return envInt("NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB") ?? DEFAULT_AEREO_CENTS_PER_LB;
  return envInt("NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB"); // sin knob → vía oculta
}

export interface ShipQuote {
  est_lb: number;
  buffer_lb: number;
  chargeable_lb: number;
  rate_cents_per_lb: number;
  ship_cents: number;
}

/** Cotiza el envío por libra. buffer = max(15% del estimado, 1 lb) y se cobra
 * el ceil a libra completa. estLb=0 (carrito vacío) → todo 0. null si la vía
 * no tiene tarifa configurada. */
export function shipQuote(estLb: number, via: ShipVia): ShipQuote | null {
  const rate = shipRateCentsPerLb(via);
  if (rate === null) return null;
  if (estLb <= 0) return { est_lb: 0, buffer_lb: 0, chargeable_lb: 0, rate_cents_per_lb: rate, ship_cents: 0 };
  const buffer = Math.max(0.15 * estLb, 1);
  const chargeable = Math.ceil(estLb + buffer);
  return {
    est_lb: Math.round(estLb * 10) / 10,
    buffer_lb: Math.round(buffer * 10) / 10,
    chargeable_lb: chargeable,
    rate_cents_per_lb: rate,
    ship_cents: chargeable * rate,
  };
}

export function taxPct(): number {
  const v = process.env.NEXT_PUBLIC_SALES_TAX_PCT;
  if (v === undefined || v === "") return DEFAULT_TAX_PCT;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TAX_PCT;
}

/** Línea "Impuestos de compra (FL)" — % sobre el subtotal de PRODUCTOS. */
export function taxCents(productSubtotalCents: number): number {
  return Math.round(productSubtotalCents * (taxPct() / 100));
}
```

- [ ] **Step 4: `.env.example`** — añadir al bloque de knobs:

```bash
# Envío a Cuba por libra (centavos/lb). Aéreo default $3.50; marítimo VACÍO =
# la vía no se ofrece hasta tener tarifa real. NEXT_PUBLIC_: cliente y server
# comparten el número (cobro = lo mostrado).
NEXT_PUBLIC_SHIP_AEREO_CENTS_PER_LB=350
NEXT_PUBLIC_SHIP_MARITIMO_CENTS_PER_LB=
# Sales tax % que Yosvany paga al comprar (Tampa/Hillsborough = 6 + 1.5).
NEXT_PUBLIC_SALES_TAX_PCT=7.5
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/shipping.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shipping.ts tests/unit/shipping.test.ts .env.example
git commit -m "feat(checkout): shipping.ts — envío por libra con buffer y sales tax, puro y compartido"
```

---

### Task 9: checkout-core — vías reales por libra (adiós tarifa plana y envío gratis)

**Files:**
- Modify: `src/components/tuki/checkout-core.ts` (SHIP/shipOptions, líneas 6-66)
- Test: `tests/unit/checkout-core.test.ts` (crear si no existe; si existe, extender)

**Interfaces:**
- Consumes: `shipQuote`, `shipRateCentsPerLb` (Task 8), `estimateDeliveryForCart` (existente).
- Produces (Task 10 consume): `ShipMethod.id` pasa a `"aereo" | "maritimo"`; `shipOptions(weightLb, sources)` (sin `subtotalCents` ni `freeCents`) devuelve solo vías CON tarifa, cada una con `quote: ShipQuote` y días `d1/d2`. Se eliminan `blocked/reason/maxLb/minLb/effectivePriceCents` (el por-libra escala con el peso; ya no hay gates).

- [ ] **Step 1: Write the failing test** — `tests/unit/checkout-core.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { shipOptions } from "@/components/tuki/checkout-core";

describe("shipOptions por libra", () => {
  test("solo aéreo cuando marítimo no tiene tarifa (default env)", () => {
    const opts = shipOptions(2.5, ["shein"]);
    expect(opts.map((o) => o.id)).toEqual(["aereo"]);
    expect(opts[0].quote.ship_cents).toBe(4 * 350); // ceil(2.5+1)=4 lb
    expect(opts[0].d1).toBeGreaterThan(0);
  });
  test("carrito vacío → quote en 0", () => {
    expect(shipOptions(0, [])[0].quote.ship_cents).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/checkout-core.test.ts`
Expected: FAIL (la firma vieja pide subtotal y devuelve rapido/estandar/lento).

- [ ] **Step 3: Implement** — reemplazar en `checkout-core.ts` el bloque `ShipMethod`/`SHIP`/`GROUP_FACTOR`/`ShipOption`/`shipOptions` completo por:

```ts
import { estimateDeliveryForCart } from "@/lib/delivery";
import { shipQuote, shipRateCentsPerLb, type ShipQuote, type ShipVia } from "@/lib/shipping";

export type ShipId = ShipVia;

export interface ShipOption {
  id: ShipVia;
  icon: string;
  name: string;
  sub: string;
  quote: ShipQuote;
  d1: number;
  d2: number;
  reco?: boolean;
}

const VIA_META: Record<ShipVia, { icon: string; name: string; sub: string; reco?: boolean }> = {
  aereo: { icon: "✈️", name: "Aéreo", sub: "en avión — se cobra por libra", reco: true },
  maritimo: { icon: "🚢", name: "Marítimo", sub: "en barco — más barato, ideal para lo pesado" },
};

/** Vías de envío reales (spec B1): precio = libras cobrables × tarifa/lb
 * (ver src/lib/shipping.ts). Una vía sin tarifa configurada NO se ofrece.
 * Días honestos de src/lib/delivery.ts según las tiendas del carrito. */
export function shipOptions(weightLb: number, sources: (string | null | undefined)[] = []): ShipOption[] {
  return (["aereo", "maritimo"] as const)
    .filter((via) => shipRateCentsPerLb(via) !== null)
    .map((via) => {
      const days = estimateDeliveryForCart(sources, via);
      return { id: via, ...VIA_META[via], quote: shipQuote(weightLb, via)!, d1: days.minDays, d2: days.maxDays };
    });
}
```

(`validateShipping`, `etaLine`, `validateBilling` quedan igual.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test:unit -- tests/unit/checkout-core.test.ts && pnpm typecheck`
Expected: test PASS; typecheck FALLARÁ en `CheckoutFlow.tsx` y `CartDrawer.tsx` — es lo esperado, Tasks 10-11 los arreglan. NO commitear typecheck roto: hacer Tasks 9-11 en secuencia y commitear juntas si hace falta, o commitear ya con `CheckoutFlow` aún sin tocar SOLO si typecheck pasa. Regla práctica: si typecheck falla, seguir a Task 10 y commitear al final de la 11.

---

### Task 10: CheckoutFlow — totales con tax + desglose por libra + resumen con miniatura

**Files:**
- Modify: `src/components/tuki/CheckoutFlow.tsx` (totales :150-158, paso 2 :393-445, confirm :196-215 y 409 :221-238, resumen :566-596)

**Interfaces:**
- Consumes: `shipOptions` v2 (Task 9), `taxCents`/`taxPct` (Task 8).
- Produces: el POST a `/api/checkout/anonymous` manda `shipping.via` (en vez de `metodo`) + `shipping.ship_total_cents` + `shipping.tax_cents` (lo que la UI mostró — Task 11 los valida server-side).

- [ ] **Step 1: Totales** — reemplazar el bloque :152-158 por:

```ts
  const opts = shipOptions(weightLb, items.map((i) => i.source));
  const [shipSel, setShipSel] = useState<ShipId>("aereo"); // mover el useState existente y cambiar default
  const sel: ShipId = opts.some((o) => o.id === shipSel) ? shipSel : "aereo";
  const cur = opts.find((o) => o.id === sel)!;
  const shipCostCents = items.length ? cur.quote.ship_cents : 0;
  const taxCentsShown = taxCents(effectiveSubtotal);
  const totalCents = effectiveSubtotal + taxCentsShown + shipCostCents;
  const wS = weightLb.toFixed(1).replace(".0", "");
```

(El `useState<ShipId>("estandar")` de la línea 139 se elimina de ahí; imports: `taxCents`, `taxPct` de `@/lib/shipping`; el tipo `ShipId` ahora viene de checkout-core v2.)

- [ ] **Step 2: Paso 2 (método de envío)** — dentro del `opts.map((s) => {...})`, quitar `blocked`/`reason`/`effectivePriceCents`/`req` y pintar el por-libra:

```tsx
                {opts.map((s) => {
                  const on = sel === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setShipSel(s.id)}
                      style={{ position: "relative", background: "#fff", borderRadius: 18, border: `1.5px solid ${on ? "#1C1D20" : "#EFEFEA"}`, padding: "16px 18px", cursor: "pointer", transition: "border-color .2s" }}
                    >
                      {s.reco && (
                        <div style={{ position: "absolute", top: -10, right: 16, background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "3px 11px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px" }}>la que más eligen</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                        <div style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "#1C1D20" : "#D8D8D3"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {on && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1C1D20" }} />}
                        </div>
                        <span style={{ fontSize: 21 }}>{s.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{s.name}</span>
                            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12.5, color: "#8E8F94" }}>{s.sub}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#55565B", marginTop: 3 }}>{etaLine(s.d1, s.d2)}</div>
                        </div>
                        <div style={{ flex: "none", textAlign: "right" }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700 }}>{fmt(s.quote.ship_cents)}</div>
                          <div style={{ fontSize: 10.5, color: "#8E8F94", marginTop: 2 }}>
                            {s.quote.chargeable_lb} lb × {fmt(s.quote.rate_cents_per_lb)}/lb
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
```

y el subtítulo del paso (:397) cambia a:

```tsx
                tu caja pesa <span style={{ fontWeight: 700, color: "#1C1D20" }}>{wS} lb</span> — el envío se cobra por libra, con un colchón que cubre caja y protección; si al pesarla real sobra, se te acredita al saldo
```

- [ ] **Step 3: POST del confirm** — en el body del fetch (:204-214), reemplazar `metodo: sel` por:

```ts
            via: sel,
            ship_total_cents: shipCostCents,
            tax_cents: taxCentsShown,
```

- [ ] **Step 4: manejar 409 `totals_changed`** — tras el bloque existente de `price_changed` (:221-238), añadir:

```ts
      if (res.status === 409) { /* bloque price_changed existente… */ }
      // (añadir DESPUÉS, como else-if sobre body.code — unificar: leer el body
      // UNA vez y ramificar por code)
```

Concretamente: cambiar el manejo del 409 para leer `body.code`:

```ts
      if (res.status === 409) {
        const body = (await res.json()) as
          | { code: "price_changed"; items: { product_id: string; color: string | null; size: string | null; shown_cents: number; current_cents: number }[] }
          | { code: "totals_changed"; ship_total_cents: number; tax_cents: number };
        if (body.code === "totals_changed") {
          // El server recalculó peso/tarifa/tax y difiere de lo mostrado
          // (p. ej. el peso del producto se actualizó tras el pesaje admin).
          // Se actualiza VISIBLEMENTE y se pide re-confirmar (REGLA DE ORO).
          setServerTotals({ ship: body.ship_total_cents, tax: body.tax_cents });
          toast("el envío o los impuestos cambiaron — revisa el total y confirma de nuevo");
          setPending(false);
          return;
        }
        /* …bloque price_changed existente, igual que hoy… */
      }
```

con el estado nuevo (junto a los otros useState):

```ts
  const [serverTotals, setServerTotals] = useState<{ ship: number; tax: number } | null>(null);
```

y los totales del Step 1 pasan a preferirlo:

```ts
  const shipCostCents = items.length ? (serverTotals?.ship ?? cur.quote.ship_cents) : 0;
  const taxCentsShown = serverTotals?.tax ?? taxCents(effectiveSubtotal);
```

(Resetear `setServerTotals(null)` cuando cambian items o `sel` — un `useEffect([ids, sel])` de una línea.)

- [ ] **Step 5: Resumen lateral** (:566-596) — items con miniatura + título recortado, filas nuevas y fold nativo:

```tsx
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {items.map((ri) => {
              const meta = [ri.color, ri.size, ri.source].filter(Boolean).join(" · ");
              return (
                <div key={ri.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, color: "#55565B" }}>
                  <div style={{ flex: "none", width: 40, height: 40, borderRadius: 10, background: stripe(catOf(ri.category)), overflow: "hidden" }}>
                    {ri.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ri.image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                  </div>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
                      {ri.qty}× {ri.title}
                    </div>
                    {meta && <div style={{ fontSize: 11, color: "#B0B1AE", marginTop: 1 }}>{meta}</div>}
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(ri.price_cents * ri.qty)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ height: 1, background: "#F1F1EE", margin: "14px 0" }} />
          <Row label="Subtotal" value={fmt(effectiveSubtotal)} />
          <Row label={`Impuestos de compra (FL ${taxPct()}%)`} value={fmt(taxCentsShown)} />
          <Row label={`Envío · ${cur.name.toLowerCase()}`} value={fmt(shipCostCents)} />
          <details style={{ margin: "4px 0 0" }}>
            <summary style={{ fontSize: 11.5, color: "#8E8F94", cursor: "pointer" }}>ver desglose del envío</summary>
            <div style={{ fontSize: 11.5, color: "#8E8F94", marginTop: 4, lineHeight: 1.5 }}>
              {cur.quote.est_lb} lb estimadas + {cur.quote.buffer_lb} lb de colchón (caja y protección) →{" "}
              {cur.quote.chargeable_lb} lb × {fmt(cur.quote.rate_cents_per_lb)}/lb.
              <br />si al pesar tu paquete real sobra, la diferencia se acredita a tu saldo.
            </div>
          </details>
```

(imports: `stripe`, `catOf` ya existen en `lib.ts`; verificar que CheckoutFlow los importa.)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: queda roto SOLO por `CartDrawer.tsx` (SHIP/FREE) y el server (`metodo`) — Tasks 11-12. Si hay más errores, arreglarlos aquí.

---

### Task 11: Server — recalcular envío+tax, validar contra lo mostrado, guardar desglose

**Files:**
- Modify: `src/app/api/checkout/anonymous/route.ts` (zod shipping :13-33, manejo de error)
- Modify: `src/sectors/a-tracking/checkout-anonymous.ts` (SHIP_PRICE_CENTS :24-29, totales :104-118)
- Modify: `src/sectors/a-tracking/checkout-schema.ts` (error nuevo)
- Test: `tests/unit/checkout-schema.test.ts`

**Interfaces:**
- Consumes: `shipQuote`/`taxCents` (Task 8), `estimateWeightGrams`/`gramsToLb` (`@/lib/weight`), body nuevo de Task 10 (`via`, `ship_total_cents`, `tax_cents`).
- Produces: `TotalsChangedError { ship_total_cents, tax_cents }` → HTTP 409 `{code:"totals_changed", ...}`. `orders.shipping` jsonb guarda `{ via, est_lb, buffer_lb, chargeable_lb, rate_cents_per_lb, ship_cents, tax_cents, ...datos del form }`. `total_charged_cents` sigue siendo SOLO productos (como hoy).

- [ ] **Step 1: Write the failing test** — en `tests/unit/checkout-schema.test.ts`:

```ts
import { TotalsChangedError } from "@/sectors/a-tracking/checkout-schema";

describe("TotalsChangedError", () => {
  test("lleva los totales recalculados por el server", () => {
    const e = new TotalsChangedError(4200, 750);
    expect(e.ship_total_cents).toBe(4200);
    expect(e.tax_cents).toBe(750);
    expect(e.message).toBe("totals_changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test:unit -- tests/unit/checkout-schema.test.ts` → FAIL.

- [ ] **Step 3: Implement** — en `checkout-schema.ts`, junto a `PriceChangedError`:

```ts
/** El envío/tax que la UI mostró ya no cuadra con el recálculo server-side
 * (peso actualizado, knob de tarifa/tax cambiado entre pintado y confirm).
 * Misma filosofía que PriceChangedError: 409 ANTES de tocar la DB. */
export class TotalsChangedError extends Error {
  constructor(
    readonly ship_total_cents: number,
    readonly tax_cents: number,
  ) {
    super("totals_changed");
    this.name = "TotalsChangedError";
  }
}
```

En `checkout-anonymous.ts`: borrar `SHIP_PRICE_CENTS` y `FREE_SHIP_THRESHOLD_CENTS`; el input type cambia `metodo?` por `via?: "aereo" | "maritimo"; ship_total_cents?: number; tax_cents?: number`. El `SELECT` de productos añade `weight_grams` (y `ProdRow` gana `weight_grams: number | null`; `metadata` ya viene). Reemplazar el bloque :106-111 por:

```ts
    // Envío POR LIBRA + tax (spec B1) — recalculado server-side con la MISMA
    // aritmética compartida (src/lib/shipping.ts) y el peso de la DB (cascada
    // weight_grams > heurística pura, idéntica a la del cliente).
    const via = input.shipping.via ?? "aereo";
    const grams = lineItems.reduce((s, { item, prod }) => {
      const meta = prod.metadata as { category?: string } | null;
      const g = prod.weight_grams ?? estimateWeightGrams({ title: prod.title, category: meta?.category ?? null }).grams;
      return s + g * item.quantity;
    }, 0);
    const quote = shipQuote(grams === 0 ? 0 : gramsToLb(grams), via);
    if (!quote) throw new Error("bad_via"); // vía sin tarifa: el cliente no debería mandarla
    const tax = taxCents(totalCharged);
    if (
      (input.shipping.ship_total_cents !== undefined && input.shipping.ship_total_cents !== quote.ship_cents) ||
      (input.shipping.tax_cents !== undefined && input.shipping.tax_cents !== tax)
    ) {
      throw new TotalsChangedError(quote.ship_cents, tax);
    }
    const shippingWithPrice = { ...input.shipping, ...quote, via, tax_cents: tax };
```

Imports: `shipQuote, taxCents` de `@/lib/shipping`; `estimateWeightGrams, gramsToLb` de `@/lib/weight`; `TotalsChangedError` de `./checkout-schema`.

En la ruta (`route.ts`): zod shipping — `metodo: z.enum(["rapido","estandar","lento"])` pasa a:

```ts
        via: z.enum(["aereo", "maritimo"]),
        ship_total_cents: z.number().int().min(0),
        tax_cents: z.number().int().min(0),
```

y en el catch:

```ts
    if (e instanceof TotalsChangedError) {
      return NextResponse.json(
        { code: "totals_changed", ship_total_cents: e.ship_total_cents, tax_cents: e.tax_cents },
        { status: 409 },
      );
    }
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm test:unit && pnpm typecheck`. Queda pendiente solo CartDrawer (Task 12); si typecheck ya pasa, commitear:

```bash
git add src/components/tuki/CheckoutFlow.tsx src/components/tuki/checkout-core.ts src/app/api/checkout/anonymous/route.ts src/sectors/a-tracking/checkout-anonymous.ts src/sectors/a-tracking/checkout-schema.ts tests/unit/checkout-core.test.ts tests/unit/checkout-schema.test.ts
git commit -m "feat(checkout): envío por libra con buffer + sales tax 7.5% — recálculo server-side y 409 totals_changed"
```

---

### Task 12: CartDrawer — estimado por libra, sin envío gratis

**Files:**
- Modify: `src/components/tuki/CartDrawer.tsx` (:13-14, :117-126, :223-228, footer)

- [ ] **Step 1: Implement** — borrar `const FREE = 5000; const SHIP = 499;` (:13-14). Reemplazar :117-126 por:

```ts
  const cartHas = items.length > 0;
  // Estimado honesto por libra — misma aritmética que el checkout (shipping.ts)
  const quote = shipQuote(weightLb, "aereo");
  const ship = cartHas && quote ? quote.ship_cents : 0;
  const totF = fmt(subtotal + ship);
  const shipF = fmt(ship);
  const upsellLine = "y esto le encanta a gente como tú…";
  const cartIds = new Set(items.map((i) => i.product_id));
  const upsellShown = upsell.filter((p) => !cartIds.has(p.id));
```

Import: `shipQuote` de `@/lib/shipping`. Borrar el card de progreso a envío gratis (:223-228, el `<div>` con `freeLine`/`freePct`). En el footer, localizar las filas que usan `shipF`/`shipColor`/`totF` (después de la línea 274): quitar `shipColor` (usar `#55565B` fijo), renombrar la fila de envío a `Envío estimado (aéreo)`, y clamp del título del item (:248):

```tsx
<div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{nameVar}</div>
```

- [ ] **Step 2: Typecheck + unit** — `pnpm typecheck && pnpm test:unit` → PASS (ya no debe quedar nada roto de Tasks 9-11).

- [ ] **Step 3: Commit**

```bash
git add src/components/tuki/CartDrawer.tsx
git commit -m "feat(cart): drawer con envío estimado por libra — fuera envío gratis y tarifa plana"
```

---

### Task 13: PDP — título con clamp + "ver completo", link a la tienda, copy de envío

**Files:**
- Modify: `src/storefront/contract.ts` (StorefrontCard)
- Modify: `src/storefront/map.ts` (toCard)
- Modify: `src/components/tuki/ProductView.tsx` (breadcrumb :306, título :356, fila source :357-360, accordion ship :286-291)

**Interfaces:**
- Consumes: `products.url` — YA lo devuelve `getById` (`src/sectors/b-catalog/repository/products.ts`).
- Produces: `StorefrontCard.url?: string | null`.

- [ ] **Step 1: Contract + map** — en `contract.ts` (después de `source`):

```ts
  // products.url — link a la ficha original en la tienda ("Ver en la tienda ↗").
  url?: string | null;
```

En `map.ts`, el input type de `toCard` gana `url?: string | null;` y en el objeto retornado (junto a `weight_grams`):

```ts
    ...(product.url ? { url: product.url } : {}),
```

- [ ] **Step 2: ProductView** — título (:356) con clamp + toggle. Añadir estado arriba del return (`const [titleFull, setTitleFull] = useState(false);` — `useState` ya está importado) y reemplazar la línea del título:

```tsx
          <div
            style={{
              fontFamily: "var(--font-brico)", fontSize: 34, fontWeight: 700, letterSpacing: "-0.7px", marginTop: 10, lineHeight: 1.1,
              ...(titleFull ? {} : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }),
            }}
          >
            {card.title}
          </div>
          {card.title.length > 90 && (
            <div onClick={() => setTitleFull((v) => !v)} style={{ fontSize: 12, color: "#8E8F94", cursor: "pointer", textDecoration: "underline", marginTop: 4 }}>
              {titleFull ? "ver menos" : "ver título completo"}
            </div>
          )}
```

Breadcrumb (:306) — el título completo pasa a 1 línea con ellipsis:

```tsx
        / <span style={{ color: "#1C1D20", fontWeight: 600, display: "inline-block", maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{card.title}</span>
```

Fila de source (:357-360) — añadir el link cuando hay URL:

```tsx
          <div style={{ fontSize: 13.5, color: "#8E8F94", marginTop: 8 }}>
            {rl ? `${rl} · llega ${deliveryPhrase(air)}` : `llega ${deliveryPhrase(air)}`}
            {card.source && ` · de ${card.source}`}
            {card.url && (
              <>
                {" · "}
                <a href={card.url} target="_blank" rel="noopener noreferrer" style={{ color: "#55565B", textDecoration: "underline" }}>
                  ver en la tienda ↗
                </a>
              </>
            )}
          </div>
```

Accordion "Envío y devoluciones" (:288-290) — actualizar el copy al por-libra real:

```tsx
          Vía aérea: llega {deliveryPhrase(air)}. Vía marítima: {deliveryPhrase(sea)} (más económica, ideal para
          pedidos pesados). Fechas estimadas según la tienda de origen ({card.source}). El envío a Cuba se cobra
          por libra ({fmt(shipRateCentsPerLb("aereo") ?? 0)}/lb vía aérea) con un colchón que cubre caja y
          protección — si al pesar tu paquete sobra, se te acredita al saldo. Devolución sin costo dentro de 30
          días: la recogemos en tu puerta.
```

Import en ProductView: `shipRateCentsPerLb` de `@/lib/shipping` (y `fmt` ya está).

- [ ] **Step 3: Typecheck** — `pnpm typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/storefront/contract.ts src/storefront/map.ts src/components/tuki/ProductView.tsx
git commit -m "feat(pdp): título con clamp y ver-completo, link a la tienda de origen, copy honesto del envío por libra"
```

---

### Task 14: Script de medición Welcome Deal

**Files:**
- Create: `scripts/measure-price-gap.ts`
- Modify: `package.json` (npm script `measure:price-gap`)

**Interfaces:**
- Consumes: `withPgDirect`, `fetchDetailJson`, parsers de `revalidate.ts`.
- Produces: CSV en stdout con columnas `source,id,title,stored_cents,api_cents,url,browser_anon,browser_logged` (las 2 últimas vacías — Yosvany las llena navegando). Modo `--report <archivo.csv>` que lee el CSV llenado e imprime el gap % por fuente.

- [ ] **Step 1: Create `scripts/measure-price-gap.ts`**

```ts
// scripts/measure-price-gap.ts — decisión "medir primero" (spec B1, 2026-07-17):
// ¿el precio de la API trae Welcome Deal escondido? Compara stored vs API en
// ~16 productos y deja 2 columnas para que Yosvany llene navegando (anónimo y
// logueado). Uso:
//   pnpm tsx scripts/measure-price-gap.ts > /tmp/price-gap.csv     (fase 1)
//   pnpm tsx scripts/measure-price-gap.ts --report /tmp/price-gap.csv  (fase 2)
// OJO cuota: pega al detalle RapidAPI — máx 4 por fuente por corrida.
import { readFileSync } from "node:fs";
import { withPgDirect } from "@/lib/db/helpers";
import {
  fetchDetailJson,
  parseAmazonDetail,
  parseAliexpressDetail,
  parseWalmartDetail,
  parseSheinDetail,
} from "@/sectors/b-catalog/revalidate";

const PER_SOURCE = 4;

function parse(source: string, json: unknown) {
  switch (source) {
    case "amazon": return parseAmazonDetail(json);
    case "aliexpress": return parseAliexpressDetail(json);
    case "walmart": return parseWalmartDetail(json);
    case "shein": return parseSheinDetail(json);
    default: return null;
  }
}

async function measure() {
  const rows = await withPgDirect(async (pg) => {
    const r = await pg.query<{ source: string; source_product_id: string; title: string; price_cents: number; url: string | null }>(
      `SELECT DISTINCT ON (source, source_product_id) source, source_product_id, title, price_cents, url
       FROM (
         SELECT source, source_product_id, title, price_cents, url,
                row_number() OVER (PARTITION BY source ORDER BY last_refreshed_at DESC) AS rn
         FROM products WHERE is_active = true AND url IS NOT NULL
       ) t WHERE rn <= $1
       ORDER BY source, source_product_id`,
      [PER_SOURCE],
    );
    return r.rows;
  });
  console.log("source,id,title,stored_cents,api_cents,url,browser_anon,browser_logged");
  for (const row of rows) {
    let api = "";
    try {
      const fetched = await fetchDetailJson({ source: row.source, source_product_id: row.source_product_id, url: row.url });
      const detail = fetched ? parse(row.source, fetched.json) : null;
      api = detail ? String(detail.price_cents) : "ERROR";
    } catch {
      api = "ERROR";
    }
    const title = row.title.replaceAll('"', "'").slice(0, 60);
    console.log(`${row.source},${row.source_product_id},"${title}",${row.price_cents},${api},${row.url},,`);
  }
}

function report(file: string) {
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
  const bySource = new Map<string, { n: number; gapApi: number[]; gapAnon: number[] }>();
  for (const line of lines) {
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const [source, , , stored, api, , anon] = cols;
    const s = bySource.get(source) ?? { n: 0, gapApi: [], gapAnon: [] };
    s.n++;
    const st = parseInt(stored, 10);
    if (api && api !== "ERROR") s.gapApi.push((parseInt(api, 10) - st) / st);
    if (anon) s.gapAnon.push((parseFloat(anon) * 100 - st) / st); // browser en $ → centavos
    bySource.set(source, s);
  }
  const pct = (xs: number[]) => (xs.length ? `${((xs.reduce((a, b) => a + b, 0) / xs.length) * 100).toFixed(1)}%` : "sin datos");
  for (const [source, s] of bySource) {
    console.log(`${source}: n=${s.n} · gap API vs stored: ${pct(s.gapApi)} · gap navegador-anónimo vs stored: ${pct(s.gapAnon)}`);
  }
  console.log("\ngap negativo grande en navegador-anónimo = Welcome Deal visible que la API no da (o viceversa).");
}

const reportIdx = process.argv.indexOf("--report");
if (reportIdx > -1) report(process.argv[reportIdx + 1]);
else measure().then(() => process.exit(0));
```

- [ ] **Step 2: npm script** — en `package.json`, junto a los otros scripts:

```json
"measure:price-gap": "tsx scripts/measure-price-gap.ts",
```

- [ ] **Step 3: Smoke run (gasta ~12-16 llamadas de cuota — correr UNA vez)**

Run: `pnpm measure:price-gap | head -20`
Expected: CSV con header + filas; `api_cents` numérico o ERROR (DataHub puede dar 205 — eso también es dato).

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-price-gap.ts package.json
git commit -m "feat(pricing): script de medición welcome-deal — API vs navegador, decisión con datos"
```

---

### Task 15: Verificación final del bloque

**Files:** ninguno nuevo (verificación).

- [ ] **Step 1: Suite completa** — `pnpm typecheck && pnpm lint && pnpm test:unit` → todo PASS.
- [ ] **Step 2: Verificación manual con la skill `verify`** (contra `next start`, no dev — regla del proyecto):
  1. Pegar la URL real de Shein del spec → debe mostrar "pidiéndole el producto a la tienda…", poll, y al no resolver caer a resultados por slug con el aviso ámbar (nunca vacío seco).
  2. Pegar la URL real de AliExpress del spec → parser extrae `1005012390649037` (verificar en network tab); pending → fallback (sin slug → aviso "no pudimos leer ese enlace").
  3. Buscar el título literal de las diademas de Shein → dispara ingesta (banner en vivo visible) y trae resultados.
  4. Buscar "mini camera 1080p" → banner "buscando en vivo" visible mientras poll, badge "+N nuevos" al llegar los baratos.
  5. PDP: título largo con clamp + "ver título completo"; link "ver en la tienda ↗" abre la tienda.
  6. Carrito → checkout: envío = libras × $3.50 con desglose en fold, línea de impuestos 7.5%, total = subtotal + tax + envío; confirmar pedido crea la orden y `orders.shipping` guarda el desglose (verificar con `SELECT shipping FROM orders ORDER BY created_at DESC LIMIT 1`).
- [ ] **Step 3: Commit final si la verificación tocó algo**, y parar: la decisión de merge/PR es de Yosvany (skill finishing-a-development-branch).

## Self-review del plan (hecho al escribirlo)

- Spec A.1-A.4 → Tasks 1-5. Spec B.1 → verificado ya implementado (`search.ts:235` pasa `search_terms` a BM25); B.2 → Task 6. Spec C → Task 7 (C.3 cubierto: force → `calledMock=true` → polling). Spec D.1 → Tasks 8-12; D.2 → Tasks 8, 10, 11; D.3 → copy en Tasks 10/12/13 (el acredite real es B2); D.4 → Task 11; D.5 → Tasks 10, 12, 13; D.6 → Task 13. Spec E → Task 14. Testing del spec → pasos TDD + Task 15.
- Sin TBDs; los puntos de fricción conocidos van marcados en el código (cuota en polls, Set en memoria, orden Task 5/7 con `setNewCount`).
- Tipos cruzados verificados: `ShipQuote`/`ShipVia` (T8) ≡ usos en T9-13; `via/ship_total_cents/tax_cents` idénticos en cliente (T10), zod (T11) y jsonb (T11).
