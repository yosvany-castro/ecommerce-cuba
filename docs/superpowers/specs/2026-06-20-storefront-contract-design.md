# Spec — Storefront Contract (capa intermedia para la UI) · versión lazy

**Fecha:** 2026-06-20 · **Rama:** `feat/thesis-personalization-program` · **Estado:** aprobado

> Reescrito tras pasada ponytail: el motor YA emite ~todo el contrato. El valor real no es
> re-vestir DTOs, es **matar el wiring duplicado** detrás de 3 funciones tipadas. El contrato es
> un *trim* de los tipos del motor, no una capa de view-models nueva.

## 1. Objetivo

Una capa fina (`src/storefront/`) que exponga el motor (slate + personalización + agente) como un
**contrato simple y estable** que la capa visual importa sin tocar el motor: "pido el home / el
carrito / las secciones de un producto y recibo qué pintar". Con eso listo y testeado, otros
agentes construyen la UI conociendo solo `contract.ts`.

## 2. Decisión: es un DAL, no un BFF+REST

Validado por la investigación 2026-06-20 (Next.js oficial, Newman, Apollo/Airbnb SDUI, Shopify):
la capa visual vive en la MISMA app Next y es el único consumidor → **funciones tipadas que el
Server Component importa directo** (sin hop HTTP). REST solo para lo que el cliente ya pide hoy
(cart + cross-sell PDP), que **ya tiene ruta**: `/api/slate/resolve`. No se crea ninguna ruta nueva.

## 3. El contrato es un trim de los tipos del motor

El motor ya devuelve `ResolvedSection[]` con `SectionCardDTO`, y esos ya cumplen lo que pedía la
investigación: **dinero raw** (`price_cents`+`currency`, sin string formateado), **imagen nullable**
(`image_url`), **dispatch por `section_type`**, `slate_id`+`position` para el beacon de seen. El
contrato **conserva esos nombres** y solo quita los internals (`slot`, `resolve_ms`). Cero
re-anidado, cero renombrado.

```ts
// src/storefront/contract.ts  (~18 líneas; lo único que importa la capa visual)
export interface StorefrontCard {           // ≡ SectionCardDTO del motor
  id: string;
  title: string;
  price_cents: number;                      // raw (formatea el cliente con Intl)
  currency: string;
  image_url: string | null;                 // nullable
  reason?: string;                          // el "porqué" / badge
  position?: number;                        // el hero ya lo trae (beacon de seen)
}
export interface StorefrontSection {        // ResolvedSection MENOS slot, resolve_ms
  placement_id: string;
  section_type: string;                     // clave de dispatch del cliente
  title: string;
  display: string;                          // "grid" | "carousel" (hint del motor)
  outcome: string;                          // served | empty | below_min | timeout | error | unknown_type
  items: StorefrontCard[];
  next_cursor?: string | null;              // paginación del hero
  slate_id?: string | null;                 // analytics / beacon de seen
}
export interface StorefrontPage {
  composition_id: string;                   // analytics
  surface: string;
  sections: StorefrontSection[];
}
```

**El producto (PDP) no necesita envelope nuevo:** `getById()` ya devuelve un producto limpio
(`{id,title,description,price_cents,currency,image_url,metadata}`). El PDP usa ese + las secciones
de cross-sell. `canonical` para SEO es `/products/${id}`, una línea en la página.

### Qué se descartó (especulativo, sin consumidor — aditivo si algún día hace falta)
`price` anidado, objeto `image{}`, `href`, `badge` (rename de `reason`), `layout` (derivable de
`section_type`+`display`), `analytics.experiment_id`, `meta.{config_version,personalized,is_logged_in,degraded}`,
envelope `{product, seo}`, `position` manufacturado para carruseles (no hay beacon de carrusel hoy),
y la ruta `/api/storefront/resolve` (la hace `/api/slate/resolve`). Búsqueda: pipeline aparte
(`hybridSearch`), plan propio.

## 4. Superficie pública

| Función (server, `import "server-only"`) | Para |
|---|---|
| `getHomePage(): StorefrontPage` | el home RSC (reemplaza el wiring inline de `page.tsx`) |
| `getCartPage(ids: string[]): StorefrontPage` | secciones del carrito |
| `getProductSections(id, cat): StorefrontSection[]` | cross-sell del PDP |

Cada una encapsula el wiring hoy copiado en `page.tsx` y `/api/slate/resolve`:
`resolveIdentity()` → `composePage` → `resolveSections` → `logSlateDecision` → `toPage`/`toSection`.

**Estructura:** `src/storefront/{contract.ts, identity.ts, map.ts (toSection/toPage), pages/{home,cart,product}.ts}`
con `import "server-only"` en todo salvo `contract.ts`.

## 5. Fuera de alcance (diferido, no rompe al añadirlo)
Búsqueda; migrar la UI actual y las DTOs inline al contrato (lo hace la reconstrucción visual);
width/height/srcset de imagen; PPR/`cacheComponents`. Mientras tanto cart/cross-sell siguen usando
`/api/slate/resolve` tal cual (su salida ya es una lista de secciones limpia).

## 6. Criterios de éxito
1. La capa visual construye importando solo `contract.ts`, sin tocar `f-slate`/`d-personalization`/`g-agents`.
2. El home RSC queda en una línea (`getHomePage()`); el wiring deja de estar copiado.
3. `tsc` limpio; `map.ts`/`pages/*` no filtran internos del motor al bundle cliente (`server-only`).
