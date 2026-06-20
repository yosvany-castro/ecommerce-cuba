# Spec de diseño — Storefront Contract (capa intermedia para la UI)

**Fecha:** 2026-06-20
**Rama:** `feat/thesis-personalization-program`
**Estado:** diseño aprobado (pendiente de revisión del spec escrito → plan de implementación)

---

## 1. Objetivo

Exponer una **capa intermedia (fachada / contrato tipado)** que absorba toda la complejidad
interna del motor —slate (`composePage`/`resolveSections`), personalización (pgvector → RRF →
MMR → reranker LLM), NPMI, popularidad, placements del agente merchandiser, y la frontera
sim/prod— y la presente como un **contrato simple y estable**: "pido el home / el producto / el
carrito y recibo qué pintar".

Con ese contrato **listo y documentado**, otro equipo (de agentes) construye la **capa visual**
(ProductCard, destacados, relacionados, cart…) conociendo **solo el contrato**, sin tocar ni
entender el motor.

## 2. Decisión arquitectónica clave (y corrección de rumbo)

La intención del usuario —"una capa que oculte la complejidad detrás de algo simple, como pedir
al API"— es **correcta y está validada por la industria** (patrón SDUI / view-model: Airbnb,
DoorDash, Shop app). Pero la primera propuesta la enmarcó como un **BFF + tier REST**
(`GET /api/storefront/*`), y la investigación (6 agentes con fuentes; 5 validadores adversariales,
todos "ajustar" con confianza alta) demostró que eso es **sobre-ingeniería** para este caso.

**El contrato NO es un API HTTP — es un Data Access Layer (DAL): un módulo tipado server-only que
los Server Components importan directamente.**

- La app visual vive en **la MISMA app Next.js** y es **el único consumidor**. No hay múltiples
  clientes (iOS/Android/web) ni frontera de organización ni agregación sobre HTTP — ninguna de las
  justificaciones del patrón BFF (Newman/SoundCloud) aplica.
- Guía oficial de Next.js: *"If your data is only used inside your Next.js app, you may not need a
  public API at all"* y *"Fetch data in Server Components directly from its source, not via Route
  Handlers."* Que el home SSR se haga `fetch` a sí mismo por HTTP es un **anti-patrón documentado**
  (falla el build en rutas prerenderizadas / round-trip extra).
- El repo **ya implementa la forma correcta**: el home RSC importa `composePage`/`resolveSections`
  directo (`src/app/(shop)/page.tsx:42-43`); REST existe **solo** en las fronteras reales de
  client-fetch (`/api/feed/page` para paginación de `InfiniteFeed`; `/api/slate/resolve` para
  cross-sell de PDP y cart, que leen `localStorage`). Eso ya es "DAL-first, REST-by-exception".

**El valor real del trabajo no es construir transporte, sino consolidar un contrato ya disperso.**
El mismo DTO está **duplicado a mano en 3 sitios** y debe unificarse:
- `SectionCardDTO` en `src/sectors/f-slate/sections/types.ts:7-16`
- `FeedCardDTO` inline en `src/app/api/feed/page/route.ts`
- `SectionDTO` inline en `src/components/slate/SurfaceSections.tsx`

El motor **ya emite ~80% del contrato**: `ResolvedSection` ya trae `placement_id`, `section_type`,
`slate_id`, `slot`, `outcome`, `next_cursor`; `ComposedPage` ya trae `composition_id`,
`config_version`, `config_source`, `is_logged_in`. `map.ts` mayormente **renombra y proyecta**, no
inventa.

## 3. Por qué un view-model (y no recursos normalizados como los líderes)

Los 6 líderes headless (Shopify, Medusa, Saleor, commercetools, Vendure, BigCommerce) devuelven
**recursos normalizados** porque sirven a clientes externos desconocidos. Este proyecto es el caso
**inverso**: un equipo visual in-house + un motor de personalización cuyo valor **es** decidir la
colocación/orden por el servidor. Un agregado presentation-leaning (envelope de secciones +
ProductCard) es la **inversión deliberada y validada** (SDUI) — es la justificación más fuerte de
que esta fachada exista. Se declara explícitamente como decisión consciente.

## 4. El contrato (`src/storefront/contract.ts`)

