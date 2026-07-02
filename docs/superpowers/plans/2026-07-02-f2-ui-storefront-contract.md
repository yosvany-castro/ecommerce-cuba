# F2 — Migración de la UI al Storefront Contract · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** La capa visual consume el motor SOLO vía `src/storefront/` (DAL + `contract.ts`); se retiran los 3 DTOs inline y se impone la frontera de imports con un test.

**Architecture:** Sustitución mecánica de wiring: `page.tsx` usa `getHomePage()`; `/api/slate/resolve` usa los núcleos `cartPage`/`productSections` (identidad de cookies del request, sin auth0 — semántica actual); los componentes tipan contra `StorefrontCard`/`StorefrontSection`. Cero cambios visuales (mismo markup).

**Tech Stack:** Next.js 16 App Router, TS strict, Vitest.

## Global Constraints

- Los componentes visuales (`src/components/**`) no importan nada de `@/sectors/**` — solo `@/storefront/contract` (tipos puros) y libs cliente.
- `contract.ts` NO lleva `import "server-only"` (client-importable); el resto del DAL sí lo lleva ya.
- No cambiar markup/clases (el test de equivalencia del hero debe seguir verde).
- `/api/slate/resolve` conserva: guard `dbHealth`, validación de identidad UUID, filtro `outcome==="served"`, header `server-timing`, `cache-control: no-store`.
- El PDP sigue con `getById` server-side (envelope `{product,seo}` diferido — fuera de alcance, igual que en el spec del contrato).

---

### Task 1: Home SSR + SlateRenderer → contrato

**Files:**
- Modify: `src/app/(shop)/page.tsx` (wiring completo → `getHomePage()`)
- Modify: `src/components/slate/SlateRenderer.tsx` (tipo `ResolvedSection` → `StorefrontSection`)

**Interfaces:**
- Consumes: `getHomePage(): Promise<StorefrontPage>` (`src/storefront/pages/home.ts`); `StorefrontSection` (`src/storefront/contract.ts`).
- Produces: `SlateRenderer({ sections }: { sections: StorefrontSection[] })` — Task 2/3 asumen este tipo.

- [ ] **Step 1: Reescribir `page.tsx`** — el wiring duplicado muere; queda timing de UNA fase (`storefront_home`; se pierde el desglose auth/feed_page — trade documentado, recuperable con un param opcional de timing en el DAL si F5 lo pide):

```tsx
import { after } from "next/server";
import { getHomePage } from "@/storefront/pages/home";
import { SlateRenderer } from "@/components/slate/SlateRenderer";
import { RequestTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

/** F5: sampled structured-log persistence (Server Components can't set headers). */
const TIMING_SAMPLE_RATE = 0.2;

function logTimingSampled(timing: RequestTiming): void {
  if (Math.random() < TIMING_SAMPLE_RATE) console.log(timing.toLogLine("home"));
}

export default async function HomePage() {
  const timing = new RequestTiming();
  const page = await timing.time("storefront_home", () => getHomePage());
  after(() => logTimingSampled(timing));

  const hasContent = page.sections.some((s) => s.outcome === "served" && s.items.length > 0);
  if (!hasContent) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-4">Catálogo</h1>
        <p className="text-gray-600">
          No hay productos todavía. En desarrollo, ejecuta:
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:catalog-fill --pages 1
          </code>{" "}
          y luego{" "}
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:cohort-centroids
          </code>
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Catálogo</h1>
      <SlateRenderer sections={page.sections} />
    </main>
  );
}
```

- [ ] **Step 2: `SlateRenderer.tsx`** — cambiar SOLO el import/tipo (los campos usados — placement_id, section_type, outcome, items, next_cursor, slate_id, title, display — existen todos en `StorefrontSection`):

```tsx
import type { StorefrontSection } from "@/storefront/contract";
// ...firma:
export function SlateRenderer({ sections }: { sections: StorefrontSection[] })
// HeroGridSection / CarouselSection: { section: StorefrontSection }
```

