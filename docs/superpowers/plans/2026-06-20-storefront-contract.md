# Storefront Contract (DAL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-only Data Access Layer (`src/storefront/`) that exposes the slate/personalization engine to the future visual layer as ONE stable, typed contract (`StorefrontPage` / `StorefrontSection` / `ProductCard` / `StorefrontProductPage`).

**Architecture:** A thin façade over the EXISTING engine — `composePage()` + `resolveSections()` already return `ResolvedSection[]`; this layer renames/projects that into presentation-ready contract DTOs through a single `map.ts`, exposed as typed server functions (`getHomePage`, `getProductPage`, `getCartPage`) that Server Components import directly (no internal REST hop), plus one REST adapter for the genuinely client-fetched surfaces (cart, PDP cross-sell). It is a DAL, NOT a BFF+REST mirror (per Next.js official guidance + the 2026-06-20 research).

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript 5.6 (strict), Vitest, `pg`. Existing engine in `src/sectors/{f-slate,d-personalization,b-catalog}`.

## Global Constraints

- `map.ts` and every `pages/*.ts` and `identity.ts` MUST start with `import "server-only";` — the engine internals never reach the client bundle. `contract.ts` MUST NOT (it is pure types, imported by client + server).
- Money stays RAW: `price: { cents: number; currency: string }`. NEVER a pre-formatted string. (Client formats with `Intl.NumberFormat`.)
- `image` is NULLABLE: `{ url; width?; height?; alt } | null` — `image_url` is nullable in the catalog.
- Sections carry BOTH `section_type` (primary dispatch key) AND `layout` (secondary render hint). Never collapse to layout-only.
- Analytics identity is mandatory: `meta.composition_id`, `section.analytics.slate_id`, and `ProductCard.position` (= `slot*100 + idx + 1`) must be present so the visual layer can fire the `/api/feed/seen` beacon.
- PDP is the envelope `{ product, sections, seo }` — `product` is a first-class entity, not a section.
- Do NOT build a blanket `GET /api/storefront/{home,product}` mirror of SSR pages (Next anti-pattern). REST only for client-fetched surfaces.
- Do NOT modify the existing pages/routes/components (`page.tsx`, `products/[id]/page.tsx`, `/api/slate/resolve`, `/api/feed/page`, `SurfaceSections`, `InfiniteFeed`). They keep working on the internal shape; their migration to the contract is the FIRST task of the visual-layer rebuild (out of scope here). The three duplicated inline DTOs are retired then, not now.

**Out of scope (explicit, deferred — additive, non-breaking when added later):** `getSearchPage` (search uses a different pipeline, `hybridSearch`, with its own result shape — needs its own task); image `width`/`height`/srcset; rewriting the current UI components; PPR/`cacheComponents` caching migration.

---

### Task 1: Contract types + mapping (`contract.ts`, `map.ts`)

**Files:**
- Create: `src/storefront/contract.ts`
- Create: `src/storefront/map.ts`
- Test: `tests/unit/storefront-map.test.ts`

**Interfaces:**
- Consumes: `ComposedPage` (`src/sectors/f-slate/compose.ts` — `{ composition_id, surface, placements: PlacementConfig[], rule_ctx, config_source, config_version }`; `placements[i]` has `placement_id: string` and `experiment_id: string | null`; `rule_ctx.is_logged_in: boolean`, `rule_ctx.session_cohort: string | null`); `ResolvedSection` + `SectionCardDTO` (`src/sectors/f-slate/sections/types.ts`); `ProductListRow` (`src/sectors/b-catalog/repository/products.ts` — `{ id, title, description, price_cents, currency, image_url: string|null, metadata, created_at }`).
- Produces: the `src/storefront/contract.ts` types listed below, and from `map.ts`: `toStorefrontPage(page: ComposedPage, sections: ResolvedSection[], surface: Surface): StorefrontPage`, `toSections(page: ComposedPage, sections: ResolvedSection[]): StorefrontSection[]`, `toProductDetail(p: ProductListRow): ProductDetail`, `toProductCard(card: SectionCardDTO, slot: number, idx: number): ProductCard`, `deriveLayout(section_type: string, display: string): SectionLayout`.

