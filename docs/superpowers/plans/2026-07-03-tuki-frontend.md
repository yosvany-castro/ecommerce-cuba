# Tuki Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar el diseño Tuki (`docs/design/tuki-desktop.dc.html`) como LA capa visual pública de la tienda, conectada al backend real (búsqueda híbrida con ingesta async, feed personalizado, slate/resolve, tracking, checkout anónimo, perfiles demo = identidades anónimas sembradas), eliminando la UI `(shop)` vieja y conservando `/admin`.

**Architecture:** Rutas reales de Next App Router en un nuevo route group `src/app/(tuki)/` — `/` (home SSR + feed infinito), `/search` (client, two-phase), `/c/[category]` (SSR SEO), `/products/[id]` (SSR + client), `/checkout` (client). Shell compartido (navbar+buscador+drawers) en el layout del grupo. Los componentes visuales SOLO importan `src/storefront/contract.ts` (+ helpers puros de `src/components/tuki/lib.ts` y `src/lib/client/track`). Los atributos cosméticos del diseño (rating, ventas, colores, tallas, peso) se derivan determinísticamente del product id (`demoAttrs`), NO se persisten.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4 (solo para hovers/animaciones; el port usa inline styles del diseño), vitest, Playwright, pg (Supabase remoto).

## Global Constraints

- **Fuente visual de verdad:** `docs/design/tuki-desktop.dc.html` (1424 líneas). Markup: 33–872. Lógica/bindings de referencia: `renderVals()` en 1172–1420. Rangos por sección: shell 33–123 (aviso 35–43, buscador 54–91, perfil 92–115, carro 116–121), skeleton boot 128–138, HOME 142–300, LISTADO (categoría+búsqueda) 301–436, PRODUCTO 437–542, CHECKOUT 543–714, ÉXITO 715–728, drawer carro 738–820, drawer filtros 821–866, toast 867–872.
- **Reglas de traducción DSL→TSX** (aplican a TODO port de markup):
  - `<sc-if value="{{ x }}">…</sc-if>` → `{x && (…)}`
  - `<sc-for list="{{ xs }}" as="x">…</sc-for>` → `{xs.map((x) => (…))}` con `key`
  - `{{ binding }}` → `{binding}`; `style="a:{{ x }}"` → `style={{ a: x }}`
  - `style-hover="…"` → clase CSS en `globals.css` (prefijo `tk-`), NO JS
  - `onClick/onChange/onKeyDown/onFocus/onBlur/onMouseDown/onScroll` → props React idénticas; `key="{{ k }}"` → `key={k}` (remonta para re-animar)
  - Animaciones `@keyframes` del diseño (líneas 15–29) van una sola vez a `globals.css`
  - El estado del diseño (`this.state`) se reparte: carrito → `TukiCartProvider`; búsqueda → `useTukiSearch`; resto → estado local del componente de pantalla
- **Taxonomía REAL** (no la del diseño): `ropa, electronica, hogar, juguetes_bebe, belleza, otros` (enum de `products.metadata->>'category'`). El mapa visual `CATS` de Task 1 asigna la paleta del diseño a estas 6.
- **Frontera de imports:** componentes visuales importan SOLO `@/storefront/contract`, `@/components/tuki/*`, `@/lib/client/track*`. Nada de `@/sectors/*` en client components. Las pages (server) importan la DAL (`@/storefront/pages/*`). Hay un test ejecutable de frontera — mantenerlo verde (ajustar sus rutas si apunta a los componentes viejos).
- **Anónimo:** la UI pública NO usa Auth0. Cookies `anonymous_id` (httpOnly:false, legible/escribible por JS) y `session_id` (httpOnly) ya las emite `src/proxy.ts` sin tocar DB.
- **Agentes LLM:** NO conectar nada a `g-agents` (gated off). La personalización visible viene del feed heurístico + `card.reason`.
- **Eventos a disparar desde Tuki** (contrato exacto en `src/sectors/a-tracking/events/schema.ts`): `product_view {product_id, source: "home"|"category"|"search"|"direct"}`, `add_to_cart`/`remove_from_cart {product_id, quantity}`, `search {raw_query, results_count, method}`, `category_click {category}`, `filter_applied {filter_type, filter_value}`. Usar `track()` de `src/lib/client/track.ts` (nunca lanza).
- **No romper:** `/admin/*` (usa `SearchTraceView` y `UserDebugView` — NO borrarlos), rutas `/api/*` existentes, `scripts/*`, `tests/*` que no toquen la UI vieja.
- **Commits:** convención del repo, en español: `feat(tuki): …`, `chore(tuki): …`. Commit al final de cada task como mínimo.
- **Verificación por task:** `pnpm typecheck` + el test del task. `pnpm dev` usa la DB Supabase remota ya poblada (si el home sale vacío: `pnpm cron:catalog-fill --pages 1`).

---

### Task 0: Fuentes, keyframes globales y asset del diseño

**Files:**
- Modify: `src/app/layout.tsx` (fuentes via next/font)
- Modify: `src/app/globals.css` (keyframes + clases hover `tk-*`)
- Ya copiado (commitear): `docs/design/tuki-desktop.dc.html`

**Interfaces:**
- Produces: variables CSS `--font-brico`, `--font-sans`, `--font-serif`, `--font-mono` disponibles globalmente; keyframes `shimmer,secIn,screenIn,popIn,toastIn,fadeIn,drawerIn,dropIn,marquee,checkPop,spinSlow,sparkPulse,barStripes`.

- [ ] **Step 1: Fuentes en el root layout**

```tsx
// src/app/layout.tsx — añadir arriba:
import { Bricolage_Grotesque, Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";

const brico = Bricolage_Grotesque({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-brico" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
```

y en el `<html>`: `<html lang="es" className={`${brico.variable} ${sans.variable} ${serif.variable} ${mono.variable}`}>`. No tocar `Auth0Provider` ni `IdentityMergeOnLogin` (admin los usa).

- [ ] **Step 2: Keyframes y hovers en globals.css**

Copiar VERBATIM los `@keyframes` de `docs/design/tuki-desktop.dc.html` líneas 15–29 a `src/app/globals.css`. Añadir las clases hover que el port usará (crearlas aquí; los ports las referencian):

```css
.tk-hov-dark:hover { color: #1c1d20 !important; }
.tk-hov-bd-dark:hover { border-color: #1c1d20 !important; }
.tk-hov-bg:hover { background: #fafaf8 !important; }
.tk-hov-white:hover { color: #fff !important; }
.tk-hov-lift:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(28, 29, 32, 0.09); }
```