- [ ] **Step 3: Verificar** — `pnpm tsc --noEmit` limpio; `pnpm vitest run tests/unit/storefront-pages.test.ts tests/unit/storefront-map.test.ts` PASS; test de equivalencia del hero (grep `equivalen` en tests/) PASS si toca DB.

- [ ] **Step 4: Commit** — `feat(f2): home SSR consume getHomePage; SlateRenderer tipa contra el contrato`

---

### Task 2: `/api/slate/resolve` → núcleos del DAL

**Files:**
- Modify: `src/app/api/slate/resolve/route.ts`

**Interfaces:**
- Consumes: `cartPage(identity, ids, pg): Promise<StorefrontPage>`; `productSections(identity, id, category, pg): Promise<StorefrontSection[]>` (núcleos con pg explícito — la identidad AQUÍ viene de `req.cookies`, sin auth0: semántica actual del endpoint, user_id siempre null).
- Produces: respuesta `{ composition_id?: string; surface: string; sections: StorefrontSection[] }` (sections ya trimmed + filtradas a served). `SurfaceSections` (Task 3) tipa contra esto.

- [ ] **Step 1: Reescribir el handler** conservando guards/headers:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withPg } from "@/lib/db/helpers";
import { dbHealth } from "@/lib/db/health";
import { cartPage } from "@/storefront/pages/cart";
import { productSections } from "@/storefront/pages/product";
import type { StorefrontSection } from "@/storefront/contract";
import { RequestTiming } from "@/lib/timing";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z
  .object({
    surface: z.enum(["pdp", "cart"]),
    surface_args: z
      .object({
        pdp_product_id: z.string().regex(UUID_REGEX).optional(),
        pdp_category: z.string().max(120).nullish(),
        cart_product_ids: z.array(z.string().regex(UUID_REGEX)).max(50).optional(),
      })
      .default({}),
  })
  .strict();