- [ ] **Step 1: Write `contract.ts` (pure types — no test, types are exercised by Step 2's test)**

```ts
// src/storefront/contract.ts
// The ONLY module the visual layer imports. No "server-only" — pure types.

export type Surface = "home" | "cart" | "search";
export type SectionLayout = "hero" | "grid" | "carousel";
export type SectionOutcome =
  | "served" | "empty" | "below_min" | "timeout" | "error" | "unknown_type";

export interface Money {
  cents: number;
  currency: string;
}

export interface ProductImage {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

export interface ProductCard {
  id: string;
  title: string;
  price: Money;
  image: ProductImage | null;
  href: string;
  badge: string | null;
  /** = slot*100 + idx + 1. Lets the visual layer fire /api/feed/seen. */
  position: number;
}

export interface SectionAnalytics {
  slate_id: string | null;
  experiment_id: string | null;
}

export interface SectionPagination {
  next_cursor: string | null;
  has_next: boolean;
}

export interface StorefrontSection {
  id: string;            // = placement_id
  section_type: string;  // PRIMARY dispatch key (hero_grid | popular | cross_sell | cart_addons)
  layout: SectionLayout; // secondary render hint
  title: string;
  outcome: SectionOutcome;
  products: ProductCard[];
  pagination?: SectionPagination; // hero feed only
  analytics: SectionAnalytics;
}

export interface PageMeta {
  composition_id: string;
  config_version: string;
  personalized: boolean;
  is_logged_in: boolean;
  degraded: boolean;
}

export interface StorefrontPage {
  surface: Surface;
  sections: StorefrontSection[];
  meta: PageMeta;
}

export interface ProductDetail {
  id: string;
  title: string;
  description: string;
  price: Money;
  image: ProductImage | null;
}

export interface ProductSeo {
  title: string;
  description: string;
  canonical: string;
}

export interface StorefrontProductPage {
  product: ProductDetail;
  sections: StorefrontSection[];
  seo: ProductSeo;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/storefront-map.test.ts
import { describe, it, expect } from "vitest";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { PlacementConfig } from "@/sectors/f-slate/config";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";
import { toStorefrontPage, toProductDetail, deriveLayout } from "@/storefront/map";

function page(overrides: Partial<ComposedPage> = {}): ComposedPage {
  return {
    composition_id: "comp-1",
    surface: "home",
    placements: [{ placement_id: "pl-hero", experiment_id: "exp-A" }] as unknown as PlacementConfig[],
    rule_ctx: { is_logged_in: true, session_cohort: "c1" } as ComposedPage["rule_ctx"],
    config_source: "db",
    config_version: "cfg-1",
    ...overrides,
  };
}

const heroSection: ResolvedSection = {
  placement_id: "pl-hero",
  section_type: "hero_grid",
  slot: 10,
  title: "Para ti",
  display: "grid",
  items: [
    { id: "p1", title: "Auriculares", price_cents: 125000, currency: "CUP", image_url: "/img/p1.jpg", reason: "Porque viste audio" },
    { id: "p2", title: "Sin foto", price_cents: 9900, currency: "CUP", image_url: null },
  ],
  next_cursor: "cur-123",
  slate_id: "slate-9",
  outcome: "served",
  resolve_ms: 4,
};

describe("storefront map", () => {
  it("maps money raw, image nullable, layout=hero, position, analytics, pagination", () => {
    const out = toStorefrontPage(page(), [heroSection], "home");
    expect(out.surface).toBe("home");
    expect(out.meta).toEqual({
      composition_id: "comp-1", config_version: "cfg-1",
      personalized: true, is_logged_in: true, degraded: false,
    });
    const s = out.sections[0];
    expect(s.section_type).toBe("hero_grid");
    expect(s.layout).toBe("hero");
    expect(s.analytics).toEqual({ slate_id: "slate-9", experiment_id: "exp-A" });
    expect(s.pagination).toEqual({ next_cursor: "cur-123", has_next: true });
    const [c1, c2] = s.products;
    expect(c1.price).toEqual({ cents: 125000, currency: "CUP" }); // raw, no formatted
    expect(c1.image).toEqual({ url: "/img/p1.jpg", alt: "Auriculares" });
    expect(c1.href).toBe("/products/p1");
    expect(c1.badge).toBe("Porque viste audio");
    expect(c1.position).toBe(10 * 100 + 1); // slot*100 + idx + 1
    expect(c2.image).toBeNull(); // nullable preserved
    expect(c2.badge).toBeNull();
    expect(c2.position).toBe(10 * 100 + 2);
  });

  it("derives carousel layout and preserves non-served outcome with no pagination", () => {
    const sec: ResolvedSection = {
      placement_id: "pl-x", section_type: "popular", slot: 20, title: "Popular",
      display: "carousel", items: [], next_cursor: undefined, slate_id: null,
      outcome: "empty", resolve_ms: 1,
    };
    const out = toStorefrontPage(page({ placements: [] as PlacementConfig[] }), [sec], "home");
    expect(out.sections[0].layout).toBe("carousel");
    expect(out.sections[0].outcome).toBe("empty");
    expect(out.sections[0].pagination).toBeUndefined();
    expect(out.sections[0].analytics.experiment_id).toBeNull(); // not in placements
  });

  it("degraded=true when config_source is not db", () => {
    expect(toStorefrontPage(page({ config_source: "fallback" }), [], "home").meta.degraded).toBe(true);
  });

  it("toProductDetail keeps raw money + nullable image", () => {
    const row: ProductListRow = {
      id: "p9", title: "T", description: "D", price_cents: 5000, currency: "CUP",
      image_url: null, metadata: {}, created_at: "2026-01-01",
    };
    expect(toProductDetail(row)).toEqual({
      id: "p9", title: "T", description: "D",
      price: { cents: 5000, currency: "CUP" }, image: null,
    });
  });

  it("deriveLayout: hero_grid->hero, grid->grid, else->carousel", () => {
    expect(deriveLayout("hero_grid", "grid")).toBe("hero");
    expect(deriveLayout("popular", "grid")).toBe("grid");
    expect(deriveLayout("cross_sell", "carousel")).toBe("carousel");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/storefront-map.test.ts`
Expected: FAIL — cannot resolve `@/storefront/map` (module not created yet).

- [ ] **Step 4: Write `map.ts`**

```ts
// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection, SectionCardDTO } from "@/sectors/f-slate/sections/types";
import type { ProductListRow } from "@/sectors/b-catalog/repository/products";
import type {
  Money, ProductImage, ProductCard, StorefrontSection, StorefrontPage,
  ProductDetail, Surface, SectionLayout,
} from "./contract";

export function toMoney(cents: number, currency: string): Money {
  return { cents, currency };
}

export function toImage(image_url: string | null, alt: string): ProductImage | null {
  return image_url ? { url: image_url, alt } : null;
}

export function deriveLayout(section_type: string, display: string): SectionLayout {
  if (section_type === "hero_grid") return "hero";
  return display === "grid" ? "grid" : "carousel";
}

export function toProductCard(card: SectionCardDTO, slot: number, idx: number): ProductCard {
  return {
    id: card.id,
    title: card.title,
    price: toMoney(card.price_cents, card.currency),
    image: toImage(card.image_url, card.title),
    href: `/products/${card.id}`,
    badge: card.reason ?? null,
    position: card.position ?? slot * 100 + (idx + 1),
  };
}

function toSection(section: ResolvedSection, experiment_id: string | null): StorefrontSection {
  const out: StorefrontSection = {
    id: section.placement_id,
    section_type: section.section_type,
    layout: deriveLayout(section.section_type, section.display),
    title: section.title,
    outcome: section.outcome,
    products: section.items.map((c, i) => toProductCard(c, section.slot, i)),
    analytics: { slate_id: section.slate_id ?? null, experiment_id },
  };
  if (section.next_cursor !== undefined) {
    out.pagination = { next_cursor: section.next_cursor ?? null, has_next: section.next_cursor != null };
  }
  return out;
}

export function toSections(page: ComposedPage, sections: ResolvedSection[]): StorefrontSection[] {
  const expById = new Map(page.placements.map((p) => [p.placement_id, p.experiment_id]));
  return sections.map((s) => toSection(s, expById.get(s.placement_id) ?? null));
}

export function toStorefrontPage(
  page: ComposedPage,
  sections: ResolvedSection[],
  surface: Surface,
): StorefrontPage {
  return {
    surface,
    sections: toSections(page, sections),
    meta: {
      composition_id: page.composition_id,
      config_version: page.config_version,
      personalized: page.rule_ctx.is_logged_in || page.rule_ctx.session_cohort !== null,
      is_logged_in: page.rule_ctx.is_logged_in,
      degraded: page.config_source !== "db",
    },
  };
}

export function toProductDetail(p: ProductListRow): ProductDetail {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: toMoney(p.price_cents, p.currency),
    image: toImage(p.image_url, p.title),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/storefront-map.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/storefront/contract.ts src/storefront/map.ts tests/unit/storefront-map.test.ts
git commit -m "feat(storefront): contract DTOs + pure mapping from engine (DAL core)"
```

---

### Task 2: Identity + page functions (`identity.ts`, `pages/{home,cart,product}.ts`)

**Files:**
- Create: `src/storefront/identity.ts`
- Create: `src/storefront/pages/home.ts`
- Create: `src/storefront/pages/cart.ts`
- Create: `src/storefront/pages/product.ts`
- Test: `tests/unit/storefront-pages.test.ts`

**Interfaces:**
- Consumes (from Task 1): `toStorefrontPage`, `toSections`, `toProductDetail`. From engine: `composePage(input, pg)`, `logSlateDecision(page, ctx, pg)`, `resolveSections(page, identity, surfaceArgs, pg)`, `getById(id)`, `withPg(fn)`, `isHoldout(identity)`, `auth0`, `getOrCreateUserByAuth0Sub(pg, sub, email)`, `cookies()`.
- Produces: `resolveIdentity(): Promise<ComposeIdentity>`; `getHomePage(): Promise<StorefrontPage>`; `getCartPage(cartProductIds: string[]): Promise<StorefrontPage>`; `getProductSections(id: string, category: string | null): Promise<StorefrontSection[]>`; `getProductPage(id: string): Promise<StorefrontProductPage | null>`.

- [ ] **Step 1: Write `identity.ts`**

```ts
// src/storefront/identity.ts
import "server-only";
import { cookies } from "next/headers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import type { ComposeIdentity } from "@/sectors/f-slate/compose";

/** Resolves the request identity (cookies + Auth0) — the one place that touches auth. */
export async function resolveIdentity(): Promise<ComposeIdentity> {
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;
  let user_id: string | null = null;
  const session = await auth0.getSession().catch(() => null);
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }
  return { user_id, anonymous_id, session_id };
}
```

- [ ] **Step 2: Write `pages/home.ts`, `pages/cart.ts`, `pages/product.ts`**

```ts
// src/storefront/pages/home.ts
import "server-only";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { isHoldout } from "@/sectors/d-personalization/holdout";
import { resolveIdentity } from "../identity";
import { toStorefrontPage } from "../map";
import type { StorefrontPage } from "../contract";

export async function getHomePage(): Promise<StorefrontPage> {
  const identity = await resolveIdentity();
  return withPg(async (pg) => {
    const page = await composePage({ surface: "home", identity }, pg);
    const resolved = await resolveSections(page, identity, undefined, pg);
    const hero = resolved.find((s) => s.section_type === "hero_grid");
    await logSlateDecision(
      page,
      { user_profile_id: null, session_id: identity.session_id, slate_id: hero?.slate_id ?? null, holdout: isHoldout(identity) },
      pg,
    );
    return toStorefrontPage(page, resolved, "home");
  });
}
```

```ts
// src/storefront/pages/cart.ts
import "server-only";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toStorefrontPage } from "../map";
import type { StorefrontPage } from "../contract";

export async function getCartPage(cartProductIds: string[]): Promise<StorefrontPage> {
  const identity = await resolveIdentity();
  const surfaceArgs = { cart_product_ids: cartProductIds };
  return withPg(async (pg) => {
    const page = await composePage({ surface: "cart", identity, surfaceArgs }, pg);
    const resolved = await resolveSections(page, identity, surfaceArgs, pg);
    await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
    return toStorefrontPage(page, resolved, "cart");
  });
}
```

```ts
// src/storefront/pages/product.ts
import "server-only";
import { withPg } from "@/lib/db/helpers";
import { getById } from "@/sectors/b-catalog/repository/products";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toSections, toProductDetail } from "../map";
import type { StorefrontSection, StorefrontProductPage } from "../contract";

export async function getProductSections(id: string, category: string | null): Promise<StorefrontSection[]> {
  const identity = await resolveIdentity();
  const surfaceArgs = { pdp_product_id: id, pdp_category: category };
  return withPg(async (pg) => {
    const page = await composePage({ surface: "pdp", identity, surfaceArgs }, pg);
    const resolved = await resolveSections(page, identity, surfaceArgs, pg);
    await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
    return toSections(page, resolved);
  });
}

export async function getProductPage(id: string): Promise<StorefrontProductPage | null> {
  const product = await getById(id);
  if (!product) return null;
  const category = (product.metadata?.category as string | undefined) ?? null;
  const sections = await getProductSections(id, category);
  return {
    product: toProductDetail(product),
    sections,
    seo: { title: product.title, description: product.description, canonical: `/products/${product.id}` },
  };
}
```

- [ ] **Step 3: Write the failing test (wiring, engine mocked)**

```ts
// tests/unit/storefront-pages.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/storefront/identity", () => ({
  resolveIdentity: vi.fn(async () => ({ user_id: null, anonymous_id: "a1", session_id: "s1" })),
}));
vi.mock("@/lib/db/helpers", () => ({ withPg: vi.fn(async (fn: (pg: unknown) => unknown) => fn({})) }));
vi.mock("@/sectors/d-personalization/holdout", () => ({ isHoldout: vi.fn(() => false) }));
const composePage = vi.fn();
const logSlateDecision = vi.fn(async () => {});
vi.mock("@/sectors/f-slate/compose", () => ({ composePage, logSlateDecision }));
const resolveSections = vi.fn();
vi.mock("@/sectors/f-slate/sections/resolve", () => ({ resolveSections }));
const getById = vi.fn();
vi.mock("@/sectors/b-catalog/repository/products", () => ({ getById }));

import { getHomePage } from "@/storefront/pages/home";
import { getProductPage } from "@/storefront/pages/product";

const composed = {
  composition_id: "c1", surface: "home",
  placements: [{ placement_id: "pl1", experiment_id: null }],
  rule_ctx: { is_logged_in: false, session_cohort: null },
  config_source: "db", config_version: "v1",
};
const heroResolved = [{
  placement_id: "pl1", section_type: "hero_grid", slot: 10, title: "Para ti", display: "grid",
  items: [{ id: "p1", title: "X", price_cents: 100, currency: "CUP", image_url: null }],
  next_cursor: null, slate_id: "sl1", outcome: "served", resolve_ms: 1,
}];

beforeEach(() => vi.clearAllMocks());

describe("storefront pages", () => {
  it("getHomePage composes home, logs the hero slate_id, returns mapped contract", async () => {
    composePage.mockResolvedValue(composed);
    resolveSections.mockResolvedValue(heroResolved);
    const out = await getHomePage();
    expect(composePage).toHaveBeenCalledWith({ surface: "home", identity: expect.any(Object) }, expect.anything());
    expect(logSlateDecision.mock.calls[0][1].slate_id).toBe("sl1");
    expect(out.surface).toBe("home");
    expect(out.sections[0].products[0].href).toBe("/products/p1");
    expect(out.sections[0].analytics.slate_id).toBe("sl1");
  });

  it("getProductPage returns null for unknown id without composing", async () => {
    getById.mockResolvedValue(null);
    expect(await getProductPage("missing")).toBeNull();
    expect(composePage).not.toHaveBeenCalled();
  });

  it("getProductPage builds the {product, sections, seo} envelope", async () => {
    getById.mockResolvedValue({ id: "p9", title: "T", description: "D", price_cents: 5000, currency: "CUP", image_url: null, metadata: { category: "audio" }, created_at: "x" });
    composePage.mockResolvedValue({ ...composed, surface: "pdp" });
    resolveSections.mockResolvedValue([]);
    const out = await getProductPage("p9");
    expect(out?.product.price).toEqual({ cents: 5000, currency: "CUP" });
    expect(out?.seo.canonical).toBe("/products/p9");
    expect(composePage).toHaveBeenCalledWith(
      { surface: "pdp", identity: expect.any(Object), surfaceArgs: { pdp_product_id: "p9", pdp_category: "audio" } },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `pnpm vitest run tests/unit/storefront-pages.test.ts`
Expected: FAIL first (modules missing) → after Steps 1-2 exist, PASS (3 tests). If you wrote Steps 1-2 before the test, run once and expect PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/identity.ts src/storefront/pages/ tests/unit/storefront-pages.test.ts
git commit -m "feat(storefront): identity + getHomePage/getCartPage/getProductPage (typed DAL)"
```

---

### Task 3: REST adapter for client-fetched surfaces (`/api/storefront/resolve`)

**Files:**
- Create: `src/app/api/storefront/resolve/route.ts`
- Test: `tests/unit/storefront-resolve-route.test.ts`

**Interfaces:**
- Consumes (from Task 2): `getCartPage(ids)`, `getProductSections(id, category)`. From lib: `dbHealth()`.
- Produces: `POST /api/storefront/resolve` — body `{ surface: "cart", cart_product_ids: string[] }` OR `{ surface: "pdp", pdp_product_id: string, pdp_category?: string|null }` → `{ sections: StorefrontSection[] }`. This is the single client-fetch adapter the visual layer uses for the cart sections and the lazy PDP cross-sell (the contract equivalent of the legacy `/api/slate/resolve`). Home + product-detail are served via the typed functions in their RSC, NOT here.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/storefront/resolve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbHealth } from "@/lib/db/health";
import { getCartPage } from "@/storefront/pages/cart";
import { getProductSections } from "@/storefront/pages/product";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.discriminatedUnion("surface", [
  z.object({
    surface: z.literal("cart"),
    cart_product_ids: z.array(z.string().regex(UUID_REGEX)).max(50).default([]),
  }).strict(),
  z.object({
    surface: z.literal("pdp"),
    pdp_product_id: z.string().regex(UUID_REGEX),
    pdp_category: z.string().max(120).nullish(),
  }).strict(),
]);

