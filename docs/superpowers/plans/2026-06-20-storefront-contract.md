# Storefront Contract (DAL) Implementation Plan · versión lazy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A thin server-only DAL (`src/storefront/`) that exposes the engine as one stable contract (`StorefrontPage`/`StorefrontSection`/`StorefrontCard`) and kills the wiring currently copy-pasted across `page.tsx` and `/api/slate/resolve`.

**Architecture:** The contract is a *trim* of the engine's existing `ResolvedSection`/`SectionCardDTO` (drop `slot`/`resolve_ms`; keep raw field names). Three typed functions wrap `composePage + resolveSections + logSlateDecision + identity`. Server Components import them directly — no internal REST. Client-fetched cart/cross-sell keep using the existing `/api/slate/resolve`.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5.6 (strict), Vitest, `pg`.

## Global Constraints

- `map.ts`, `identity.ts`, every `pages/*.ts` start with `import "server-only";`. `contract.ts` does NOT (pure types, client-importable).
- Contract mirrors engine field names: `price_cents`+`currency` (raw, never formatted), `image_url` (nullable), `section_type` (dispatch key), `placement_id`, `slate_id`, `position`. No re-nesting, no renames.
- Do NOT modify existing pages/routes/components or create new routes. Their migration to the contract is the visual-layer rebuild (out of scope).
- Out of scope (deferred, additive): search (`getSearchPage`), the PDP `{product,seo}` envelope (the page already has `getById`), image dims/srcset, retiring the 3 inline DTOs.

---

### Task 1: Contract + trim mapping (`contract.ts`, `map.ts`)

**Files:**
- Create: `src/storefront/contract.ts`
- Create: `src/storefront/map.ts`
- Test: `tests/unit/storefront-map.test.ts`

**Interfaces:**
- Consumes: `ComposedPage` (`src/sectors/f-slate/compose.ts` — has `composition_id: string`); `ResolvedSection` + `SectionCardDTO` (`src/sectors/f-slate/sections/types.ts`).
- Produces: `contract.ts` types below; `toSection(s: ResolvedSection): StorefrontSection`; `toPage(page: ComposedPage, sections: ResolvedSection[], surface: string): StorefrontPage`.

- [ ] **Step 1: Write `contract.ts`**

```ts
// src/storefront/contract.ts — the only module the visual layer imports. Pure types.
export interface StorefrontCard {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  reason?: string;
  position?: number;
}
export interface StorefrontSection {
  placement_id: string;
  section_type: string;
  title: string;
  display: string; // "grid" | "carousel"
  outcome: string;
  items: StorefrontCard[];
  next_cursor?: string | null;
  slate_id?: string | null;
}
export interface StorefrontPage {
  composition_id: string;
  surface: string;
  sections: StorefrontSection[];
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/storefront-map.test.ts
import { describe, it, expect } from "vitest";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import { toPage, toSection } from "@/storefront/map";

const section: ResolvedSection = {
  placement_id: "pl1", section_type: "hero_grid", slot: 10, title: "Para ti",
  display: "grid",
  items: [
    { id: "p1", title: "Auriculares", price_cents: 125000, currency: "CUP", image_url: "/p1.jpg", reason: "viste audio", position: 1001 },
    { id: "p2", title: "Sin foto", price_cents: 9900, currency: "CUP", image_url: null },
  ],
  next_cursor: "cur-1", slate_id: "sl9", outcome: "served", resolve_ms: 4,
};
const page = { composition_id: "c1", surface: "home", placements: [], rule_ctx: {}, config_source: "db", config_version: "v1" } as unknown as ComposedPage;

describe("storefront trim", () => {
  it("drops engine internals, keeps raw money + nullable image + slate_id + outcome", () => {
    const s = toSection(section);
    expect(s).toEqual({
      placement_id: "pl1", section_type: "hero_grid", title: "Para ti", display: "grid",
      outcome: "served", next_cursor: "cur-1", slate_id: "sl9",
      items: section.items, // raw cards passthrough
    });
    expect("slot" in s).toBe(false);
    expect("resolve_ms" in s).toBe(false);
    expect(s.items[0].price_cents).toBe(125000); // raw, no formatted
    expect(s.items[1].image_url).toBeNull();      // nullable preserved
  });

  it("toPage carries composition_id + surface", () => {
    const out = toPage(page, [section], "home");
    expect(out.composition_id).toBe("c1");
    expect(out.surface).toBe("home");
    expect(out.sections).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm vitest run tests/unit/storefront-map.test.ts`