(Si durante un port aparece un `style-hover` distinto, añadir su clase `tk-*` aquí en ese task.)

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm typecheck && pnpm dev` (abrir http://localhost:3000 — debe seguir renderizando la UI vieja sin errores de consola de fuentes).

```bash
git add docs/design src/app/layout.tsx src/app/globals.css
git commit -m "feat(tuki): fuentes del diseño, keyframes globales y asset dc.html (T0)"
```

---

### Task 1: Helpers puros — `tuki/lib.ts` (fmt, CATS, stripe, demoAttrs, sectionize)

**Files:**
- Create: `src/components/tuki/lib.ts`
- Test: `tests/unit/tuki-lib.test.ts`

**Interfaces:**
- Consumes: `StorefrontCard` de `@/storefront/contract` (tipo puro).
- Produces (firmas exactas que TODOS los tasks siguientes usan):

```ts
export interface CatDef { id: string; label: string; tint: string; deep: string; a: string; b: string }
export const CATS: Record<string, CatDef>; // claves: ropa, electronica, hogar, juguetes_bebe, belleza, otros
export const OFFER_TINT: string; export const OFFER_DEEP: string;
export function catOf(category: string | null | undefined): CatDef; // fallback → CATS.otros
export function stripe(c: Pick<CatDef, "a" | "b">): string;
export function fmt(cents: number): string; // 2499 → "$24.99"
export interface DemoAttrs { rating: number; sold: string; oldPriceCents: number | null; colors: { name: string; hex: string }[]; sizes: string[]; weightLb: number }
export function demoAttrs(productId: string, category: string | null | undefined, priceCents: number): DemoAttrs; // determinístico por id
export interface TukiSection { kind: "aisle" | "focus" | "grid"; title: string; why: string; cat: CatDef; cards: StorefrontCard[] }
export function sectionize(cards: StorefrontCard[], startIndex?: number): TukiSection[];
```

- [ ] **Step 1: Test que falla**

```ts
// tests/unit/tuki-lib.test.ts
import { describe, expect, it } from "vitest";
import { CATS, catOf, demoAttrs, fmt, sectionize, stripe } from "@/components/tuki/lib";

const card = (id: string, category: string) => ({
  id, title: "p" + id, price_cents: 1000, currency: "USD", image_url: null,
  category,
}) as never;

describe("tuki lib", () => {
  it("fmt convierte centavos", () => {
    expect(fmt(2499)).toBe("$24.99");
    expect(fmt(0)).toBe("$0.00");
  });
  it("CATS cubre la taxonomía real y catOf hace fallback a otros", () => {
    for (const k of ["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"]) expect(CATS[k]).toBeDefined();
    expect(catOf("no-existe").id).toBe("otros");
    expect(catOf(null).id).toBe("otros");
    expect(stripe(CATS.hogar)).toContain("repeating-linear-gradient");
  });
  it("demoAttrs es determinístico y acotado", () => {
    const a1 = demoAttrs("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa", 2490);
    const a2 = demoAttrs("3f2b8c31-3a71-4b06-91ec-9217efa5e48b", "ropa", 2490);
    expect(a1).toEqual(a2);
    expect(a1.rating).toBeGreaterThanOrEqual(4.3);
    expect(a1.rating).toBeLessThanOrEqual(4.9);
    expect(a1.sizes.length).toBeGreaterThan(0); // ropa lleva tallas
    if (a1.oldPriceCents !== null) expect(a1.oldPriceCents).toBeGreaterThan(2490);
    expect(demoAttrs("otro-id", "electronica", 2490).sizes).toEqual([]); // electronica sin tallas
    expect(a1.weightLb).toBeGreaterThan(0);
  });
  it("sectionize agrupa en [aisle6, focus1, grid4] cíclico sin perder cards", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(String(i), "hogar"));
    const secs = sectionize(cards);
    expect(secs.map((s) => s.kind)).toEqual(["aisle", "focus", "grid", "aisle"]);
    expect(secs.flatMap((s) => s.cards)).toHaveLength(13);
    expect(secs[0].title.length).toBeGreaterThan(0);
    expect(secs[0].cat.id).toBe("hogar");
  });
});
```

- [ ] **Step 2: Correr y ver fallo**

Run: `pnpm vitest run tests/unit/tuki-lib.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementar `lib.ts`**

```ts
// src/components/tuki/lib.ts — helpers puros del port Tuki. Sin imports de sectors.
import type { StorefrontCard } from "@/storefront/contract";

export interface CatDef { id: string; label: string; tint: string; deep: string; a: string; b: string }
// Paleta del diseño (dc.html 874–881) reasignada a la taxonomía REAL del catálogo.
export const CATS: Record<string, CatDef> = {
  electronica: { id: "electronica", label: "Electrónica", tint: "#E9F1FB", deep: "#4C6E96", a: "#F2F6FB", b: "#E4EDF8" },
  hogar: { id: "hogar", label: "Hogar", tint: "#EAF2EA", deep: "#557A55", a: "#F0F6F0", b: "#E2EDE2" },
  ropa: { id: "ropa", label: "Ropa", tint: "#F0ECFA", deep: "#6B5BA8", a: "#F5F2FC", b: "#EAE4F6" },
  belleza: { id: "belleza", label: "Belleza", tint: "#FBEDF3", deep: "#A25578", a: "#FBF2F6", b: "#F4E3EB" },
  juguetes_bebe: { id: "juguetes_bebe", label: "Juguetes y bebé", tint: "#E4F2F1", deep: "#3E7F78", a: "#EDF6F5", b: "#DFEEEC" },
  otros: { id: "otros", label: "Otros", tint: "#FBEBEA", deep: "#A25B52", a: "#FAF0EF", b: "#F3E1DF" },
};
export const OFFER_TINT = "#FBEFE2";
export const OFFER_DEEP = "#A2683B";

export function catOf(category: string | null | undefined): CatDef {
  return (category && CATS[category]) || CATS.otros;
}
export function stripe(c: Pick<CatDef, "a" | "b">): string {
  return `repeating-linear-gradient(-45deg, ${c.a}, ${c.a} 9px, ${c.b} 9px, ${c.b} 18px)`;
}
export function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

// ponytail: atributos cosméticos (rating/ventas/variantes/peso) derivados del id,
// no persistidos — cuando exista proveedor real, emitirlos en attributes y
// persistirlos en products.metadata; este módulo se vuelve un mapeo directo.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const PALETTE = [
  { name: "Negro", hex: "#26262B" }, { name: "Crema", hex: "#EDE6D6" }, { name: "Azul", hex: "#3D4A66" },
  { name: "Verde", hex: "#6B7A5A" }, { name: "Terracota", hex: "#C56B4F" }, { name: "Gris", hex: "#9C9EA3" },
];
export const FILTER_COLORS = PALETTE;
const WEIGHT_BASE: Record<string, number> = { ropa: 0.6, electronica: 1.2, hogar: 3.0, juguetes_bebe: 1.0, belleza: 0.4, otros: 1.5 };

export interface DemoAttrs { rating: number; sold: string; oldPriceCents: number | null; colors: { name: string; hex: string }[]; sizes: string[]; weightLb: number }
export function demoAttrs(productId: string, category: string | null | undefined, priceCents: number): DemoAttrs {
  const h = hash(productId);
  const cat = catOf(category).id;
  const rating = Math.round((4.3 + ((h % 7) / 10)) * 10) / 10; // 4.3..4.9
  const soldN = 120 + (h % 4200);
  const sold = soldN >= 1000 ? (soldN / 1000).toFixed(1) + "k" : String(soldN);
  const oldPriceCents = h % 10 < 3 ? Math.round(priceCents * (1.25 + (h % 4) * 0.1)) : null;
  const nColors = cat === "ropa" || cat === "hogar" ? 2 + (h % 3) : h % 2 === 0 ? 2 : 0;
  const colors = Array.from({ length: nColors }, (_, i) => PALETTE[(h + i * 7) % PALETTE.length]);
  const sizes = cat === "ropa" ? ["S", "M", "L", "XL"] : [];
  const weightLb = Math.round((WEIGHT_BASE[cat] ?? 1) * (0.5 + (h % 100) / 66) * 10) / 10;
  return { rating, sold, oldPriceCents, colors, sizes, weightLb };
}

const WHYS = ["elegido para ti", "también encaja contigo", "tendencia hoy en tu zona", "muy pedido esta semana"];
export interface TukiSection { kind: "aisle" | "focus" | "grid"; title: string; why: string; cat: CatDef; cards: StorefrontCard[] }
/** Agrupa cards del feed real en secciones visuales estilo Tuki: [aisle 6, focus 1, grid 4] cíclico. */
export function sectionize(cards: StorefrontCard[], startIndex = 0): TukiSection[] {
  const PATTERN: { kind: TukiSection["kind"]; n: number }[] = [
    { kind: "aisle", n: 6 }, { kind: "focus", n: 1 }, { kind: "grid", n: 4 },
  ];
  const out: TukiSection[] = [];
  let i = 0, p = startIndex;
  while (i < cards.length) {
    const { kind, n } = PATTERN[p % PATTERN.length];
    const chunk = cards.slice(i, i + n);
    if (chunk.length === 0) break;
    const counts = new Map<string, number>();
    for (const c of chunk) {
      const k = catOf((c as { category?: string | null }).category).id;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const domCat = catOf([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
    const withReason = chunk.find((c) => c.reason);
    out.push({
      kind, cards: chunk, cat: domCat,
      title: kind === "focus" ? "Una cosa buena" : kind === "grid" ? "Para ti" : `Pasillo de ${domCat.label.toLowerCase()}`,
      why: withReason?.reason ?? WHYS[p % WHYS.length],
    });
    i += n; p += 1;
  }
  return out;
}
```