```ts
export type Surface = "home" | "product" | "cart" | "search";

export interface StorefrontPage {
  surface: Surface;
  sections: StorefrontSection[];
  meta: {
    composition_id: string;
    config_version: string;
    personalized: boolean;
    is_logged_in: boolean;
    degraded: boolean; // config_source === "fallback" (motor en modo defensa)
  };
}

export interface StorefrontSection {
  id: string;                 // = placement_id
  section_type: string;       // CLAVE PRIMARIA de dispatch + identidad de analytics
                              // (hero_grid | popular | cross_sell | cart_addons | …)
  layout: "hero" | "grid" | "carousel"; // hint SECUNDARIO de render (= display del motor)
  title: string;
  outcome: "served" | "empty" | "below_min" | "timeout" | "error" | "unknown_type";
  products: ProductCard[];
  pagination?: { next_cursor: string | null; has_next: boolean };
  analytics: { slate_id: string | null; experiment_id: string | null };
}

export interface ProductCard {
  id: string;
  title: string;
  price: { cents: number; currency: string };   // crudo (fuente de verdad); formatea el cliente
  image: { url: string; width?: number; height?: number; alt: string } | null; // NULLABLE
  href: string;                                  // el cliente NO arma URLs
  badge: string | null;                          // semántico (p.ej. razón / "bestseller")
  position: number;                              // = slot*100 + idx + 1 (para el beacon de seen)
}

export interface StorefrontProductPage {
  product: ProductDetail;        // entidad de primer nivel (SEO/JSON-LD)
  sections: StorefrontSection[]; // relacionados / cross-sell
  seo: { title: string; description: string; canonical: string; openGraph: unknown; jsonLd: unknown };
}

export interface ProductDetail {
  id: string;
  title: string;
  description: string;
  price: { cents: number; currency: string };
  image: { url: string; width?: number; height?: number; alt: string } | null;
}
```

### Decisiones D1 / D2 resueltas por la investigación

- **D1 — dispatch por `section_type`, no por `layout`.** Todos los SDUI (Airbnb
  `SectionComponentType`, Apollo TN0042, Sanity `_type`, Builder.io `component.name`, Shopify OS2.0,
  DoorDash Facets) despachan por **tipo semántico** vía un registry en cliente; el layout es un
  concern del cliente. `SlateRenderer.tsx` **ya despacha por `section_type`**. Además `popular`,
  `cross_sell` y `cart_addons` los tres son `display=carousel` (`config.ts:61-63`): mapear por
  layout **colapsaría 3 intenciones de merchandising en una** y mataría la señal de A/B y CTR que la
  tesis mide. → Se llevan **ambos**: `section_type` (clave) + `layout` (hint).
- **D2 — PDP como envelope `{ product, sections }`.** El detalle de producto es entidad de primer
  nivel (drive de SEO/JSON-LD), no una tarjeta en un array. Coincide con todo CMS/commerce y con
  cómo Airbnb modela un `Screen` (campos top-level + lista de secciones).

### Correcciones respecto a la propuesta inicial (con fundamento)

| Propuesta inicial | Corrección | Fundamento |
|---|---|---|
| `price.formatted` (string) como fuente | `price: { cents, currency }` crudo; formatear en cliente con `Intl.NumberFormat('es-CU')`; `formatted` solo como conveniencia opcional | Los 6 líderes devuelven dinero crudo; Shopify envía `useMoney` para formatear en cliente. El repo ya usa `price_cents`+`currency`. |
| `image_url: string` único no-nulo | `image` como objeto `{ url, width?, height?, alt }` **o `null`** | `image_url` es **nullable** en el catálogo (`b-catalog/repository/products.ts`); `alt` (a11y) y dimensiones (anti-CLS) son estándar. |
| Dispatch por `layout` | Dispatch por `section_type`; `layout` secundario | (D1, arriba) |
| BFF + `GET /api/storefront/*` | DAL server-only; REST solo en las 2 fronteras client-fetch que ya existen | (sección 2) |

### v1 MUST-HAVE no-negociable: identidad de analytics

La métrica de la tesis es **seen/CTR uplift**. El beacon `/api/feed/seen` exige `{ slate_id,
positions }`. Si el contrato no lleva `composition_id`/`slate_id` (página + por sección) y
`position` (por tarjeta), **la capa visual no puede confirmar impresiones y el funnel se apaga**.
Añadirlo después rompe cada componente. Por eso `meta.composition_id`, `section.analytics.slate_id`
y `ProductCard.position` están en v1.