export async function POST(req: NextRequest) {
  if (dbHealth() === "down") {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "15" } });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const sections =
    body.surface === "cart"
      ? (await getCartPage(body.cart_product_ids)).sections
      : await getProductSections(body.pdp_product_id, body.pdp_category ?? null);

  return NextResponse.json({ sections }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/storefront-resolve-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/health", () => ({ dbHealth: vi.fn(() => "ok") }));
const getCartPage = vi.fn();
const getProductSections = vi.fn();
vi.mock("@/storefront/pages/cart", () => ({ getCartPage }));
vi.mock("@/storefront/pages/product", () => ({ getProductSections }));

import { POST } from "@/app/api/storefront/resolve/route";

const ID = "00000000-0000-0000-0000-000000000001";
function req(body: unknown) {
  return new Request("http://x/api/storefront/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/storefront/resolve", () => {
  it("cart -> getCartPage(ids).sections", async () => {
    getCartPage.mockResolvedValue({ sections: [{ id: "s1" }] });
    const res = await POST(req({ surface: "cart", cart_product_ids: [ID] }));
    expect(getCartPage).toHaveBeenCalledWith([ID]);
    expect(await res.json()).toEqual({ sections: [{ id: "s1" }] });
  });

  it("pdp -> getProductSections(id, category)", async () => {
    getProductSections.mockResolvedValue([{ id: "x" }]);
    const res = await POST(req({ surface: "pdp", pdp_product_id: ID, pdp_category: "audio" }));
    expect(getProductSections).toHaveBeenCalledWith(ID, "audio");
    expect(res.status).toBe(200);
  });

  it("rejects unknown surface / bad body with 400", async () => {
    const res = await POST(req({ surface: "home" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/storefront-resolve-route.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 4: Run after writing the route — verify it passes**

Run: `pnpm vitest run tests/unit/storefront-resolve-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + full unit suite (no regressions)**

Run: `pnpm tsc --noEmit && pnpm vitest run tests/unit/storefront-*.test.ts`
Expected: no type errors; all storefront tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/storefront/resolve/route.ts tests/unit/storefront-resolve-route.test.ts
git commit -m "feat(storefront): REST adapter /api/storefront/resolve for cart + PDP cross-sell"
```

---

## Self-Review

**Spec coverage:**
- Contract envelope `StorefrontPage`/`StorefrontSection`/`ProductCard`/`StorefrontProductPage` → Task 1 (`contract.ts`). ✓
- DAL not BFF (typed functions, no SSR REST mirror) → Tasks 2-3; only client-fetch surfaces get REST. ✓
- `section_type` primary + `layout` secondary → `deriveLayout` + `toSection` (Task 1). ✓
- Raw money / nullable image+alt → `toMoney`/`toImage` (Task 1, tested). ✓
- Analytics identity (`composition_id`, `slate_id`, `position`) → `toStorefrontPage`/`toProductCard` (Task 1, tested). ✓
- PDP envelope `{ product, sections, seo }` → `getProductPage` (Task 2, tested). ✓
- `server-only` firewall → Step-1 of every server module. ✓
- `meta.is_logged_in`/`degraded`/`personalized` → `toStorefrontPage` (Task 1, tested). ✓
- Section `outcome` surfaced (not filtered) → `toSection` preserves it (Task 1, tested). ✓
- Search → explicitly deferred (out-of-scope note). ✓ (Spec listed it; carved out because `hybridSearch` is a different pipeline — its own future plan.)
- Retire 3 duplicate DTOs → deferred to the visual-layer rebuild (Global Constraints note); this plan adds the single source without breaking current consumers. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete; every test has real assertions. ✓

**Type consistency:** `toStorefrontPage`/`toSections`/`toProductDetail`/`getProductSections`/`getProductPage`/`getCartPage`/`getHomePage`/`resolveIdentity` names match across Tasks 1→2→3. `SectionCardDTO` fields (`price_cents`, `currency`, `image_url`, `reason`, `position`) and `ResolvedSection` fields (`placement_id`, `section_type`, `slot`, `display`, `next_cursor`, `slate_id`, `outcome`) match `src/sectors/f-slate/sections/types.ts`. `ComposedPage.placements[i].experiment_id` and `rule_ctx.is_logged_in`/`session_cohort` match `compose.ts`. ✓