- [ ] **Step 4: Test en verde**

Run: `pnpm vitest run tests/unit/tuki-lib.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/tuki/lib.ts tests/unit/tuki-lib.test.ts
git commit -m "feat(tuki): helpers puros — paleta por taxonomía real, demoAttrs determinístico, sectionize (T1)"
```

---

### Task 2: `StorefrontCard.category` — threading desde products.metadata

**Files:**
- Modify: `src/storefront/contract.ts` (añadir campo opcional)
- Modify: el punto ÚNICO donde `FeedItem`/productos hidratados se mapean a items de card — localizarlo con `grep -rn "price_cents" src/sectors/d-personalization/feed.ts src/sectors/f-slate src/app/api/feed src/storefront` : son (a) el mapeo de `serveFeedPage` → items del slate (feed.ts, los `FeedItem {product: ProductListRow, reason, position}` ya traen `metadata`), (b) la hidratación de secciones slate (en f-slate, el resolver hidrata ids → items con un SELECT que incluye `metadata` o hay que añadírselo), (c) `src/storefront/map.ts` si re-mapea items.
- Test: `tests/unit/storefront-card-category.test.ts` (o ampliar un test existente del mapeo si ya lo hay — buscar en tests/unit por "storefront" o "map").

**Interfaces:**
- Produces: `StorefrontCard.category?: string | null` poblado con `product.metadata.category` en TODOS los orígenes de cards: home/`/api/feed/page` (feed), `/api/slate/resolve` (pdp cross_sell, cart add-ons).

- [ ] **Step 1: Ampliar contrato**

```ts
// src/storefront/contract.ts — StorefrontCard:
export interface StorefrontCard {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  category?: string | null; // metadata.category normalizada (ropa|electronica|hogar|juguetes_bebe|belleza|otros)
  reason?: string;
  position?: number;
}
```

- [ ] **Step 2: Test que falla** — escribir contra la función de mapeo real que se encuentre en el grep (ejemplo si es un mapper puro exportable; si el mapeo está inline en `serveFeedPage`, extraer `toCard(product, reason?, position?)` a una función exportada en el mismo archivo y testear esa):

```ts
// tests/unit/storefront-card-category.test.ts
import { describe, expect, it } from "vitest";
import { toCard } from "@/sectors/d-personalization/feed"; // ajustar al nombre/lugar real extraído

describe("toCard", () => {
  it("propaga metadata.category al StorefrontCard", () => {
    const c = toCard({
      id: "x", title: "t", description: "", price_cents: 100, currency: "USD",
      image_url: null, metadata: { category: "hogar" }, created_at: "2026-01-01",
    } as never, "por algo", 3);
    expect(c.category).toBe("hogar");
    expect(c.reason).toBe("por algo");
  });
  it("category null si metadata no la trae", () => {
    const c = toCard({ id: "x", title: "t", description: "", price_cents: 100, currency: "USD", image_url: null, metadata: {}, created_at: "" } as never);
    expect(c.category).toBeNull();
  });
});
```

- [ ] **Step 3: Ver fallo** — `pnpm vitest run tests/unit/storefront-card-category.test.ts` → FAIL.

- [ ] **Step 4: Implementar** — extraer/ajustar el mapper para incluir `category: (product.metadata as { category?: string })?.category ?? null`, y aplicar en los 2–3 puntos de origen (feed page items + slate resolve items). Si la hidratación de secciones f-slate no selecciona `metadata`, añadir la columna al SELECT. NO tocar la lógica de ranking.

- [ ] **Step 5: Verde + integración**

Run: `pnpm vitest run tests/unit/storefront-card-category.test.ts && pnpm typecheck && pnpm test:unit`
Expected: PASS todos (los unit existentes no deben romperse — el campo es opcional).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(tuki): StorefrontCard.category desde products.metadata en feed y slate (T2)"
```

---

### Task 3: Ruta de sugerencias `GET /api/suggest`

**Files:**
- Create: `src/app/api/suggest/route.ts`
- Test: `tests/integration/api-suggest.test.ts` (seguir el patrón de los tests de integración existentes en tests/integration — usan la DB real con `test_schema`; copiar el setup de uno existente, p. ej. el de search o slate).

**Interfaces:**
- Produces: `GET /api/suggest?q=frei` → `{ suggestions: { id: string; title: string; category: string | null }[] }` (máx 6, ILIKE sobre title, solo is_active).

- [ ] **Step 1: Test de integración que falla** (adaptar imports de setup al patrón del repo):

```ts
// tests/integration/api-suggest.test.ts — patrón: mismo harness que los tests de rutas existentes
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/suggest/route";
import { NextRequest } from "next/server";

describe("GET /api/suggest", () => {
  it("devuelve máx 6 sugerencias con id, title y category", async () => {
    const res = await GET(new NextRequest("http://x/api/suggest?q=a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions.length).toBeLessThanOrEqual(6);
    for (const s of body.suggestions) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.title).toBe("string");
    }
  });
  it("q vacía → lista vacía sin tocar DB", async () => {
    const res = await GET(new NextRequest("http://x/api/suggest?q="));
    expect((await res.json()).suggestions).toEqual([]);
  });
});
```

- [ ] **Step 2: Ver fallo** — `pnpm vitest run tests/integration/api-suggest.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// src/app/api/suggest/route.ts — typeahead barato para el buscador Tuki (ILIKE, sin embeddings).
import { NextRequest, NextResponse } from "next/server";
import { withPg } from "@/lib/db/helpers";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ suggestions: [] });
  const rows = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT id::text AS id, title, metadata->>'category' AS category
       FROM products WHERE is_active = true AND title ILIKE '%' || $1 || '%'
       ORDER BY last_refreshed_at DESC LIMIT 6`,
      [q],
    );
    return r.rows as { id: string; title: string; category: string | null }[];
  });
  return NextResponse.json({ suggestions: rows });
}
```