## 5. Estructura de módulos

```
src/storefront/
  contract.ts        ← DTOs públicos (lo ÚNICO que importa el equipo visual). Sin server-only:
                       son tipos, se pueden importar desde cliente.
  identity.ts        ← resuelve { user_id, anonymous_id, session_id } desde la request (Auth0+cookies)
  map.ts             ← `import "server-only"`. ÚNICA proyección ComposedPage+ResolvedSection → DTOs:
                       formatea href, deriva layout desde section_type, arma image {url,alt,w,h},
                       adjunta badge + identidad de analytics + position. (Mata los 3 DTOs duplicados.)
  pages/
    home.ts          ← `import "server-only"`. getHomePage(req): Promise<StorefrontPage>
    product.ts       ← getProductPage(id, req): Promise<StorefrontProductPage>
    cart.ts          ← getCartPage(req): Promise<StorefrontPage>
    search.ts        ← getSearchPage(q, req): Promise<StorefrontPage>
```

- Los **Server Components importan `pages/*` directo** (el home y la PDP RSC ya lo hacen con el
  motor; se reenrutan a través de `map.ts`).
- Las **2 rutas REST existentes** (`/api/slate/resolve`, `/api/feed/page`) se refactorizan para
  llamar a la **misma** `map.ts` (una proyección, dos puntos de entrada) → desaparecen los DTOs
  inline duplicados.
- **NO** se construye un mirror `GET /api/storefront/*` de las páginas SSR.

## 6. Alcance

**v1 (este spec):** `contract.ts`, `identity.ts`, `map.ts`, `pages/{home,product,cart,search}.ts`;
refactor de `/api/slate/resolve` y `/api/feed/page` para usar `map.ts`; identidad de analytics y
`outcome` por sección en el contrato; bloque `seo` en PDP.

**Diferido (el motor/catálogo no lo soporta aún; aditivo, no rompe):** variantes, stock/disponibilidad,
galería, API de transform/srcset de imágenes, multi-moneda/locale, taxonomía de badge más rica.
Coherente con el negocio (reseller sin stock físico → "stock" no es concepto real todavía).
`badge` se modela como valor semántico para que ampliarlo sea aditivo.

**Follow-up de performance (no bloquea, fuera de este spec):** quitar `export const dynamic =
'force-dynamic'` del home (`page.tsx:11`) → PPR/`cacheComponents` (Next 16) + `<Suspense>` leyendo
`cookies()` dentro del boundary, para que el shell quede CDN-cacheable y los huecos personalizados
lleguen por streaming.

## 7. Criterios de éxito

1. El equipo visual puede construir ProductCard/destacados/relacionados/cart importando **solo**
   `contract.ts`, sin importar nada de `f-slate`, `d-personalization` ni `g-agents`.
2. Existe **una sola** definición de los DTOs; los 3 duplicados quedan eliminados.
3. `getHomePage`/`getProductPage`/`getCartPage`/`getSearchPage` devuelven el contrato y los RSC
   actuales siguen renderizando SSR sin hop de red.
4. La capa visual puede disparar el beacon `/api/feed/seen` con `slate_id` + `position` sin lógica
   de negocio.
5. `tsc` limpio; `map.ts`/`pages/*` no filtran internos del motor al bundle cliente (`server-only`).

## 8. Fuentes (investigación 2026-06-20)

- Next.js oficial — *Building APIs with Next.js* / Data Access Layer; *Fetching data* (RSC vs Route Handlers).
- Sam Newman — *Backends for Frontends*; Microsoft Azure Architecture Center — BFF anti-patterns.
- Apollo GraphQL — TN0042 *SDUI client design*; Airbnb Eng — *A deep dive into Airbnb's SDUI*;
  DoorDash — *Generic server-driven UI components*.
- Shopify Storefront API (`MoneyV2`, `ImageTransformInput`, Hydrogen `useMoney`), Online Store 2.0
  JSON templates; Saleor, commercetools, Vendure, BigCommerce, Medusa (money/imagen/paginación).
- Sanity Portable Text (`_type` + `unknownType`), Builder.io `registerComponent`.