Expected: FAIL — `@/storefront/map` not found.

- [ ] **Step 4: Write `map.ts`**

```ts
// src/storefront/map.ts
import "server-only";
import type { ComposedPage } from "@/sectors/f-slate/compose";
import type { ResolvedSection } from "@/sectors/f-slate/sections/types";
import type { StorefrontSection, StorefrontPage } from "./contract";

export function toSection(s: ResolvedSection): StorefrontSection {
  return {
    placement_id: s.placement_id,
    section_type: s.section_type,
    title: s.title,
    display: s.display,
    outcome: s.outcome,
    items: s.items, // SectionCardDTO ≡ StorefrontCard (structural)
    next_cursor: s.next_cursor,
    slate_id: s.slate_id,
  };
}

export function toPage(page: ComposedPage, sections: ResolvedSection[], surface: string): StorefrontPage {
  return { composition_id: page.composition_id, surface, sections: sections.map(toSection) };
}
```

- [ ] **Step 5: Run, expect PASS + typecheck**

Run: `pnpm vitest run tests/unit/storefront-map.test.ts && pnpm tsc --noEmit`
Expected: 2 tests PASS, no type errors.

> If `tsc` flags `items: s.items` (SectionCardDTO not assignable to StorefrontCard), the two are not structurally identical — fix by mapping the fields explicitly in `toSection` (`items: s.items.map(c => ({ id: c.id, title: c.title, price_cents: c.price_cents, currency: c.currency, image_url: c.image_url, reason: c.reason, position: c.position }))`). Expected: no error, since both have the same shape.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/contract.ts src/storefront/map.ts tests/unit/storefront-map.test.ts
git commit -m "feat(storefront): contract trim of engine DTOs (toSection/toPage)"
```

---

### Task 2: Identity + page functions

**Files:**
- Create: `src/storefront/identity.ts`
- Create: `src/storefront/pages/home.ts`
- Create: `src/storefront/pages/cart.ts`
- Create: `src/storefront/pages/product.ts`
- Test: `tests/unit/storefront-pages.test.ts`

**Interfaces:**
- Consumes (Task 1): `toPage`, `toSection`. Engine: `composePage(input, pg)`, `logSlateDecision(page, ctx, pg)`, `resolveSections(page, identity, surfaceArgs, pg)`, `withPg(fn)`, `isHoldout(identity)`, `auth0`, `getOrCreateUserByAuth0Sub(pg, sub, email)`, `cookies()`.
- Produces: `resolveIdentity(): Promise<ComposeIdentity>`; `getHomePage(): Promise<StorefrontPage>`; `getCartPage(ids: string[]): Promise<StorefrontPage>`; `getProductSections(id: string, category: string | null): Promise<StorefrontSection[]>`.

- [ ] **Step 1: Write `identity.ts` (extracted verbatim from `page.tsx` auth logic)**

```ts
// src/storefront/identity.ts
import "server-only";
import { cookies } from "next/headers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import type { ComposeIdentity } from "@/sectors/f-slate/compose";

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

- [ ] **Step 2: Write the three page functions**

```ts
// src/storefront/pages/home.ts
import "server-only";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { isHoldout } from "@/sectors/d-personalization/holdout";
import { resolveIdentity } from "../identity";
import { toPage } from "../map";
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
    return toPage(page, resolved, "home");
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
import { toPage } from "../map";
import type { StorefrontPage } from "../contract";

export async function getCartPage(ids: string[]): Promise<StorefrontPage> {
  const identity = await resolveIdentity();
  const surfaceArgs = { cart_product_ids: ids };
  return withPg(async (pg) => {
    const page = await composePage({ surface: "cart", identity, surfaceArgs }, pg);
    const resolved = await resolveSections(page, identity, surfaceArgs, pg);
    await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
    return toPage(page, resolved, "cart");
  });
}
```