- [ ] **Step 4: Verde** — `pnpm vitest run tests/integration/api-suggest.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tuki): GET /api/suggest — typeahead ILIKE (T3)"`

---

### Task 4: `TukiCartProvider` + `Toast` (infraestructura client)

**Files:**
- Create: `src/components/tuki/cart.tsx` (provider + hook)
- Create: `src/components/tuki/cart-core.ts` (lógica pura del carrito, sin React)
- Create: `src/components/tuki/Toast.tsx`
- Test: `tests/unit/tuki-cart-core.test.ts`

**Interfaces:**
- Consumes: `track()` de `@/lib/client/track`; `demoAttrs`, `fmt` de `./lib`.
- Produces:

```ts
// cart-core.ts
export interface TukiCartItem { key: string; product_id: string; qty: number; color: string | null; size: string | null; title: string; price_cents: number; category: string | null; image_url: string | null }
export interface CardSnapshot { id: string; title: string; price_cents: number; category?: string | null; image_url: string | null }
export function cartKey(productId: string, color: string | null, size: string | null): string;
export function addItem(items: TukiCartItem[], snap: CardSnapshot, qty: number, color: string | null, size: string | null): TukiCartItem[];
export function setQty(items: TukiCartItem[], key: string, delta: number): TukiCartItem[]; // clamp qty>=1
export function removeItem(items: TukiCartItem[], key: string): TukiCartItem[];
export function subtotalCents(items: TukiCartItem[]): number;
export function cartWeightLb(items: TukiCartItem[]): number; // usa demoAttrs(product_id, category, price)

// cart.tsx
export function TukiCartProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useTukiCart(): {
  items: TukiCartItem[]; count: number; subtotal: number; weightLb: number;
  open: boolean; setOpen(v: boolean): void;
  add(snap: CardSnapshot, qty?: number, color?: string | null, size?: string | null): void; // fires track add_to_cart urgent + toast + abre nada
  inc(key: string): void; dec(key: string): void; remove(key: string): void; clear(): void;
};

// Toast.tsx
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function useToast(): (text: string) => void; // 2s auto-hide, markup del diseño (dc.html 867–872)
```

Persistencia: localStorage key `` `tuki_cart:${cookie anonymous_id ?? "anon"}` `` (mismo patrón que el CartProvider viejo, `getCookie` inline). `add`/`remove` disparan `track("add_to_cart"|"remove_from_cart", { product_id, quantity }, { urgent: true })`.

- [ ] **Step 1: Test de la lógica pura (falla)**

```ts
// tests/unit/tuki-cart-core.test.ts
import { describe, expect, it } from "vitest";
import { addItem, cartKey, removeItem, setQty, subtotalCents } from "@/components/tuki/cart-core";

const snap = { id: "p1", title: "Producto", price_cents: 2000, category: "hogar", image_url: null };

describe("tuki cart core", () => {
  it("agrega y fusiona por key producto+variante", () => {
    let items = addItem([], snap, 1, "Negro", null);
    items = addItem(items, snap, 2, "Negro", null);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(3);
    items = addItem(items, snap, 1, "Crema", null); // otra variante → otra línea
    expect(items).toHaveLength(2);
    expect(items[0].key).toBe(cartKey("p1", "Negro", null));
  });
  it("setQty clampa a 1 y remove elimina", () => {
    let items = addItem([], snap, 1, null, null);
    items = setQty(items, items[0].key, -5);
    expect(items[0].qty).toBe(1);
    expect(removeItem(items, items[0].key)).toHaveLength(0);
  });
  it("subtotal en centavos", () => {
    const items = addItem(addItem([], snap, 2, null, null), { ...snap, id: "p2", price_cents: 500 }, 1, null, null);
    expect(subtotalCents(items)).toBe(4500);
  });
});
```

- [ ] **Step 2: Ver fallo** — `pnpm vitest run tests/unit/tuki-cart-core.test.ts` → FAIL.

- [ ] **Step 3: Implementar `cart-core.ts`** (puro, ~40 líneas: key = `id|color|size`; add busca key y suma; demoAttrs para peso). Luego `cart.tsx`: context + estado `items` inicial de localStorage (try/catch), persistencia en cada cambio, `open` para el drawer, y `Toast.tsx` con context y el markup/animación `toastIn` del diseño.

- [ ] **Step 4: Verde** — `pnpm vitest run tests/unit/tuki-cart-core.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tuki): carrito client con snapshot por variante + toast (T4)"`

---

### Task 5: Shell + Home (reemplaza `/`)

**Files:**
- Create: `src/app/(tuki)/layout.tsx`
- Create: `src/components/tuki/Shell.tsx` (aviso + navbar + buscador UI + menú perfil UI + botón carro; drawers montados aquí)
- Create: `src/components/tuki/ProductCard.tsx`
- Create: `src/components/tuki/HomeFeed.tsx` (client: secciones + scroll infinito + seen)
- Create: `src/app/(tuki)/page.tsx` (server)
- Delete: `src/app/(shop)/page.tsx` (conflicto de ruta `/`)

**Interfaces:**
- Consumes: `getHomePage()` de `@/storefront/pages/home` (server); `GET /api/feed/page?cursor=` → `{items: StorefrontCard[], next_cursor, slate_id}`; `POST /api/feed/seen {slate_id, positions}` via `observeSeen(el, slateId, position)` de `@/lib/client/seen-reporter`; `sectionize`, `catOf`, `demoAttrs`, `fmt`, `stripe` de `./lib`; `useTukiCart`, `useToast`.
- Produces: `ProductCard({ card, onOpen }: { card: StorefrontCard; onOpen?: () => void })` — markup dc.html de tarjeta (dentro de HOME 142–300, la tarjeta de pasillo), precio `fmt(card.price_cents)`, tint/stripe de `catOf(card.category)`, rating/sold/dots de `demoAttrs`, botón + llama `useTukiCart().add`, click navega `router.push('/products/'+card.id)` y dispara `track("product_view", { product_id, source })` — `source` viene por prop (`"home" | "category" | "search" | "direct"`). `Shell` acepta `children` y renderiza los overlays.