export async function POST(req: NextRequest) {
  if (dbHealth() === "down") {
    return NextResponse.json(
      { error: "db_unavailable" },
      { status: 503, headers: { "retry-after": "15" } },
    );
  }
  const anonymous_id = req.cookies.get("anonymous_id")?.value ?? null;
  const session_id = req.cookies.get("session_id")?.value ?? null;
  if (
    (anonymous_id && !UUID_REGEX.test(anonymous_id)) ||
    (session_id && !UUID_REGEX.test(session_id))
  ) {
    return NextResponse.json({ error: "bad_identity" }, { status: 400 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const identity = { user_id: null, anonymous_id, session_id };
  const timing = new RequestTiming();
  const served = (ss: StorefrontSection[]) => ss.filter((s) => s.outcome === "served");
  const out = await timing.time("slate_resolve", () =>
    withPg(async (pg) => {
      if (body.surface === "cart") {
        const page = await cartPage(identity, body.surface_args.cart_product_ids ?? [], pg);
        return { composition_id: page.composition_id, surface: page.surface, sections: served(page.sections) };
      }
      const sections = await productSections(
        identity,
        body.surface_args.pdp_product_id ?? "",
        body.surface_args.pdp_category ?? null,
        pg,
      );
      return { surface: "pdp", sections: served(sections) };
    }),
  );
  return NextResponse.json(out, {
    headers: { "server-timing": timing.toServerTimingHeader(), "cache-control": "no-store" },
  });
}
```

- [ ] **Step 2: Verificar** — `pnpm tsc --noEmit`; correr el test de integración del endpoint si existe (grep `slate/resolve` en tests/integration) y los de slate: `pnpm vitest run tests/integration/slate-serve.test.ts`. La respuesta AÑADE campos opcionales (outcome, next_cursor, slate_id) — compatible con el cliente actual.

- [ ] **Step 3: Commit** — `feat(f2): /api/slate/resolve delega en el DAL (cartPage/productSections)`

---

### Task 3: Retirar los 3 DTOs inline

**Files:**
- Modify: `src/components/ProductCard.tsx` (borrar `ProductCardData` → `StorefrontCard`)
- Modify: `src/components/InfiniteFeed.tsx` (borrar `FeedCardDTO`; `FeedPageResponse.items: StorefrontCard[]`)
- Modify: `src/components/slate/SurfaceSections.tsx` (borrar `SectionDTO` → `StorefrontSection`)
- Verify/Modify: `src/app/api/feed/page/route.ts` — los items DEBEN incluir `currency` (StorefrontCard lo exige; ProductCardData no lo tenía)

**Interfaces:**
- Consumes: `StorefrontCard`/`StorefrontSection` de `@/storefront/contract`.
- Produces: `ProductCard({ product }: { product: StorefrontCard; reason?: string })`.

- [ ] **Step 1:** `ProductCard.tsx`: eliminar la interface; `import type { StorefrontCard } from "@/storefront/contract"`; prop `product: StorefrontCard`. Grep de TODOS los usos de `ProductCardData` (`grep -rn ProductCardData src/`) y reemplazar por `StorefrontCard`.
- [ ] **Step 2:** `SurfaceSections.tsx`: eliminar `SectionDTO`; `useState<StorefrontSection[]>`; el cast del fetch tipa `{ sections: StorefrontSection[] }`.
- [ ] **Step 3:** `InfiniteFeed.tsx`: eliminar `FeedCardDTO`; `FeedPageResponse = { items: StorefrontCard[]; next_cursor: string | null; slate_id: string | null }`.
- [ ] **Step 4:** Verificar que `/api/feed/page` emite `currency` en cada item (leer `src/app/api/feed/page/route.ts` y el serializador del slate); si falta, añadirlo desde la fila de producto (`currency` existe en products/SectionCardDTO).
- [ ] **Step 5: Verificar** — `pnpm tsc --noEmit`; `pnpm test:unit`; `pnpm test:quality`.
- [ ] **Step 6: Commit** — `feat(f2): componentes tipan contra StorefrontCard/StorefrontSection; DTOs inline retirados`

---

### Task 4: Frontera de imports como test

**Files:**
- Test: `tests/unit/storefront-boundary.test.ts`

**Interfaces:**
- Consumes: nada del runtime — escanea el filesystem.
- Produces: regla ejecutable "componentes visuales no importan el motor".

- [ ] **Step 1: Escribir el test:**

```ts
// tests/unit/storefront-boundary.test.ts — la frontera visual/motor es una regla
// ejecutable, no una convención: src/components/** solo ve @/storefront/contract.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("frontera storefront", () => {
  it("ningún componente visual importa @/sectors/**", () => {
    const files = walk("src/components").filter((p) => /\.(ts|tsx)$/.test(p));
    const offenders = files.filter((p) => /from ["']@\/sectors\//.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr — puede FALLAR legítimamente** si algún componente aún importa el motor: cada offender se migra al contrato (o, si es un tracker/cliente de API sin equivalente en el contrato, se documenta y se excluye EXPLÍCITAMENTE con lista allowlist en el test).
- [ ] **Step 3: PASS + Commit** — `test(f2): frontera de imports componente→contrato como regla ejecutable`

---

## Self-Review

**Spec coverage:** F2 del Plan V2 = migrar page.tsx (T1), /api/slate/resolve (T2), retirar 3 DTOs (T3), frontera de imports (T4). PDP envelope y búsqueda: diferidos explícitos (igual que el spec del contrato). ✓
**Placeholder scan:** T3 Step 4 depende de leer feed/page en ejecución — acción concreta con criterio (currency presente o añadirlo). ✓
**Type consistency:** `StorefrontSection`/`StorefrontCard`/`getHomePage`/`cartPage`/`productSections` coinciden con `src/storefront/` (F1). ✓