```ts
// src/storefront/pages/product.ts — sections only; the product itself comes from getById in the PDP page
import "server-only";
import { withPg } from "@/lib/db/helpers";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { resolveIdentity } from "../identity";
import { toSection } from "../map";
import type { StorefrontSection } from "../contract";

export async function getProductSections(id: string, category: string | null): Promise<StorefrontSection[]> {
  const identity = await resolveIdentity();
  const surfaceArgs = { pdp_product_id: id, pdp_category: category };
  return withPg(async (pg) => {
    const page = await composePage({ surface: "pdp", identity, surfaceArgs }, pg);
    const resolved = await resolveSections(page, identity, surfaceArgs, pg);
    await logSlateDecision(page, { user_profile_id: null, session_id: identity.session_id }, pg);
    return resolved.map(toSection);
  });
}
```

- [ ] **Step 3: Write the failing test (engine mocked — verifies wiring only)**

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

import { getHomePage } from "@/storefront/pages/home";
import { getProductSections } from "@/storefront/pages/product";

const composed = { composition_id: "c1", surface: "home", placements: [], rule_ctx: {}, config_source: "db", config_version: "v1" };
const hero = [{ placement_id: "pl1", section_type: "hero_grid", slot: 10, title: "Para ti", display: "grid", items: [], next_cursor: null, slate_id: "sl1", outcome: "served", resolve_ms: 1 }];

beforeEach(() => vi.clearAllMocks());

describe("storefront pages", () => {
  it("getHomePage composes home + logs the hero slate_id + returns trimmed page", async () => {
    composePage.mockResolvedValue(composed);
    resolveSections.mockResolvedValue(hero);
    const out = await getHomePage();
    expect(composePage).toHaveBeenCalledWith({ surface: "home", identity: expect.any(Object) }, expect.anything());
    expect(logSlateDecision.mock.calls[0][1].slate_id).toBe("sl1");
    expect(out.composition_id).toBe("c1");
    expect(out.sections[0].placement_id).toBe("pl1");
    expect("slot" in out.sections[0]).toBe(false);
  });

  it("getProductSections composes pdp with the anchor + category", async () => {
    composePage.mockResolvedValue({ ...composed, surface: "pdp" });
    resolveSections.mockResolvedValue([]);
    const out = await getProductSections("p9", "audio");
    expect(composePage).toHaveBeenCalledWith(
      { surface: "pdp", identity: expect.any(Object), surfaceArgs: { pdp_product_id: "p9", pdp_category: "audio" } },
      expect.anything(),
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 4: Run, expect PASS + typecheck**

Run: `pnpm vitest run tests/unit/storefront-pages.test.ts && pnpm tsc --noEmit`
Expected: 2 tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/storefront/identity.ts src/storefront/pages/ tests/unit/storefront-pages.test.ts
git commit -m "feat(storefront): identity + getHomePage/getCartPage/getProductSections (kills copy-pasted wiring)"
```

---

## Self-Review

**Spec coverage:** contract trim → Task 1; `server-only` → Step 1 of each server module; raw money / nullable image / `section_type` / `slate_id` → preserved by the trim (Task 1, tested); three page functions kill the duplicated wiring → Task 2 (tested). Search, PDP envelope, new REST route, UI migration → explicitly deferred. ✓

**Placeholder scan:** none. ✓

**Type consistency:** `toSection`/`toPage`/`resolveIdentity`/`getHomePage`/`getCartPage`/`getProductSections` consistent across tasks. Field names (`placement_id`, `section_type`, `display`, `next_cursor`, `slate_id`, `outcome`, `price_cents`, `currency`, `image_url`) match `src/sectors/f-slate/sections/types.ts`. ✓