**Detalles de port:**
- `Shell.tsx` (client): portar dc.html 33–123 con las reglas globales. Buscador: estado local `q`, dropdown con RECIENTES (localStorage `tuki_recents`, máx 5) + TENDENCIA (const `["freidora de aire","audífonos","yoga","monstera","sérum","mochila"]`) + sugerencias de `/api/suggest` con debounce 200ms; Enter o ✦ → `router.push('/search?q='+encodeURIComponent(q))`. NavLinks = Ofertas… NO: no hay categoría virtual "ofertas" en backend — navLinks = 4 categorías reales top (`electronica, ropa, hogar, belleza`) → `/c/[id]`, y disparan `track("category_click", { category })`. Menú perfil: markup 92–115, lista estática en este task (wiring real en T10). Aviso bar: mensajes rotando con `envioGratisDesde=50` fijo (const `FREE_CENTS = 5000` en lib.ts si se prefiere). Enlace "móvil ↗" del diseño: OMITIR.
- `page.tsx` (server): `const page = await getHomePage()` → localizar sección `hero_grid` → pasar `items`, `next_cursor`, `slate_id` a `<HomeFeed initialCards next_cursor slate_id greeting />`. `export const dynamic = "force-dynamic"`.
- `HomeFeed.tsx` (client): `sectionize(initialCards)` → render de secciones estilo HOME dc.html 142–300 (aisle = fila horizontal con título/why/tint; focus = tarjeta grande con desc — usar `card.reason ?? "elegido del día"`; grid = 2×2). Scroll infinito: `onScroll` del contenedor (o IntersectionObserver del sentinel), fetch `/api/feed/page?cursor=` → `sectionize(newItems, patternOffset)` y append; `observeSeen` en cada card (slate_id + position). Skeleton boot dc.html 128–138 mientras hidrata. El greeting del home usa texto fijo del diseño ("Hola — armamos esto para ti") en este task; en T10 se personaliza por perfil.
- `(tuki)/layout.tsx`: `<ToastProvider><TukiCartProvider><Shell>{children}</Shell></TukiCartProvider></ToastProvider>` + wrapper `div` con fuente `var(--font-sans)`, bg `#FAFAF8`.

- [ ] **Step 1: Borrar `src/app/(shop)/page.tsx`** (git rm) — la home vieja muere aquí; el resto de (shop) sigue vivo.
- [ ] **Step 2: Implementar layout + Shell + ProductCard** (portar markup con reglas globales).
- [ ] **Step 3: Implementar page.tsx + HomeFeed** (SSR + infinito + seen).
- [ ] **Step 4: Verificación manual observable**

Run: `pnpm typecheck && pnpm dev` → abrir `/`: shell Tuki con fuentes correctas, feed con secciones y cards reales (títulos/precios de la DB), scroll infinito trae más, sin errores de consola. Verificar en Network que `/api/feed/seen` dispara al ver cards.
Expected: home Tuki funcional contra datos reales.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tuki): shell + home SSR con feed real seccionado e infinito (T5)"`

---

### Task 6: Listado compartido + Búsqueda two-phase (reemplaza `/search`)

**Files:**
- Create: `src/components/tuki/Listing.tsx` (grilla + sidebar categorías + quick filters + botón "Más filtros"; usado por búsqueda y categoría)
- Create: `src/components/tuki/FiltersDrawer.tsx` (dc.html 821–866)
- Create: `src/components/tuki/filters.ts` (lógica pura de filtros/orden)
- Create: `src/components/tuki/useTukiSearch.ts` (hook two-phase)
- Create: `src/components/tuki/SearchView.tsx` (loader por etapas dc.html — bloque `listLoading` dentro de 301–436 + resultados)
- Create: `src/app/(tuki)/search/page.tsx` (client wrapper con `useSearchParams`)
- Delete: `src/app/(shop)/search/page.tsx`
- Test: `tests/unit/tuki-filters.test.ts`

**Interfaces:**
- Consumes: `GET /api/search?q=` → `{ products: {id,title,description,price_cents,currency,image_url,metadata,created_at}[], count, hit_cache, called_mock, method, normalized }`; `track("search", { raw_query, results_count, method })`; `track("filter_applied", { filter_type, filter_value })`.
- Produces:

```ts
// filters.ts
export interface AdvState { sort: "rel" | "asc" | "desc" | "top"; price: "p1" | "p2" | "p3" | "p4" | null; colors: string[]; oferta: boolean; envio: boolean; r4: boolean }
export interface FilterableCard { card: StorefrontCard; attrs: DemoAttrs } // attrs = demoAttrs(card)
export function applyFilters(list: FilterableCard[], adv: AdvState): FilterableCard[]; // misma semántica que applyAdv del diseño (dc.html 1097–1111): oferta→oldPriceCents!=null, r4→rating>=4.6, envio→price_cents>=2000, p1<1500, p2 1500–2999, p3 3000–4999, p4>=5000, colors∩, sort asc/desc/top

// useTukiSearch.ts
export function useTukiSearch(): {
  phase: "idle" | "loading" | "results";
  progress: number; // 0..1 para la barra/etapas del loader
  cards: StorefrontCard[]; // products mapeados (category de metadata.category)
  meta: { hit_cache: boolean; called_mock: boolean; method: string } | null;
  run(q: string): void;
};
```

**Semántica two-phase de `run(q)` (el corazón de la conexión búsqueda):**

```ts
// 1) fetch GET /api/search?q= → r1.
// 2) Si r1.called_mock === true  → hay ingesta externa en vuelo (async, F4 T3):
//      animar progress 0→1 en ~4200ms (interval 90ms, easing lineal),
//      al llegar a 1 → fetch de nuevo la MISMA q (r2; la caché exacta fue
//      invalidada por la ingesta ⇒ r2 trae lo local + lo externo).
//      cards = r2.products (fallback r1 si r2 falla). meta = r2.
//    Si r1.called_mock === false → resultados ya completos (caché o frescura):
//      animar 0→1 en ~800ms y cards = r1.products.
// 3) phase="results"; track("search", { raw_query: q, results_count: cards.length, method: meta.method }).
// Guardar q en localStorage tuki_recents (máx 5, dedup).
// ponytail: polling de 1 re-fetch fijo; si el ingest tarda >4.2s se ve en la
// PRÓXIMA búsqueda igual (igual que el backend promete). Suficiente para demo.
```

- `SearchView`: mientras `phase==="loading"` renderiza el loader del diseño (frases por etapa, pasos `rastrear tiendas → leer precios → comparar → ordenar` con `stageIdx = progress<0.3?0:progress<0.58?1:progress<0.85?2:3`, contador `Math.floor((1-(1-progress)^2)*286)`, línea de tiendas `SCAN_STORES` del diseño, tips). Con `phase==="results"`, `Listing` con las cards + `«{q}» · N resultados ordenados para ti`. Honestidad visible: si `meta.hit_cache`, badge pequeño "resultados al instante — ya conocíamos esta búsqueda".
- `Listing`: sidebar con las 6 CATS reales (pick → `/c/[id]`), quick filters (`En oferta`, `★ 4.6+`, `Envío gratis`, `Precio ↑`) y FiltersDrawer avanzado — todos client-side sobre `FilterableCard[]`, disparando `track("filter_applied", …)`.

- [ ] **Step 1: Test de `applyFilters` (falla)**

```ts
// tests/unit/tuki-filters.test.ts
import { describe, expect, it } from "vitest";
import { applyFilters } from "@/components/tuki/filters";

const f = (id: string, price: number, rating: number, old: number | null, colors: string[]) => ({
  card: { id, title: id, price_cents: price, currency: "USD", image_url: null } as never,
  attrs: { rating, sold: "1", oldPriceCents: old, colors: colors.map((n) => ({ name: n, hex: "#000" })), sizes: [], weightLb: 1 },
});
const base = [f("a", 1000, 4.4, null, ["Negro"]), f("b", 2500, 4.8, 3000, ["Crema"]), f("c", 6000, 4.6, null, [])];

describe("applyFilters", () => {
  it("oferta filtra por oldPrice, r4 por rating, precio por bandas", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: [], oferta: true, envio: false, r4: false }).map((x) => x.card.id)).toEqual(["b"]);
    expect(applyFilters(base, { sort: "rel", price: "p4", colors: [], oferta: false, envio: false, r4: true }).map((x) => x.card.id)).toEqual(["c"]);
  });
  it("sort asc/top", () => {
    expect(applyFilters(base, { sort: "asc", price: null, colors: [], oferta: false, envio: false, r4: false })[0].card.id).toBe("a");
    expect(applyFilters(base, { sort: "top", price: null, colors: [], oferta: false, envio: false, r4: false })[0].card.id).toBe("b");
  });
  it("colors interseca", () => {
    expect(applyFilters(base, { sort: "rel", price: null, colors: ["Crema"], oferta: false, envio: false, r4: false }).map((x) => x.card.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Ver fallo** → implementar `filters.ts` → verde: `pnpm vitest run tests/unit/tuki-filters.test.ts`.
- [ ] **Step 3: Implementar `useTukiSearch` + `SearchView` + `Listing` + `FiltersDrawer` + page** (port dc.html 301–436 + 821–866). Borrar `src/app/(shop)/search/page.tsx` en el mismo paso (conflicto de ruta).
- [ ] **Step 4: Verificación manual del flujo completo**

Run: `pnpm typecheck && pnpm dev` → buscar "freidora de aire" desde el navbar: loader por etapas ~4s (si dispara mock) → resultados reales; repetir la misma búsqueda → casi instantáneo con badge de caché; en Network ver 2 GET `/api/search` en la primera y 1 en la segunda; evento `search` en POST `/api/track`.
Expected: two-phase visible y honesto.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tuki): búsqueda two-phase con loader real + listado y filtros compartidos (T6)"`

---

### Task 7: Categoría (reemplaza `/c/[category]`)

**Files:**
- Create: `src/app/(tuki)/c/[category]/page.tsx` (server, SSR sin cookies — conservar la garantía anti-cloaking del page viejo)
- Create: `src/components/tuki/CategoryView.tsx` (client: Listing + filtros sobre los items SSR)
- Delete: `src/app/(shop)/c/[category]/page.tsx`

**Interfaces:**
- Consumes: `fetchCategoryPage(category, page, pg)` + `CATEGORY_PAGE_SIZE` de `@/sectors/b-catalog/repository/category-page` con `withPg` (igual que el page viejo — copiar su validación `CATEGORY_RE` y paginación `?page=N` con `<Link>`s reales); `Listing`/`filters` de T6; `catOf` para header tint.
- Produces: página `/c/electronica` etc. con el header de categoría del diseño (crumb, título, why "todo el pasillo de …", tint) + grilla `Listing` + paginación con enlaces (mantener SEO). Los items de `fetchCategoryPage` se mapean a `StorefrontCard` con `category` = el slug de la ruta.

- [ ] **Step 1: Implementar page + CategoryView** (port del header de listado dc.html 301–340 + grilla reutilizada; scroll infinito NO — mantener paginación por enlaces del page viejo por SEO; el "cargando más" del diseño no aplica aquí).
- [ ] **Step 2: Borrar el page viejo** (mismo paso, conflicto de ruta).
- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm dev` → `/c/hogar` renderiza con estilo Tuki, `?page=2` funciona con enlaces, `curl -s localhost:3000/c/hogar | grep -i hogar` devuelve HTML SSR (sin JS).
Expected: SSR determinista intacto.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(tuki): landing de categoría SSR con estilo Tuki (T7)"`

---

### Task 8: PDP (reemplaza `/products/[id]`)

**Files:**
- Create: `src/app/(tuki)/products/[id]/page.tsx` (server: producto + secciones pdp)
- Create: `src/components/tuki/ProductView.tsx` (client: galería, variantes, qty, acordeones, add, combos)
- Delete: `src/app/(shop)/products/[id]/page.tsx`

**Interfaces:**
- Consumes: la consulta de producto del page viejo (leerlo ANTES de borrar y reutilizar su fuente de datos — trae `id,title,description,price_cents,currency,image_url,metadata`); `getProductSections(id, category)` de `@/storefront/pages/product` (cross_sell real); `demoAttrs` (variantes/rating), `useTukiCart`, `useToast`, `track`.
- Produces: `/products/[id]` con port de dc.html 437–542: galería (stripe tint como placeholder de imagen, o `image_url` si existe), precio/old/save, selector color/talla (de `demoAttrs`), qty, acordeones (Descripción = `description` real; Especificaciones = categoría real + rating/sold demo + SKU = id corto; Envío = texto del diseño con FREE=$50; Opiniones = las 2 reviews fijas del diseño), botón agregar → `useTukiCart().add(snap, qty, color, size)`, combos = sección `cross_sell` de `getProductSections` renderizada como fila de `ProductCard`s. Al montar: `track("product_view", { product_id, source: "direct" })` — salvo que venga con `?src=` (home/category/search pasan `?src=` en el push del card; leerlo).

- [ ] **Step 1: Implementar page server** (fetch producto + `getProductSections`; 404 si no existe) y `ProductView` client (port completo del rango).
- [ ] **Step 2: Borrar page viejo** (mismo paso).
- [ ] **Step 3: Verificar** — `pnpm typecheck && pnpm dev` → abrir un producto desde el home: PDP Tuki con datos reales, cross-sell con productos reales (Network: no hay fetch — vino SSR), agregar al carro incrementa el badge y dispara `add_to_cart`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(tuki): PDP con cross-sell real y variantes demo (T8)"`

---

### Task 9: Drawer de carrito + upsell real

**Files:**
- Create: `src/components/tuki/CartDrawer.tsx` (dc.html 738–820)
- Modify: `src/components/tuki/Shell.tsx` (montar drawer; botón carro → `setOpen(true)`)
- Delete: `src/app/(shop)/cart/page.tsx` (Tuki no tiene página de carrito; el drawer la sustituye)

**Interfaces:**
- Consumes: `useTukiCart()`; `POST /api/slate/resolve` body `{surface:"cart", surface_args:{cart_product_ids: items.map(i=>i.product_id)}}` → `{sections}` (upsell real `cart_addons`; nota: su regla exige `cart_item_count>=1`); `fmt`, `stripe`, `catOf`.
- Produces: drawer con líneas (nombre+variante, qty ±, quitar), barra de envío gratis (FREE=$50: progreso `subtotal/5000`), upsell "por poquito más llegas al envío gratis…" = cards de `cart_addons` (refetch al abrir el drawer y al cambiar items, debounce 300ms), CTA "Ir a pagar" → `/checkout`. **Downsell del diseño (mapa DOWN): OMITIDO** — no existe señal backend equivalente; anotado como YAGNI.

- [ ] **Step 1: Implementar CartDrawer + wiring en Shell.** Borrar `(shop)/cart/page.tsx`.
- [ ] **Step 2: Verificar** — dev: agregar 2 productos → abrir drawer: líneas correctas, upsell trae productos reales (Network: POST `/api/slate/resolve`), barra de envío gratis progresa, quitar/± funcionan y disparan eventos.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(tuki): drawer de carrito con upsell real de slate/resolve (T9)"`

---

### Task 10: Checkout anónimo end-to-end

**Files:**
- Create: `supabase/migrations/0032_orders_anonymous_demo.sql` (columna `shipping jsonb` — seguir el patrón de mirror a `test_schema` de la migración 0031)
- Create: `src/sectors/a-tracking/checkout-anonymous.ts`
- Create: `src/app/api/checkout/anonymous/route.ts`
- Create: `src/components/tuki/CheckoutFlow.tsx` (4 pasos, dc.html 543–714) + `src/components/tuki/checkout-core.ts` (validaciones + envío por peso, puro)
- Create: `src/app/(tuki)/checkout/page.tsx`, `src/app/(tuki)/checkout/success/page.tsx` (client; success lee `?order=`)
- Delete: `src/app/(shop)/checkout/page.tsx`, `src/app/(shop)/checkout/success/page.tsx`
- Test: `tests/unit/tuki-checkout-core.test.ts` + `tests/integration/checkout-anonymous.test.ts`

**Interfaces:**
- Consumes: `getOrCreateUserByAuth0Sub(pg, sub, email, name)` de `@/lib/auth` (usuario demo sintético); `insertEvent`/patrón de `createCheckoutOrder` en `src/sectors/a-tracking/checkout.ts` (LEERLO y calcar su transacción); `attributePurchaseAndExclude`; `useTukiCart` (items + clear).
- Produces:

```ts
// checkout-core.ts (puro)
export interface ShipMethod { id: "rapido" | "estandar" | "lento"; icon: string; name: string; sub: string; d1: number; d2: number; price_cents: number; maxLb?: number; minLb?: number; reco?: boolean }
export const SHIP: ShipMethod[]; // ⚡ Rápido 1–2d $12.99 máx 10lb · 🚚 Estándar 3–5d $4.99 reco · 🐢 Lento 8–12d $1.99 mín 5lb (dc.html 952–956)
export function shipOptions(weightLb: number, subtotalCents: number, freeCents?: number): (ShipMethod & { blocked: boolean; reason: string; effectivePriceCents: number })[];
export function validateShipping(f: { nombre: string; ci: string; tel: string; dir: string; ciudad: string }): Record<string, boolean>; // ci: /^\d{6,}$/
export function validateBilling(billSame: boolean, fb: { razon: string; rfc: string; dirf: string }): Record<string, boolean>;

// POST /api/checkout/anonymous — body zod (strict):
// { items: [{product_id: uuid, quantity: int>=1}] min 1,
//   shipping: { nombre: min1, ci: regex ^\d{6,}$, tel: min1, dir: min1, ciudad: min1, cp: optional,
//               metodo: enum[rapido,estandar,lento], pago: enum[tarjeta,efectivo,transfer],
//               factura: { razon, rfc, correo, dirf }.optional() } }
// → 200 { order_id } | 400 no_identity | bad_request | empty_cart | 503 db down
// createAnonymousOrder(pg, {anonymous_id, session_id, items, shipping}):
//   user demo = getOrCreateUserByAuth0Sub(pg, `demo|${anonymous_id}`, `demo+${anonymous_id}@tuki.local`, shipping.nombre)
//   → misma transacción que createCheckoutOrder pero: items del body (precios re-leídos de products,
//     NUNCA del cliente), INSERT orders con shipping jsonb, evento purchase, attributePurchaseAndExclude.
```

- [ ] **Step 1: Migración 0032**

```sql
-- 0032_orders_anonymous_demo.sql
-- Checkout anónimo (demo Tuki): datos de envío del formulario en jsonb.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping jsonb;
ALTER TABLE test_schema.orders ADD COLUMN IF NOT EXISTS shipping jsonb;
```

(verificar contra 0031 cómo se mirrorea test_schema y calcar; luego `pnpm migrate`).

- [ ] **Step 2: Test unit de checkout-core (falla → verde)** — casos: rápido bloqueado con 12lb (`blocked:true`, reason menciona "máx 10 lb"), lento bloqueado con 2lb, estándar gratis con subtotal ≥ $50, `validateShipping` marca ci de 4 dígitos.

```ts
// tests/unit/tuki-checkout-core.test.ts
import { describe, expect, it } from "vitest";
import { shipOptions, validateShipping } from "@/components/tuki/checkout-core";

describe("checkout core", () => {
  it("bloquea métodos por peso con razón", () => {
    const opts = shipOptions(12, 3000);
    expect(opts.find((o) => o.id === "rapido")!.blocked).toBe(true);
    expect(opts.find((o) => o.id === "rapido")!.reason).toContain("10");
    expect(shipOptions(2, 3000).find((o) => o.id === "lento")!.blocked).toBe(true);
  });
  it("estándar gratis desde $50", () => {
    expect(shipOptions(3, 5000).find((o) => o.id === "estandar")!.effectivePriceCents).toBe(0);
    expect(shipOptions(3, 4999).find((o) => o.id === "estandar")!.effectivePriceCents).toBe(499);
  });
  it("valida carnet de 6+ dígitos", () => {
    expect(validateShipping({ nombre: "A", ci: "1234", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(true);
    expect(validateShipping({ nombre: "A", ci: "123456", tel: "5", dir: "d", ciudad: "c" }).ci).toBe(false);
  });
});
```

- [ ] **Step 3: Test integración de la ruta (falla)** — patrón de integración del repo (test_schema): sembrar 1 producto, POST con cookies válidas → 200 `{order_id}`, y verificar en DB: fila `orders` con `shipping` no nulo y user `demo|…`, `order_items` 1 fila, evento `purchase` insertado. Caso 400 sin `items`.
- [ ] **Step 4: Implementar** `checkout-anonymous.ts` + ruta (calcando la transacción de `createCheckoutOrder`) → integración en verde: `pnpm vitest run tests/integration/checkout-anonymous.test.ts`.
- [ ] **Step 5: UI** — `CheckoutFlow` (port 543–714: pasos con validación en `ckTried`, envío por peso usando `useTukiCart().weightLb`, pago, factura toggle, revisar) → al confirmar: POST `/api/checkout/anonymous` → `clear()` carrito → `router.push('/checkout/success?order='+order_id+'&m='+metodo)`; success = port 715–728 con eta calculada client-side. Borrar checkout viejo (mismo paso, conflicto de ruta).
- [ ] **Step 6: Verificar E2E manual** — dev: carrito → checkout completo con CI `12345678` → success con order id real; verificar fila en `orders` (`pnpm health-check` o query directa) y evento purchase.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(tuki): checkout anónimo end-to-end con orden real y evento purchase (T10)"`

---

### Task 11: Perfiles demo = identidades reales sembradas

**Files:**
- Create: `scripts/seed-demo-profiles.ts`
- Create: `src/components/tuki/profiles.ts` (constantes compartidas UI↔script)
- Modify: `src/components/tuki/Shell.tsx` (wiring del menú perfil)

**Interfaces:**
- Produces:

```ts
// profiles.ts — ids FIJOS (uuid v4 válidos, hardcodeados) compartidos por script y UI
export interface DemoProfile { id: string; anonId: string | null; name: string; letter: string; desc: string; greet: string; gsub: string; favs: string[] }
export const DEMO_PROFILES: DemoProfile[] = [
  { id: "explorador", anonId: null, name: "Explorador", letter: "✦", desc: "El feed parte general y aprende de cada toque", greet: "Hola — armamos esto para ti", gsub: "el feed aprende de lo que miras, sin formularios", favs: [] },
  { id: "ana", anonId: "aaaaaaaa-1111-4111-8111-000000000001", name: "Ana · a la moda", letter: "A", desc: "Ropa y belleza, renueva el clóset", greet: "Hola, Ana — tu clóset te llama", gsub: "tu feed prioriza ropa y belleza que ya miraste", favs: ["ropa", "belleza"] },
  { id: "leo", anonId: "aaaaaaaa-1111-4111-8111-000000000002", name: "Leo · casa y cocina", letter: "L", desc: "Su casa es su proyecto", greet: "Hola, Leo — hoy se estrena algo", gsub: "tu feed prioriza hogar y cosas para tu casa", favs: ["hogar"] },
  { id: "dani", anonId: "aaaaaaaa-1111-4111-8111-000000000003", name: "Dani · tecnófila", letter: "D", desc: "Setup, gadgets y accesorios", greet: "Hola, Dani — tu setup te llama", gsub: "tu feed prioriza electrónica y tu setup", favs: ["electronica"] },
];
```

- Script: para cada perfil con `anonId`: upsert `anonymous_sessions`, generar 40–60 eventos en los últimos 14 días (session_id uuid nuevo por "día"): `product_view` sobre productos reales de sus `favs` (elegidos por popularidad: `SELECT id FROM products WHERE metadata->>'category' = ANY(favs) AND is_active ORDER BY random() LIMIT 25`), 3–5 `search` temáticas (`{raw_query, results_count: 10, method: "hybrid_rrf"}`), `category_click`s. Insertar via el helper de eventos existente (usar `insertEvent`/`ensureIdentityRows` de a-tracking — leer `src/sectors/a-tracking` para el insert canónico, NO SQL a mano si existe helper). Al final imprimir: `→ ahora corre: pnpm cron:profile-recompute && pnpm cron:cohort-centroids`.
- Shell wiring: pick(perfil) →

```ts
if (p.anonId) document.cookie = `anonymous_id=${p.anonId}; path=/; max-age=31536000; SameSite=Lax`;
else document.cookie = `anonymous_id=${crypto.randomUUID()}; path=/; max-age=31536000; SameSite=Lax`; // Explorador = usuario frío nuevo
toast(`✦ feed rearmado para ${p.name.split(" ")[0]}`);
router.push("/"); router.refresh();
```

El greeting del home (T5) pasa a leer el perfil activo comparando la cookie `anonymous_id` con `DEMO_PROFILES` (client) o pasándolo del server (la page ya resuelve identity — elegir lo más simple).

- [ ] **Step 1: Implementar `profiles.ts` + script.** Correr: `pnpm tsx scripts/seed-demo-profiles.ts` → luego `pnpm cron:profile-recompute && pnpm cron:cohort-centroids`.
- [ ] **Step 2: Wiring del menú en Shell + greeting por perfil.**
- [ ] **Step 3: Verificar el efecto demo (LA prueba de la tesis)** — dev: home como Explorador (mezclado) → cambiar a Ana → el feed re-SSR y las primeras cards deben inclinarse a ropa/belleza; cambiar a Dani → electrónica. Si el feed no cambia: revisar que los crons corrieron y que `serveFeedPage` está leyendo el perfil de la nueva `anonymous_id` (los profile vectors se materializan por anonymous_id/user — verificar en `user_profiles`).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(tuki): perfiles demo como identidades sembradas — personalización real visible (T11)"`

---

### Task 12: Limpieza final + frontera + suite completa

**Files:**
- Delete: `src/app/(shop)/layout.tsx`, `src/app/(shop)/error.tsx` (últimos restos del grupo; crear `src/app/(tuki)/error.tsx` equivalente ANTES de borrar el viejo — copiar su semántica)
- Delete componentes viejos NO usados por admin: `InfiniteFeed.tsx, CartView.tsx, CheckoutForm.tsx, SearchTracker.tsx, ProductCard.tsx, SearchResults.tsx, CartProvider.tsx, SearchSkeleton.tsx, SearchUnderstood.tsx, ProductTracker.tsx, AddToCartButton.tsx, slate/AfterAddSuggestions.tsx, slate/SeenTracker.tsx, slate/SurfaceSections.tsx, slate/SlateRenderer.tsx`
- Keep: `SearchTraceView.tsx`, `UserDebugView.tsx` (admin), `IdentityMergeOnLogin.tsx` (root layout)
- Modify: test de frontera de imports (localizar en tests/ el que valida que los componentes visuales solo importan contract) → apuntar a `src/components/tuki/**`

- [ ] **Step 1: Crear `(tuki)/error.tsx`, borrar los restos de `(shop)` y los 15 componentes listados.** `grep -rn "components/CartProvider\|components/ProductCard\|SlateRenderer\|InfiniteFeed\|SearchResults" src tests` debe devolver 0 fuera de lo borrado; arreglar cualquier import colgante (tests viejos de componentes borrados: borrarlos también).
- [ ] **Step 2: Actualizar el test de frontera** para que recorra `src/components/tuki` y siga siendo ejecutable (imports permitidos: `@/storefront/contract`, `@/components/tuki/*`, `@/lib/client/*`, `react`, `next/*`).
- [ ] **Step 3: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration`
Expected: todo verde. Si un test de integración viejo referencia páginas borradas, adaptarlo o eliminarlo con justificación en el commit.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore(tuki): retira la UI (shop) vieja; Tuki queda como única capa pública (T12)"`

---

### Task 13: Smoke E2E Playwright

**Files:**
- Create: `tests/e2e/tuki-smoke.spec.ts`
- Delete/adapt: specs e2e viejos que testeen la UI borrada (revisar `tests/e2e/`)

- [ ] **Step 1: Spec smoke**

```ts
// tests/e2e/tuki-smoke.spec.ts
import { expect, test } from "@playwright/test";

test("home Tuki renderiza feed real", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("tuki").first()).toBeVisible();
  await expect(page.locator("[data-testid=tuki-card]").first()).toBeVisible({ timeout: 15000 });
});

test("búsqueda two-phase muestra resultados", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Busca lo que sea…").fill("hogar");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/resultados|buscando/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator("[data-testid=tuki-card]").first()).toBeVisible({ timeout: 30000 });
});

test("agregar al carro y abrir drawer", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-testid=tuki-card-add]").first().click();
  await page.locator("[data-testid=tuki-cart-btn]").click();
  await expect(page.getByText(/envío gratis|Ir a pagar/i).first()).toBeVisible();
});
```

(Requiere `data-testid="tuki-card"`, `tuki-card-add`, `tuki-cart-btn` — añadirlos en ProductCard/Shell si no se pusieron en T5.)

- [ ] **Step 2: Correr** — `pnpm test:e2e` → PASS (con dev server contra la DB poblada, según playwright.config existente).
- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(tuki): smoke e2e de home, búsqueda y carrito (T13)"`

---

## Omitido a propósito (YAGNI, anotar si alguien lo pide)

- Downsell del carrito (mapa `DOWN` del diseño) — sin señal backend.
- Categoría virtual "Ofertas" — no existe en el catálogo; las ofertas visuales salen de `demoAttrs.oldPriceCents`.
- Vista móvil (`Tuki - App móvil.dc.html`) — solo desktop en esta fase.
- `product_dwell` y `dismiss` — el diseño no tiene esos gestos.
- Persistir atributos demo en `products.metadata` — cuando llegue un proveedor real.
- Countdown "El finde de ofertas" con `now` cada 1s — portar visual pero con `setInterval` solo en esa sección (no un tick global como el diseño).
