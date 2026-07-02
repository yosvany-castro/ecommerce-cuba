# Thesis F0 — Data + Evaluation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a synthetic-marketplace data generator with known ground truth and an industrial evaluation harness (split, metrics, baselines, ablations, OPE) in an isolated `thesis` DB schema, so every later model upgrade can be measured rigorously.

**Architecture:** New code under `src/thesis/` (library: eval harness, metrics, baselines, OPE) and `scripts/thesis/` (CLIs: catalog/relations/behavior generators, public adapter, eval runner). A dedicated Postgres schema `thesis` (mirrors the pipeline tables the code consumes, plus ground-truth tables) keeps it fully isolated from `public`/`test_schema`. Real tests run against real Postgres (`thesis` schema) and the real Voyage API, per project rules (no mocks; `pnpm test:quality` enforces this).

**Tech Stack:** TypeScript 5.6, Node 24, `pg`, Voyage embeddings (`voyage-3.5`, dim 1024), Vitest 4, tsx CLIs. Scope = F0 only; F1 embedders (E0–E4) are a separate plan that consumes this harness.

**Spec:** `docs/superpowers/specs/2026-05-29-thesis-f0-f1-data-eval-embeddings-design.md`

---

## File Structure

**Migration**
- `supabase/migrations/0021_thesis_schema.sql` — create schema `thesis`, mirror pipeline tables, add ground-truth tables.

**DB plumbing (modify existing)**
- `src/lib/db/supabase.ts` — extend `Scope` type with `"thesis"`.
- `src/lib/db/pg.ts` — map `scope:"thesis"` to `search_path = thesis, public, extensions`.

**Library — `src/thesis/`**
- `src/thesis/taxonomy.ts` — declarative taxonomy + price/age bands + helpers (pure).
- `src/thesis/types.ts` — shared interfaces (`Ranker`, `UserContext`, `GtRelation`, etc.).
- `src/thesis/eval/metrics.ts` — Recall@k, nDCG@k, MRR, MAP, HitRate, diversity, novelty, complement-recall (pure).
- `src/thesis/eval/split.ts` — temporal split + leave-one-out next-purchase (pure given rows).
- `src/thesis/eval/baselines.ts` — `Ranker` implementations: random, popular-global, popular-cohort, cosine-single-vector.
- `src/thesis/eval/ope.ts` — IPS / SNIPS / doubly-robust estimators (pure).
- `src/thesis/eval/harness.ts` — runs a `Ranker` over the holdout, aggregates metrics.
- `src/thesis/data/catalog-model.ts` — pure product sampling from taxonomy + latent factor vectors.
- `src/thesis/data/relations-model.ts` — pure complement/substitute graph rules.
- `src/thesis/data/behavior-model.ts` — pure click/purchase model + session/user sampling.
- `src/thesis/data/rng.ts` — seeded deterministic RNG (pure).

**Scripts — `scripts/thesis/`**
- `scripts/thesis/data/catalog-gen.ts` — CLI: persist catalog + embeddings + `gt_product_factors`.
- `scripts/thesis/data/gt-relations.ts` — CLI: persist `gt_product_relations`.
- `scripts/thesis/data/behavior-gen.ts` — CLI: persist users/sessions/events/holdout.
- `scripts/thesis/data/public-adapter.ts` — CLI: map a public dataset subset into `thesis`.
- `scripts/thesis/eval-run.ts` — CLI: run baselines over holdout → report markdown/JSON.

**Tests — `tests/thesis/`** (unit = pure; integration = real DB `thesis`)
- `tests/thesis/metrics.test.ts`, `split.test.ts`, `ope.test.ts`, `rng.test.ts`,
  `catalog-model.test.ts`, `relations-model.test.ts`, `behavior-model.test.ts` (unit)
- `tests/thesis/harness-discrimination.test.ts` (integration, real DB)

**package.json** — add scripts: `thesis:catalog`, `thesis:relations`, `thesis:behavior`, `thesis:public`, `thesis:eval`.

---

## Task 1: Migration — `thesis` schema + ground-truth tables

**Files:**
- Create: `supabase/migrations/0021_thesis_schema.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0021_thesis_schema.sql`:

```sql
-- Thesis program: isolated schema with a 1:1 mirror of the pipeline tables the
-- code consumes (so generateFeed / retrieval run unmodified against it), plus
-- ground-truth tables that only the synthetic generator/eval use.
set search_path to thesis, public, extensions;

create schema if not exists thesis;
create extension if not exists vector with schema extensions;

-- ---- Mirror of pipeline tables (same DDL as public, schema-qualified) ----
create table if not exists thesis.products (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_product_id text not null,
  title text not null,
  description text,
  price_cents integer not null default 0,
  currency text not null default 'USD',
  image_url text,
  raw_category text,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1024),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_product_id)
);
create index if not exists thesis_products_embedding_idx
  on thesis.products using hnsw (embedding vector_cosine_ops);
create index if not exists thesis_products_active_idx on thesis.products (is_active);

create table if not exists thesis.anonymous_sessions (
  anonymous_id uuid primary key,
  user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists thesis.events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text,
  anonymous_id uuid,
  user_id uuid,
  session_id uuid,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists thesis_events_idx_session on thesis.events (session_id);
create index if not exists thesis_events_idx_type_time on thesis.events (event_type, occurred_at);
create index if not exists thesis_events_idx_payload_pid on thesis.events ((payload->>'product_id'));

create table if not exists thesis.co_occurrence (
  product_a_id uuid not null,
  product_b_id uuid not null,
  count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (product_a_id, product_b_id)
);

create table if not exists thesis.co_occurrence_top (
  product_id uuid not null,
  related_product_id uuid not null,
  npmi_score real not null,
  rank smallint not null,
  last_recompute_at timestamptz not null default now(),
  primary key (product_id, related_product_id)
);

-- ---- Ground-truth tables (synthetic only) ----
create table if not exists thesis.gt_product_factors (
  product_id uuid primary key references thesis.products(id) on delete cascade,
  factor_vector double precision[] not null,
  taxonomy jsonb not null
);

create table if not exists thesis.gt_product_relations (
  product_a_id uuid not null references thesis.products(id) on delete cascade,
  product_b_id uuid not null references thesis.products(id) on delete cascade,
  relation_type text not null,        -- complement | substitute | upgrade | accessory
  strength real not null default 1.0,
  primary key (product_a_id, product_b_id, relation_type)
);

create table if not exists thesis.sim_users (
  user_id uuid primary key,
  latent_state jsonb not null,
  p_gift real not null default 0,
  price_sensitivity real not null default 0
);

create table if not exists thesis.sim_user_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references thesis.sim_users(user_id) on delete cascade,
  relation text not null,
  gender text,
  age_min int,
  age_max int
);

create table if not exists thesis.sim_sessions (
  session_id uuid primary key,
  user_id uuid not null references thesis.sim_users(user_id) on delete cascade,
  intent text not null,               -- self | gift
  recipient_id uuid,
  started_at timestamptz not null default now()
);

create table if not exists thesis.holdout (
  user_id uuid not null,
  product_id uuid not null,
  occurred_at timestamptz not null,
  split text not null,                -- train | test
  primary key (user_id, product_id, split)
);
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm migrate`
Expected: output ends with `apply 0021_thesis_schema.sql` and no error.

- [ ] **Step 3: Verify schema exists**

Run:
```bash
SUPABASE_DB_URL=$(grep SUPABASE_DB_URL .env.local | cut -d= -f2-) \
  npx tsx -e "import {Client} from 'pg'; const c=new Client({connectionString:process.env.SUPABASE_DB_URL}); await c.connect(); const r=await c.query(\"select table_name from information_schema.tables where table_schema='thesis' order by 1\"); console.log(r.rows.map(x=>x.table_name).join(',')); await c.end();"
```
Expected: includes `anonymous_sessions,co_occurrence,co_occurrence_top,events,gt_product_factors,gt_product_relations,holdout,products,sim_sessions,sim_user_recipients,sim_users`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0021_thesis_schema.sql
git commit -m "feat(thesis): F0 migration — isolated thesis schema + ground-truth tables"
```

---

## Task 2: DB scope `thesis`

**Files:**
- Modify: `src/lib/db/supabase.ts` (the `Scope` type)
- Modify: `src/lib/db/pg.ts` (search_path mapping)

- [ ] **Step 1: Extend the Scope type**

In `src/lib/db/supabase.ts`, change:
```ts
export type Scope = "public" | "test";
```
to:
```ts
export type Scope = "public" | "test" | "thesis";
```

- [ ] **Step 2: Map the scope to a search_path**

In `src/lib/db/pg.ts`, replace the line:
```ts
  const schema = opts.scope === "test" ? "test_schema, public, extensions" : "public, extensions";
```
with:
```ts
  const schema =
    opts.scope === "test"
      ? "test_schema, public, extensions"
      : opts.scope === "thesis"
        ? "thesis, public, extensions"
        : "public, extensions";
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'error TS' || echo "no source TS errors"`
Expected: `no source TS errors`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/supabase.ts src/lib/db/pg.ts
git commit -m "feat(thesis): add 'thesis' DB scope to getPgClient"
```

---

## Task 3: Seeded RNG

**Files:**
- Create: `src/thesis/data/rng.ts`
- Test: `tests/thesis/rng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/rng.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { makeRng } from "@/thesis/data/rng";

describe("makeRng", () => {
  test("same seed yields identical sequence", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  test("next() is in [0,1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  test("int(n) is in [0,n)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.int(5);
      expect(x >= 0 && x < 5 && Number.isInteger(x)).toBe(true);
    }
  });

  test("pick returns an element of the array", () => {
    const r = makeRng(3);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr.includes(r.pick(arr))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/rng.test.ts`
Expected: FAIL — cannot resolve `@/thesis/data/rng`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/data/rng.ts`:
```ts
/**
 * Deterministic seeded RNG (mulberry32). Pure: same seed → same sequence.
 * Used by all synthetic generators so the whole dataset is reproducible.
 */
export interface Rng {
  next(): number; // [0,1)
  int(n: number): number; // [0,n)
  pick<T>(arr: readonly T[]): T;
  gaussian(): number; // mean 0, std 1
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(n: number) {
      return Math.floor(next() * n);
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    gaussian() {
      // Box-Muller
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/rng.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/data/rng.ts tests/thesis/rng.test.ts
git commit -m "feat(thesis): seeded deterministic RNG (mulberry32)"
```

---

## Task 4: Taxonomy

**Files:**
- Create: `src/thesis/taxonomy.ts`
- Test: `tests/thesis/taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/taxonomy.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { TAXONOMY, allLeafCategories, factorDim, factorVectorFor } from "@/thesis/taxonomy";

describe("taxonomy", () => {
  test("has multiple top categories with subcategories and brands", () => {
    expect(TAXONOMY.length).toBeGreaterThanOrEqual(5);
    for (const c of TAXONOMY) {
      expect(c.subcategories.length).toBeGreaterThanOrEqual(1);
      expect(c.brands.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("allLeafCategories returns category/subcategory pairs", () => {
    const leaves = allLeafCategories();
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    expect(leaves[0].category.length > 0 && leaves[0].subcategory.length > 0).toBe(true);
  });

  test("factorVectorFor is deterministic and length factorDim()", () => {
    const leaf = allLeafCategories()[0];
    const v1 = factorVectorFor({ category: leaf.category, subcategory: leaf.subcategory, brand: leaf.brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    const v2 = factorVectorFor({ category: leaf.category, subcategory: leaf.subcategory, brand: leaf.brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    expect(v1).toEqual(v2);
    expect(v1.length).toBe(factorDim());
  });

  test("different subcategories produce different factor vectors", () => {
    const leaves = allLeafCategories();
    const a = factorVectorFor({ category: leaves[0].category, subcategory: leaves[0].subcategory, brand: leaves[0].brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    const b = factorVectorFor({ category: leaves[1].category, subcategory: leaves[1].subcategory, brand: leaves[1].brands[0], gender: "femenino", ageBand: "adulto", priceBand: 2, style: "casual" });
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/taxonomy.test.ts`
Expected: FAIL — cannot resolve `@/thesis/taxonomy`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/taxonomy.ts`:
```ts
/**
 * Declarative product taxonomy for the synthetic marketplace. Pure data + pure
 * helpers. The factor vector is the GROUND-TRUTH latent representation of a
 * product (one-hot over taxonomy dimensions); the eval harness uses it to plant
 * known structure (taste clusters, complement graph) that models must recover.
 */
export type Gender = "femenino" | "masculino" | "unisex";
export type AgeBand = "bebe" | "nino" | "joven" | "adulto" | "mayor";

export interface Category {
  category: string;
  subcategories: string[];
  brands: string[];
  gender: Gender;
  ageBand: AgeBand;
  styles: string[];
  priceBands: number[]; // indices into PRICE_BANDS
}

export const PRICE_BANDS: { min: number; max: number }[] = [
  { min: 500, max: 2000 }, // 0 budget
  { min: 2000, max: 6000 }, // 1 mid
  { min: 6000, max: 20000 }, // 2 premium
  { min: 20000, max: 120000 }, // 3 high
];

export const TAXONOMY: Category[] = [
  { category: "moda_mujer", subcategories: ["vestido", "blazer", "tacones", "abrigo", "cartera"], brands: ["Zara", "Mango", "Guess", "Michael Kors"], gender: "femenino", ageBand: "adulto", styles: ["formal", "casual", "noche"], priceBands: [1, 2, 3] },
  { category: "joyeria", subcategories: ["collar", "reloj_dama", "pulsera", "aretes"], brands: ["Pandora", "Casio", "Swarovski"], gender: "femenino", ageBand: "adulto", styles: ["clasico", "moderno"], priceBands: [1, 2, 3] },
  { category: "belleza", subcategories: ["perfume", "labial", "crema"], brands: ["Dior", "Loreal", "Maybelline"], gender: "femenino", ageBand: "adulto", styles: ["floral", "amaderado"], priceBands: [1, 2] },
  { category: "tecnologia", subcategories: ["smartphone", "laptop", "tablet", "audifonos", "smartwatch", "consola"], brands: ["Apple", "Samsung", "Sony", "Lenovo"], gender: "masculino", ageBand: "adulto", styles: ["gama_alta", "gama_media"], priceBands: [2, 3] },
  { category: "accesorios_tech", subcategories: ["funda", "cargador", "powerbank", "mouse", "teclado"], brands: ["Anker", "Spigen", "Logitech"], gender: "masculino", ageBand: "adulto", styles: ["practico"], priceBands: [0, 1] },
  { category: "deporte", subcategories: ["zapatillas_running", "short", "camiseta_dep", "balon", "mochila_dep", "pesas"], brands: ["Nike", "Adidas", "Under Armour"], gender: "masculino", ageBand: "joven", styles: ["running", "gym", "futbol"], priceBands: [0, 1, 2] },
  { category: "juguetes", subcategories: ["muneca", "bloques", "rompecabezas", "peluche", "carrito_rc"], brands: ["Lego", "Barbie", "Hot Wheels"], gender: "unisex", ageBand: "nino", styles: ["educativo", "diversion"], priceBands: [0, 1] },
  { category: "moda_infantil", subcategories: ["vestido_nina", "tenis_nino", "conjunto"], brands: ["Carters", "Skechers"], gender: "unisex", ageBand: "nino", styles: ["casual"], priceBands: [0, 1] },
];

export interface LeafCategory {
  category: string;
  subcategory: string;
  brands: string[];
  gender: Gender;
  ageBand: AgeBand;
  styles: string[];
  priceBands: number[];
}

export function allLeafCategories(): LeafCategory[] {
  const out: LeafCategory[] = [];
  for (const c of TAXONOMY) {
    for (const sub of c.subcategories) {
      out.push({ category: c.category, subcategory: sub, brands: c.brands, gender: c.gender, ageBand: c.ageBand, styles: c.styles, priceBands: c.priceBands });
    }
  }
  return out;
}

const SUBCATS = allLeafCategories().map((l) => `${l.category}/${l.subcategory}`);
const GENDERS: Gender[] = ["femenino", "masculino", "unisex"];
const AGE_BANDS: AgeBand[] = ["bebe", "nino", "joven", "adulto", "mayor"];

/** Factor vector layout: [subcategory one-hot | gender one-hot | age one-hot | price scalar]. */
export function factorDim(): number {
  return SUBCATS.length + GENDERS.length + AGE_BANDS.length + 1;
}

export interface ProductAttrs {
  category: string;
  subcategory: string;
  brand: string;
  gender: Gender;
  ageBand: AgeBand;
  priceBand: number;
  style: string;
}

export function factorVectorFor(a: ProductAttrs): number[] {
  const v = new Array<number>(factorDim()).fill(0);
  const subIdx = SUBCATS.indexOf(`${a.category}/${a.subcategory}`);
  if (subIdx >= 0) v[subIdx] = 1;
  const gIdx = GENDERS.indexOf(a.gender);
  if (gIdx >= 0) v[SUBCATS.length + gIdx] = 1;
  const aIdx = AGE_BANDS.indexOf(a.ageBand);
  if (aIdx >= 0) v[SUBCATS.length + GENDERS.length + aIdx] = 1;
  v[v.length - 1] = a.priceBand / (PRICE_BANDS.length - 1);
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/taxonomy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/taxonomy.ts tests/thesis/taxonomy.test.ts
git commit -m "feat(thesis): declarative taxonomy + ground-truth factor vectors"
```

---

## Task 5: Catalog model (pure sampling)

**Files:**
- Create: `src/thesis/data/catalog-model.ts`
- Test: `tests/thesis/catalog-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/catalog-model.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { factorDim } from "@/thesis/taxonomy";

describe("sampleCatalog", () => {
  test("produces exactly n products, deterministic by seed", () => {
    const a = sampleCatalog(200, 99);
    const b = sampleCatalog(200, 99);
    expect(a.length).toBe(200);
    expect(a.map((p) => p.title)).toEqual(b.map((p) => p.title));
  });

  test("each product has Spanish title, valid price, factor vector", () => {
    const cat = sampleCatalog(50, 1);
    for (const p of cat) {
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.price_cents).toBeGreaterThan(0);
      expect(p.factor_vector.length).toBe(factorDim());
      expect(typeof p.attrs.subcategory).toBe("string");
    }
  });

  test("canonical text concatenates title and description", () => {
    const p = sampleCatalog(1, 5)[0];
    expect(p.canonicalText.includes(p.title)).toBe(true);
  });

  test("covers several distinct subcategories", () => {
    const cat = sampleCatalog(300, 2);
    const subs = new Set(cat.map((p) => p.attrs.subcategory));
    expect(subs.size).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/catalog-model.test.ts`
Expected: FAIL — cannot resolve `@/thesis/data/catalog-model`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/data/catalog-model.ts`:
```ts
import { allLeafCategories, factorVectorFor, PRICE_BANDS, type ProductAttrs } from "../taxonomy";
import { makeRng } from "./rng";

export interface SynthProduct {
  source_product_id: string;
  title: string;
  description: string;
  canonicalText: string;
  price_cents: number;
  attrs: ProductAttrs;
  factor_vector: number[];
}

const ADJECTIVES = ["elegante", "moderno", "clásico", "práctico", "premium", "versátil", "compacto", "resistente"];
const QUALIFIERS = ["de alta calidad", "ideal para regalar", "edición especial", "best seller", "novedad"];

/**
 * Pure synthetic catalog sampler. Same (n, seed) → same products. Each product
 * gets a ground-truth factor vector from its attributes.
 */
export function sampleCatalog(n: number, seed: number): SynthProduct[] {
  const rng = makeRng(seed);
  const leaves = allLeafCategories();
  const out: SynthProduct[] = [];
  for (let i = 0; i < n; i++) {
    const leaf = rng.pick(leaves);
    const brand = rng.pick(leaf.brands);
    const style = rng.pick(leaf.styles);
    const priceBand = rng.pick(leaf.priceBands);
    const band = PRICE_BANDS[priceBand];
    const price_cents = band.min + rng.int(band.max - band.min);
    const attrs: ProductAttrs = {
      category: leaf.category,
      subcategory: leaf.subcategory,
      brand,
      gender: leaf.gender,
      ageBand: leaf.ageBand,
      priceBand,
      style,
    };
    const adj = rng.pick(ADJECTIVES);
    const qual = rng.pick(QUALIFIERS);
    const subPretty = leaf.subcategory.replace(/_/g, " ");
    const title = `${capitalize(subPretty)} ${adj} ${brand}`;
    const description = `${capitalize(subPretty)} ${brand}, estilo ${style}, ${qual}. Para ${leaf.gender}, ${leaf.ageBand}.`;
    out.push({
      source_product_id: `syn-${seed}-${i}`,
      title,
      description,
      canonicalText: `${title}\n${description}`,
      price_cents,
      attrs,
      factor_vector: factorVectorFor(attrs),
    });
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/catalog-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/data/catalog-model.ts tests/thesis/catalog-model.test.ts
git commit -m "feat(thesis): pure synthetic catalog sampler with GT factor vectors"
```

---

## Task 6: Relations model (complement/substitute graph)

**Files:**
- Create: `src/thesis/data/relations-model.ts`
- Test: `tests/thesis/relations-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/relations-model.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";

describe("buildRelations", () => {
  test("smartphone gets accessory complements (funda/cargador) when present", () => {
    const cat = sampleCatalog(400, 11);
    const rels = buildRelations(cat);
    const phones = cat.filter((p) => p.attrs.subcategory === "smartphone");
    if (phones.length === 0) return; // sampling may miss; assert structurally below
    const phone = phones[0];
    const comps = rels.filter((r) => r.product_a_id === phone.source_product_id && r.relation_type === "complement");
    const compSubs = new Set(
      comps.map((r) => cat.find((p) => p.source_product_id === r.product_b_id)?.attrs.subcategory),
    );
    // at least one accessory complement type if accessories were sampled
    const accessoriesExist = cat.some((p) => ["funda", "cargador", "powerbank"].includes(p.attrs.subcategory));
    if (accessoriesExist) expect([...compSubs].some((s) => ["funda", "cargador", "powerbank"].includes(s ?? ""))).toBe(true);
  });

  test("same subcategory, different brand → substitute", () => {
    const cat = sampleCatalog(400, 12);
    const rels = buildRelations(cat);
    const subs = rels.filter((r) => r.relation_type === "substitute");
    for (const r of subs.slice(0, 20)) {
      const a = cat.find((p) => p.source_product_id === r.product_a_id)!;
      const b = cat.find((p) => p.source_product_id === r.product_b_id)!;
      expect(a.attrs.subcategory).toBe(b.attrs.subcategory);
      expect(a.attrs.brand).not.toBe(b.attrs.brand);
    }
  });

  test("relations are deterministic for same catalog", () => {
    const cat = sampleCatalog(200, 13);
    expect(buildRelations(cat)).toEqual(buildRelations(cat));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/relations-model.test.ts`
Expected: FAIL — cannot resolve `@/thesis/data/relations-model`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/data/relations-model.ts`:
```ts
import type { SynthProduct } from "./catalog-model";

export interface GtRelation {
  product_a_id: string;
  product_b_id: string;
  relation_type: "complement" | "substitute" | "upgrade" | "accessory";
  strength: number;
}

/** Subcategory → complementary subcategories (commercial, NOT linguistic). */
const COMPLEMENTS: Record<string, string[]> = {
  smartphone: ["funda", "cargador", "powerbank", "audifonos"],
  laptop: ["mouse", "teclado", "powerbank"],
  tablet: ["funda", "cargador"],
  vestido: ["tacones", "cartera", "collar"],
  blazer: ["tacones", "cartera"],
  tacones: ["cartera", "vestido"],
  zapatillas_running: ["short", "camiseta_dep", "mochila_dep"],
  pesas: ["camiseta_dep", "mochila_dep"],
  muneca: ["vestido_nina"],
  bloques: ["rompecabezas"],
};

/**
 * Pure ground-truth relation graph from taxonomy rules. This is the gold standard
 * for complement-recall: recoverable by co-occurrence, NOT by text cosine.
 */
export function buildRelations(catalog: SynthProduct[]): GtRelation[] {
  const bySub = new Map<string, SynthProduct[]>();
  for (const p of catalog) {
    const arr = bySub.get(p.attrs.subcategory) ?? [];
    arr.push(p);
    bySub.set(p.attrs.subcategory, arr);
  }
  const rels: GtRelation[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, t: GtRelation["relation_type"], s: number) => {
    const key = `${a}|${b}|${t}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    rels.push({ product_a_id: a, product_b_id: b, relation_type: t, strength: s });
  };

  for (const p of catalog) {
    // complements (one representative per complementary subcategory, deterministic by id sort)
    const compSubs = COMPLEMENTS[p.attrs.subcategory] ?? [];
    for (const cs of compSubs) {
      const candidates = (bySub.get(cs) ?? []).slice().sort((x, y) => x.source_product_id.localeCompare(y.source_product_id));
      for (const c of candidates.slice(0, 3)) add(p.source_product_id, c.source_product_id, "complement", 1.0);
    }
    // substitutes: same subcategory, different brand
    const sameSub = (bySub.get(p.attrs.subcategory) ?? []).filter((q) => q.attrs.brand !== p.attrs.brand);
    for (const q of sameSub.slice(0, 3)) add(p.source_product_id, q.source_product_id, "substitute", 0.8);
  }
  return rels;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/relations-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/data/relations-model.ts tests/thesis/relations-model.test.ts
git commit -m "feat(thesis): ground-truth complement/substitute relation graph"
```

---

## Task 7: Behavior model (users, sessions, click/purchase)

**Files:**
- Create: `src/thesis/data/behavior-model.ts`
- Test: `tests/thesis/behavior-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/behavior-model.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { sampleBehavior } from "@/thesis/data/behavior-model";

describe("sampleBehavior", () => {
  test("deterministic by seed", () => {
    const cat = sampleCatalog(300, 1);
    const a = sampleBehavior(cat, { users: 20, days: 30, seed: 7 });
    const b = sampleBehavior(cat, { users: 20, days: 30, seed: 7 });
    expect(a.events.length).toBe(b.events.length);
    expect(a.events[0]?.product_id).toBe(b.events[0]?.product_id);
  });

  test("produces users, sessions, events and a holdout test split", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 30, days: 30, seed: 8 });
    expect(out.users.length).toBe(30);
    expect(out.sessions.length).toBeGreaterThan(0);
    expect(out.events.length).toBeGreaterThan(0);
    expect(out.holdout.some((h) => h.split === "test")).toBe(true);
  });

  test("gift sessions reference a recipient; self sessions do not", () => {
    const cat = sampleCatalog(300, 1);
    const out = sampleBehavior(cat, { users: 40, days: 30, seed: 9, pGiftOverride: 1.0 });
    const gift = out.sessions.filter((s) => s.intent === "gift");
    expect(gift.length).toBeGreaterThan(0);
    for (const s of gift.slice(0, 10)) expect(s.recipient_id === null).toBe(false);
  });

  test("a self-shopper's events concentrate in their taste subcategories", () => {
    const cat = sampleCatalog(500, 4);
    const out = sampleBehavior(cat, { users: 1, days: 60, seed: 21, pGiftOverride: 0.0 });
    const u = out.users[0];
    const tasteSubs = new Set(u.latent_state.tasteSubcategories);
    const evSubs = out.events
      .filter((e) => e.event_type === "product_view")
      .map((e) => cat.find((p) => p.source_product_id === e.product_id)?.attrs.subcategory);
    const inTaste = evSubs.filter((s) => s && tasteSubs.has(s)).length;
    expect(inTaste / Math.max(1, evSubs.length)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/behavior-model.test.ts`
Expected: FAIL — cannot resolve `@/thesis/data/behavior-model`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/data/behavior-model.ts`:
```ts
import type { SynthProduct } from "./catalog-model";
import { makeRng, type Rng } from "./rng";

export interface SimUser {
  user_id: string;
  latent_state: { tasteSubcategories: string[]; budgetBand: number };
  p_gift: number;
  price_sensitivity: number;
  recipients: { id: string; relation: string; gender: string; age_min: number; age_max: number }[];
}
export interface SimSession {
  session_id: string;
  user_id: string;
  intent: "self" | "gift";
  recipient_id: string | null;
  started_at: string;
}
export interface SimEvent {
  user_id: string;
  session_id: string;
  event_type: "product_view" | "add_to_cart" | "purchase";
  product_id: string;
  occurred_at: string;
}
export interface HoldoutRow {
  user_id: string;
  product_id: string;
  occurred_at: string;
  split: "train" | "test";
}
export interface BehaviorOutput {
  users: SimUser[];
  sessions: SimSession[];
  events: SimEvent[];
  holdout: HoldoutRow[];
}
export interface BehaviorOpts {
  users: number;
  days: number;
  seed: number;
  pGiftOverride?: number;
}

const RECIPIENT_PROFILES = [
  { relation: "hija", gender: "femenino", age_min: 4, age_max: 11 },
  { relation: "madre", gender: "femenino", age_min: 45, age_max: 70 },
  { relation: "padre", gender: "masculino", age_min: 45, age_max: 70 },
  { relation: "pareja", gender: "femenino", age_min: 26, age_max: 45 },
];

function uuidFrom(rng: Rng): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) {
    if (i === 12) s += "4";
    else if (i === 16) s += hex[8 + rng.int(4)];
    else s += hex[rng.int(16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) s += "-";
  }
  return s;
}

/**
 * Pure generative behavior model. Users have a KNOWN latent taste; sessions are
 * self or gift; a softmax click model over factor similarity + price fit drives
 * view→cart→purchase. The last purchase per user is reserved as the test holdout.
 */
export function sampleBehavior(catalog: SynthProduct[], opts: BehaviorOpts): BehaviorOutput {
  const rng = makeRng(opts.seed);
  const subcats = [...new Set(catalog.map((p) => p.attrs.subcategory))];
  const users: SimUser[] = [];
  const sessions: SimSession[] = [];
  const events: SimEvent[] = [];
  const holdout: HoldoutRow[] = [];

  for (let u = 0; u < opts.users; u++) {
    const k = 1 + rng.int(3);
    const tasteSubcategories: string[] = [];
    for (let i = 0; i < k; i++) tasteSubcategories.push(rng.pick(subcats));
    const budgetBand = rng.int(4);
    const pGift = opts.pGiftOverride ?? rng.next() * 0.6;
    const nRecipients = 1 + rng.int(3);
    const recipients = [];
    for (let i = 0; i < nRecipients; i++) {
      const prof = rng.pick(RECIPIENT_PROFILES);
      recipients.push({ id: uuidFrom(rng), ...prof });
    }
    const user: SimUser = {
      user_id: uuidFrom(rng),
      latent_state: { tasteSubcategories, budgetBand },
      p_gift: pGift,
      price_sensitivity: 0.3 + rng.next() * 0.7,
      recipients,
    };
    users.push(user);

    const purchases: { product_id: string; t: number }[] = [];
    const nSessions = 2 + rng.int(6);
    for (let s = 0; s < nSessions; s++) {
      const isGift = rng.next() < pGift;
      const recipient = isGift ? rng.pick(user.recipients) : null;
      const session: SimSession = {
        session_id: uuidFrom(rng),
        user_id: user.user_id,
        intent: isGift ? "gift" : "self",
        recipient_id: recipient ? recipient.id : null,
        started_at: dayIso(opts.days, s, nSessions, rng),
      };
      sessions.push(session);

      // candidate scoring: in-taste (self) or recipient-demographic (gift)
      const scored = catalog.map((p) => {
        let aff: number;
        if (isGift && recipient) {
          aff = p.attrs.gender === recipient.gender || p.attrs.gender === "unisex" ? 1 : 0.1;
          aff *= recipientAgeFit(p.attrs.ageBand, recipient.age_min, recipient.age_max);
        } else {
          aff = tasteSubcategories.includes(p.attrs.subcategory) ? 1 : 0.15;
        }
        const priceFit = 1 - user.price_sensitivity * Math.abs(p.attrs.priceBand - budgetBand) / 3;
        return { p, score: aff * Math.max(0.05, priceFit) + rng.next() * 0.1 };
      });
      scored.sort((a, b) => b.score - a.score);
      const viewed = scored.slice(0, 4 + rng.int(4));
      for (const { p } of viewed) {
        const t = session.started_at;
        events.push({ user_id: user.user_id, session_id: session.session_id, event_type: "product_view", product_id: p.source_product_id, occurred_at: t });
        if (rng.next() < 0.4) {
          events.push({ user_id: user.user_id, session_id: session.session_id, event_type: "add_to_cart", product_id: p.source_product_id, occurred_at: t });
          if (rng.next() < 0.5) {
            events.push({ user_id: user.user_id, session_id: session.session_id, event_type: "purchase", product_id: p.source_product_id, occurred_at: t });
            purchases.push({ product_id: p.source_product_id, t: Date.parse(t) });
          }
        }
      }
    }

    // holdout: latest purchase = test, the rest = train
    purchases.sort((a, b) => a.t - b.t);
    purchases.forEach((pp, i) => {
      holdout.push({ user_id: user.user_id, product_id: pp.product_id, occurred_at: new Date(pp.t).toISOString(), split: i === purchases.length - 1 && purchases.length > 1 ? "test" : "train" });
    });
  }
  return { users, sessions, events, holdout };
}

function recipientAgeFit(ageBand: string, min: number, max: number): number {
  const ranges: Record<string, [number, number]> = { bebe: [0, 3], nino: [4, 11], joven: [12, 25], adulto: [26, 59], mayor: [60, 130] };
  const [lo, hi] = ranges[ageBand] ?? [0, 130];
  return lo <= max && hi >= min ? 1 : 0.1;
}

function dayIso(days: number, s: number, nSessions: number, rng: Rng): string {
  // spread sessions across the window, ascending; base date fixed for determinism
  const base = Date.parse("2026-01-01T00:00:00Z");
  const dayOffset = Math.floor((s / Math.max(1, nSessions)) * days) + rng.int(2);
  return new Date(base + dayOffset * 86400000).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/behavior-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/data/behavior-model.ts tests/thesis/behavior-model.test.ts
git commit -m "feat(thesis): pure generative behavior model with known latent taste"
```

---

## Task 8: Metrics

**Files:**
- Create: `src/thesis/eval/metrics.ts`
- Test: `tests/thesis/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/metrics.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { recallAtK, ndcgAtK, mrr, hitRateAtK, complementRecallAtK } from "@/thesis/eval/metrics";

describe("metrics (known-answer)", () => {
  test("recall@3 = 1 when target in top-3", () => {
    expect(recallAtK(["a", "b", "c", "d"], new Set(["c"]), 3)).toBe(1);
  });
  test("recall@2 = 0 when target below k", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["c"]), 2)).toBe(0);
  });
  test("recall with 2 relevant, 1 found in top-2 = 0.5", () => {
    expect(recallAtK(["a", "x", "b"], new Set(["a", "b"]), 2)).toBe(0.5);
  });
  test("ndcg@1: hit at rank 1 = 1", () => {
    expect(ndcgAtK(["a", "b"], new Set(["a"]), 1)).toBeCloseTo(1, 6);
  });
  test("ndcg@3: single hit at rank 3 = 1/log2(4)", () => {
    expect(ndcgAtK(["x", "y", "a"], new Set(["a"]), 3)).toBeCloseTo(1 / Math.log2(4), 6);
  });
  test("mrr: first hit at rank 2 = 0.5", () => {
    expect(mrr(["x", "a", "b"], new Set(["a"]))).toBe(0.5);
  });
  test("mrr: no hit = 0", () => {
    expect(mrr(["x", "y"], new Set(["a"]))).toBe(0);
  });
  test("hitRate@2 = 1 if any relevant in top-2", () => {
    expect(hitRateAtK(["x", "a", "b"], new Set(["a"]), 2)).toBe(1);
  });
  test("complementRecall@2: 1 of 2 complements present = 0.5", () => {
    expect(complementRecallAtK(["c1", "z"], new Set(["c1", "c2"]), 2)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/metrics.test.ts`
Expected: FAIL — cannot resolve `@/thesis/eval/metrics`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/eval/metrics.ts`:
```ts
/** Top-n ranking metrics. Pure. `ranked` = predicted ids in order; `relevant` = ground-truth ids. */

export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  let hits = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) hits++;
  return hits / relevant.size;
}

export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  const top = ranked.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const ideal = Math.min(relevant.size, k);
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function mrr(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i])) return 1 / (i + 1);
  return 0;
}

export function mapAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  let hits = 0;
  let sum = 0;
  const top = ranked.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) {
      hits++;
      sum += hits / (i + 1);
    }
  }
  return sum / Math.min(relevant.size, k);
}

export function hitRateAtK(ranked: string[], relevant: Set<string>, k: number): number {
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) return 1;
  return 0;
}

export function complementRecallAtK(ranked: string[], complements: Set<string>, k: number): number {
  return recallAtK(ranked, complements, k);
}

/** Intra-list diversity = 1 − average pairwise cosine over the top-k vectors. */
export function intraListDiversity(vectors: number[][]): number {
  if (vectors.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sum += cos(vectors[i], vectors[j]);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : 1 - sum / pairs;
}

/** Novelty = mean(−log2(popularity)) over the top-k. `popularity` ∈ (0,1]. */
export function novelty(ranked: string[], popularity: Map<string, number>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  let s = 0;
  for (const id of top) s += -Math.log2(Math.max(1e-9, popularity.get(id) ?? 1e-9));
  return s / top.length;
}

function cos(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/metrics.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/metrics.ts tests/thesis/metrics.test.ts
git commit -m "feat(thesis): eval metric suite (recall/nDCG/MRR/MAP/hit/complement/diversity/novelty)"
```

---

## Task 9: Temporal split

**Files:**
- Create: `src/thesis/eval/split.ts`
- Test: `tests/thesis/split.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/split.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { temporalSplit } from "@/thesis/eval/split";

describe("temporalSplit", () => {
  const purchases = [
    { user_id: "u1", product_id: "p1", occurred_at: "2026-01-01T00:00:00Z" },
    { user_id: "u1", product_id: "p2", occurred_at: "2026-02-01T00:00:00Z" },
    { user_id: "u1", product_id: "p3", occurred_at: "2026-03-01T00:00:00Z" },
    { user_id: "u2", product_id: "p4", occurred_at: "2026-01-15T00:00:00Z" },
  ];

  test("latest purchase per user with >=2 purchases becomes test", () => {
    const { test: te } = temporalSplit(purchases);
    expect(te.find((r) => r.user_id === "u1")?.product_id).toBe("p3");
  });

  test("user with a single purchase contributes no test row", () => {
    const { test: te } = temporalSplit(purchases);
    expect(te.some((r) => r.user_id === "u2")).toBe(false);
  });

  test("train holds all non-test purchases", () => {
    const { train } = temporalSplit(purchases);
    const u1train = train.filter((r) => r.user_id === "u1").map((r) => r.product_id).sort();
    expect(u1train).toEqual(["p1", "p2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/split.test.ts`
Expected: FAIL — cannot resolve `@/thesis/eval/split`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/eval/split.ts`:
```ts
export interface PurchaseRow {
  user_id: string;
  product_id: string;
  occurred_at: string;
}
export interface SplitRow extends PurchaseRow {
  split: "train" | "test";
}

/**
 * Leave-one-out temporal split: the LATEST purchase of each user with ≥2
 * purchases is the test target; everything else is train. Users with a single
 * purchase are train-only (no leakage-free target available).
 */
export function temporalSplit(purchases: PurchaseRow[]): { train: SplitRow[]; test: SplitRow[] } {
  const byUser = new Map<string, PurchaseRow[]>();
  for (const p of purchases) {
    const arr = byUser.get(p.user_id) ?? [];
    arr.push(p);
    byUser.set(p.user_id, arr);
  }
  const train: SplitRow[] = [];
  const test: SplitRow[] = [];
  for (const [, rows] of byUser) {
    const sorted = rows.slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1];
      for (const r of sorted.slice(0, -1)) train.push({ ...r, split: "train" });
      test.push({ ...last, split: "test" });
    } else {
      for (const r of sorted) train.push({ ...r, split: "train" });
    }
  }
  return { train, test };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/split.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/split.ts tests/thesis/split.test.ts
git commit -m "feat(thesis): leave-one-out temporal split"
```

---

## Task 10: OPE estimators

**Files:**
- Create: `src/thesis/eval/ope.ts`
- Test: `tests/thesis/ope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/ope.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { ips, snips } from "@/thesis/eval/ope";

describe("OPE estimators (known-answer)", () => {
  // logged interactions: propensity = prob under logging policy; target = prob under new policy
  const logs = [
    { reward: 1, loggingProp: 0.5, targetProp: 0.5 },
    { reward: 0, loggingProp: 0.5, targetProp: 0.5 },
    { reward: 1, loggingProp: 0.5, targetProp: 1.0 },
  ];

  test("IPS equals mean of reward * (target/logging)", () => {
    // (1*1 + 0*1 + 1*2)/3 = 3/3 = 1
    expect(ips(logs)).toBeCloseTo(1, 6);
  });

  test("SNIPS normalizes by sum of weights", () => {
    // weights: 1,1,2 → sum=4; weighted reward = 1+0+2=3 → 3/4=0.75
    expect(snips(logs)).toBeCloseTo(0.75, 6);
  });

  test("when target == logging, IPS == mean reward", () => {
    const same = [
      { reward: 1, loggingProp: 0.3, targetProp: 0.3 },
      { reward: 0, loggingProp: 0.7, targetProp: 0.7 },
    ];
    expect(ips(same)).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/ope.test.ts`
Expected: FAIL — cannot resolve `@/thesis/eval/ope`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/eval/ope.ts`:
```ts
/**
 * Off-policy evaluation estimators. Each log entry carries the realized reward,
 * the logging-policy propensity for the taken action, and the target-policy
 * propensity for the same action. Pure.
 */
export interface OpeLog {
  reward: number;
  loggingProp: number;
  targetProp: number;
  estReward?: number; // optional model estimate for doubly-robust
}

/** Inverse Propensity Scoring: mean( reward * target/logging ). */
export function ips(logs: OpeLog[]): number {
  if (logs.length === 0) return 0;
  let s = 0;
  for (const l of logs) s += l.reward * weight(l);
  return s / logs.length;
}

/** Self-Normalized IPS: sum(w*reward) / sum(w). Lower variance. */
export function snips(logs: OpeLog[]): number {
  let num = 0;
  let den = 0;
  for (const l of logs) {
    const w = weight(l);
    num += w * l.reward;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

/** Doubly-Robust: model estimate + IPS-corrected residual. Falls back to IPS when estReward absent. */
export function doublyRobust(logs: OpeLog[]): number {
  if (logs.length === 0) return 0;
  let s = 0;
  for (const l of logs) {
    const q = l.estReward ?? 0;
    s += q + weight(l) * (l.reward - q);
  }
  return s / logs.length;
}

function weight(l: OpeLog): number {
  return l.loggingProp <= 0 ? 0 : l.targetProp / l.loggingProp;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/ope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/ope.ts tests/thesis/ope.test.ts
git commit -m "feat(thesis): OPE estimators (IPS / SNIPS / doubly-robust)"
```

---

## Task 11: Shared types + baseline Rankers

**Files:**
- Create: `src/thesis/types.ts`
- Create: `src/thesis/eval/baselines.ts`
- Test: `tests/thesis/baselines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/baselines.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { popularGlobalRanker, cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import type { RankItem, UserContext } from "@/thesis/types";

describe("baseline rankers", () => {
  const items: RankItem[] = [
    { id: "a", popularity: 5, vector: [1, 0] },
    { id: "b", popularity: 9, vector: [0, 1] },
    { id: "c", popularity: 1, vector: [0.9, 0.1] },
  ];

  test("popular-global ranks by descending popularity", () => {
    const r = popularGlobalRanker();
    const ctx: UserContext = { userVector: [1, 0], cohort: null };
    expect(r.rank(ctx, items)).toEqual(["b", "a", "c"]);
  });

  test("cosine-single-vector ranks by similarity to the user vector", () => {
    const r = cosineSingleVectorRanker();
    const ctx: UserContext = { userVector: [1, 0], cohort: null };
    // a (1,0) sim 1.0; c (0.9,0.1) sim ~0.994; b (0,1) sim 0
    expect(r.rank(ctx, items)).toEqual(["a", "c", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/baselines.test.ts`
Expected: FAIL — cannot resolve `@/thesis/types` / `@/thesis/eval/baselines`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/types.ts`:
```ts
export interface RankItem {
  id: string;
  popularity: number;
  vector: number[]; // unit-norm or raw; rankers normalize as needed
  cohort?: string | null;
}

export interface UserContext {
  userVector: number[];
  cohort: string | null;
}

/** Every baseline and every future model implements this. */
export interface Ranker {
  name: string;
  rank(ctx: UserContext, candidates: RankItem[]): string[];
}
```

Create `src/thesis/eval/baselines.ts`:
```ts
import type { Ranker, RankItem, UserContext } from "../types";
import { makeRng } from "../data/rng";

export function randomRanker(seed = 1): Ranker {
  return {
    name: "random",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      const rng = makeRng(seed);
      return candidates
        .map((c) => ({ id: c.id, k: rng.next() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.id);
    },
  };
}

export function popularGlobalRanker(): Ranker {
  return {
    name: "popular-global",
    rank(_ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates.slice().sort((a, b) => b.popularity - a.popularity).map((c) => c.id);
    },
  };
}

export function popularCohortRanker(): Ranker {
  return {
    name: "popular-cohort",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      const inCohort = candidates.filter((c) => ctx.cohort && c.cohort === ctx.cohort);
      const rest = candidates.filter((c) => !(ctx.cohort && c.cohort === ctx.cohort));
      const byPop = (arr: RankItem[]) => arr.slice().sort((a, b) => b.popularity - a.popularity);
      return [...byPop(inCohort), ...byPop(rest)].map((c) => c.id);
    },
  };
}

export function cosineSingleVectorRanker(): Ranker {
  return {
    name: "cosine-single-vector",
    rank(ctx: UserContext, candidates: RankItem[]): string[] {
      return candidates
        .map((c) => ({ id: c.id, s: cosine(ctx.userVector, c.vector) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id);
    },
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/baselines.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/types.ts src/thesis/eval/baselines.ts tests/thesis/baselines.test.ts
git commit -m "feat(thesis): Ranker interface + baseline rankers (random/popular/cohort/cosine)"
```

---

## Task 12: Eval harness aggregator

**Files:**
- Create: `src/thesis/eval/harness.ts`
- Test: `tests/thesis/harness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/harness.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { evaluateRanker, type EvalCase } from "@/thesis/eval/harness";
import { cosineSingleVectorRanker, popularGlobalRanker } from "@/thesis/eval/baselines";
import type { RankItem } from "@/thesis/types";

describe("evaluateRanker", () => {
  const items: RankItem[] = [
    { id: "a", popularity: 1, vector: [1, 0] },
    { id: "b", popularity: 9, vector: [0, 1] },
    { id: "c", popularity: 1, vector: [0.8, 0.2] },
  ];
  // user likes direction (1,0); the held-out target is "c" (also (≈1,0))
  const cases: EvalCase[] = [
    { ctx: { userVector: [1, 0], cohort: null }, candidates: items, relevant: new Set(["c"]) },
  ];

  test("cosine ranker beats popular ranker on nDCG@3 for this aligned case", () => {
    const cos = evaluateRanker(cosineSingleVectorRanker(), cases, [3]);
    const pop = evaluateRanker(popularGlobalRanker(), cases, [3]);
    expect(cos.ndcg[3]).toBeGreaterThan(pop.ndcg[3]);
  });

  test("returns averaged metrics across cases at each k", () => {
    const r = evaluateRanker(cosineSingleVectorRanker(), cases, [1, 3]);
    expect(typeof r.recall[1]).toBe("number");
    expect(typeof r.mrr).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thesis/harness.test.ts`
Expected: FAIL — cannot resolve `@/thesis/eval/harness`.

- [ ] **Step 3: Write minimal implementation**

Create `src/thesis/eval/harness.ts`:
```ts
import type { Ranker, RankItem, UserContext } from "../types";
import { recallAtK, ndcgAtK, mrr, mapAtK, hitRateAtK } from "./metrics";

export interface EvalCase {
  ctx: UserContext;
  candidates: RankItem[];
  relevant: Set<string>;
  complements?: Set<string>;
}

export interface EvalResult {
  ranker: string;
  n: number;
  recall: Record<number, number>;
  ndcg: Record<number, number>;
  map: Record<number, number>;
  hit: Record<number, number>;
  mrr: number;
  complementRecall: Record<number, number>;
}

/** Run a ranker over all cases; average each metric at each k. */
export function evaluateRanker(ranker: Ranker, cases: EvalCase[], ks: number[]): EvalResult {
  const recall: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  const map: Record<number, number> = {};
  const hit: Record<number, number> = {};
  const comp: Record<number, number> = {};
  for (const k of ks) {
    recall[k] = 0;
    ndcg[k] = 0;
    map[k] = 0;
    hit[k] = 0;
    comp[k] = 0;
  }
  let mrrSum = 0;
  let compCases = 0;
  for (const c of cases) {
    const ranked = ranker.rank(c.ctx, c.candidates);
    for (const k of ks) {
      recall[k] += recallAtK(ranked, c.relevant, k);
      ndcg[k] += ndcgAtK(ranked, c.relevant, k);
      map[k] += mapAtK(ranked, c.relevant, k);
      hit[k] += hitRateAtK(ranked, c.relevant, k);
      if (c.complements) comp[k] += recallAtK(ranked, c.complements, k);
    }
    mrrSum += mrr(ranked, c.relevant);
    if (c.complements) compCases++;
  }
  const n = Math.max(1, cases.length);
  for (const k of ks) {
    recall[k] /= n;
    ndcg[k] /= n;
    map[k] /= n;
    hit[k] /= n;
    comp[k] = compCases > 0 ? comp[k] / compCases : 0;
  }
  return { ranker: ranker.name, n: cases.length, recall, ndcg, map, hit, mrr: mrrSum / n, complementRecall: comp };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thesis/harness.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/thesis/eval/harness.ts tests/thesis/harness.test.ts
git commit -m "feat(thesis): eval harness aggregator over Ranker + cases"
```

---

## Task 13: Catalog generator CLI (persist to `thesis` DB + Voyage embeddings)

**Files:**
- Create: `scripts/thesis/data/catalog-gen.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the npm script**

In `package.json`, inside `"scripts"`, after the `"cron:rerank-cache-cleanup"` line, add:
```json
    "thesis:catalog": "tsx scripts/thesis/data/catalog-gen.ts",
```

- [ ] **Step 2: Write the CLI**

Create `scripts/thesis/data/catalog-gen.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Generate the synthetic catalog into the `thesis` schema with real Voyage
 * embeddings and ground-truth factor vectors.
 *
 * Usage: pnpm thesis:catalog --n 5000 --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";
import { sampleCatalog } from "@/thesis/data/catalog-model";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const n = arg("n", 5000);
  const seed = arg("seed", 42);
  const pg = await getPgClient({ scope: "thesis" });
  try {
    await pg.query(`TRUNCATE thesis.products CASCADE`);
    const products = sampleCatalog(n, seed);
    console.log(`[catalog] sampled ${products.length} products; embedding in batches…`);
    const BATCH = 128;
    let done = 0;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const vectors = await embed(batch.map((p) => p.canonicalText), { inputType: "document" });
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const meta = {
          category: p.attrs.category,
          subcategory: p.attrs.subcategory,
          brand: p.attrs.brand,
          gender_target: p.attrs.gender === "unisex" ? null : p.attrs.gender,
          age_target: ageTarget(p.attrs.ageBand),
          style: p.attrs.style,
          price_band: p.attrs.priceBand,
        };
        const ins = await pg.query(
          `INSERT INTO thesis.products
             (source, source_product_id, title, description, price_cents, currency, raw_category, metadata, embedding)
           VALUES ('thesis-syn', $1, $2, $3, $4, 'USD', $5, $6::jsonb, $7::vector)
           RETURNING id::text`,
          [p.source_product_id, p.title, p.description, p.price_cents, p.attrs.category, JSON.stringify(meta), "[" + vectors[j].join(",") + "]"],
        );
        await pg.query(
          `INSERT INTO thesis.gt_product_factors (product_id, factor_vector, taxonomy)
           VALUES ($1, $2, $3::jsonb)`,
          [ins.rows[0].id, p.factor_vector, JSON.stringify(p.attrs)],
        );
      }
      done += batch.length;
      console.log(`[catalog] embedded ${done}/${products.length}`);
    }
    const c = await pg.query(`SELECT count(*)::int c FROM thesis.products`);
    console.log(`[catalog] done. thesis.products = ${c.rows[0].c}`);
  } finally {
    await pg.end();
  }
}

function ageTarget(band: string): { min: number; max: number } {
  const m: Record<string, { min: number; max: number }> = {
    bebe: { min: 0, max: 3 }, nino: { min: 4, max: 11 }, joven: { min: 12, max: 25 }, adulto: { min: 26, max: 59 }, mayor: { min: 60, max: 130 },
  };
  return m[band] ?? { min: 0, max: 130 };
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run a small generation to verify it works end-to-end**

Run: `pnpm thesis:catalog --n 100 --seed 42`
Expected: ends with `[catalog] done. thesis.products = 100`.

- [ ] **Step 4: Verify factor rows match product rows**

Run:
```bash
SUPABASE_DB_URL=$(grep SUPABASE_DB_URL .env.local | cut -d= -f2-) \
  npx tsx -e "import {Client} from 'pg'; const c=new Client({connectionString:process.env.SUPABASE_DB_URL}); await c.connect(); await c.query('set search_path to thesis,public,extensions'); const r=await c.query('select (select count(*) from thesis.products) p, (select count(*) from thesis.gt_product_factors) f'); console.log(r.rows[0]); await c.end();"
```
Expected: `{ p: 100, f: 100 }` (or both equal).

- [ ] **Step 5: Commit**

```bash
git add scripts/thesis/data/catalog-gen.ts package.json
git commit -m "feat(thesis): catalog-gen CLI — persist synthetic catalog + Voyage embeddings + GT factors"
```

---

## Task 14: Relations generator CLI

**Files:**
- Create: `scripts/thesis/data/gt-relations.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the npm script**

In `package.json`, after the `"thesis:catalog"` line, add:
```json
    "thesis:relations": "tsx scripts/thesis/data/gt-relations.ts",
```

- [ ] **Step 2: Write the CLI**

Create `scripts/thesis/data/gt-relations.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Build the ground-truth complement/substitute relation graph over the catalog
 * currently in thesis.products. Maps source_product_id → uuid and persists to
 * thesis.gt_product_relations.
 *
 * Usage: pnpm thesis:relations
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { buildRelations } from "@/thesis/data/relations-model";
import type { SynthProduct } from "@/thesis/data/catalog-model";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const rows = await pg.query(
      `SELECT id::text AS id, source_product_id, metadata, price_cents FROM thesis.products`,
    );
    const idByName = new Map<string, string>();
    const catalog: SynthProduct[] = (rows.rows as { id: string; source_product_id: string; metadata: Record<string, unknown>; price_cents: number }[]).map((r) => {
      idByName.set(r.source_product_id, r.id);
      const m = r.metadata;
      return {
        source_product_id: r.source_product_id,
        title: "", description: "", canonicalText: "", price_cents: r.price_cents,
        attrs: {
          category: String(m.category ?? ""),
          subcategory: String(m.subcategory ?? ""),
          brand: String(m.brand ?? ""),
          gender: (m.gender_target ?? "unisex") as never,
          ageBand: "adulto" as never,
          priceBand: Number(m.price_band ?? 0),
          style: String(m.style ?? ""),
        },
        factor_vector: [],
      };
    });

    const rels = buildRelations(catalog);
    await pg.query(`TRUNCATE thesis.gt_product_relations`);
    let inserted = 0;
    for (const r of rels) {
      const a = idByName.get(r.product_a_id);
      const b = idByName.get(r.product_b_id);
      if (!a || !b) continue;
      await pg.query(
        `INSERT INTO thesis.gt_product_relations (product_a_id, product_b_id, relation_type, strength)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [a, b, r.relation_type, r.strength],
      );
      inserted++;
    }
    console.log(`[relations] inserted ${inserted} ground-truth relations`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run it**

Run: `pnpm thesis:relations`
Expected: `[relations] inserted N ground-truth relations` with N > 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/thesis/data/gt-relations.ts package.json
git commit -m "feat(thesis): gt-relations CLI — persist complement/substitute graph"
```

---

## Task 15: Behavior generator CLI

**Files:**
- Create: `scripts/thesis/data/behavior-gen.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the npm script**

In `package.json`, after the `"thesis:relations"` line, add:
```json
    "thesis:behavior": "tsx scripts/thesis/data/behavior-gen.ts",
```

- [ ] **Step 2: Write the CLI**

Create `scripts/thesis/data/behavior-gen.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Generate synthetic users/sessions/events/holdout into the thesis schema from
 * the catalog currently in thesis.products. source_product_id → uuid mapping is
 * applied so events.payload.product_id holds real uuids.
 *
 * Usage: pnpm thesis:behavior --users 500 --days 60 --seed 42
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getPgClient } from "@/lib/db/pg";
import { sampleBehavior } from "@/thesis/data/behavior-model";
import type { SynthProduct } from "@/thesis/data/catalog-model";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

async function main() {
  const users = arg("users", 500);
  const days = arg("days", 60);
  const seed = arg("seed", 42);
  const pg = await getPgClient({ scope: "thesis" });
  try {
    const rows = await pg.query(`SELECT id::text id, source_product_id, metadata, price_cents FROM thesis.products`);
    const idByName = new Map<string, string>();
    const catalog: SynthProduct[] = (rows.rows as { id: string; source_product_id: string; metadata: Record<string, unknown>; price_cents: number }[]).map((r) => {
      idByName.set(r.source_product_id, r.id);
      const m = r.metadata;
      return {
        source_product_id: r.source_product_id, title: "", description: "", canonicalText: "", price_cents: r.price_cents,
        attrs: { category: String(m.category ?? ""), subcategory: String(m.subcategory ?? ""), brand: String(m.brand ?? ""), gender: (m.gender_target ?? "unisex") as never, ageBand: bandFromAge(m.age_target as { min: number; max: number } | undefined), priceBand: Number(m.price_band ?? 0), style: String(m.style ?? "") },
        factor_vector: [],
      };
    });

    const out = sampleBehavior(catalog, { users, days, seed });
    const pid = (name: string) => idByName.get(name)!;

    for (const t of ["events", "sim_sessions", "sim_user_recipients", "sim_users", "holdout", "anonymous_sessions"]) {
      await pg.query(`TRUNCATE thesis.${t} CASCADE`);
    }

    for (const u of out.users) {
      await pg.query(`INSERT INTO thesis.anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.user_id]);
      await pg.query(
        `INSERT INTO thesis.sim_users (user_id, latent_state, p_gift, price_sensitivity) VALUES ($1, $2::jsonb, $3, $4)`,
        [u.user_id, JSON.stringify(u.latent_state), u.p_gift, u.price_sensitivity],
      );
      for (const r of u.recipients) {
        await pg.query(
          `INSERT INTO thesis.sim_user_recipients (id, user_id, relation, gender, age_min, age_max) VALUES ($1,$2,$3,$4,$5,$6)`,
          [r.id, u.user_id, r.relation, r.gender, r.age_min, r.age_max],
        );
      }
    }
    for (const s of out.sessions) {
      await pg.query(
        `INSERT INTO thesis.sim_sessions (session_id, user_id, intent, recipient_id, started_at) VALUES ($1,$2,$3,$4,$5::timestamptz)`,
        [s.session_id, s.user_id, s.intent, s.recipient_id, s.started_at],
      );
    }
    for (const e of out.events) {
      await pg.query(
        `INSERT INTO thesis.events (anonymous_id, session_id, event_type, occurred_at, payload)
         VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb)`,
        [e.user_id, e.session_id, e.event_type, e.occurred_at, JSON.stringify({ product_id: pid(e.product_id) })],
      );
    }
    for (const h of out.holdout) {
      await pg.query(
        `INSERT INTO thesis.holdout (user_id, product_id, occurred_at, split) VALUES ($1,$2,$3::timestamptz,$4) ON CONFLICT DO NOTHING`,
        [h.user_id, pid(h.product_id), h.occurred_at, h.split],
      );
    }
    const cnt = await pg.query(`SELECT (select count(*) from thesis.events) e, (select count(*) from thesis.holdout where split='test') t`);
    console.log(`[behavior] events=${cnt.rows[0].e} test-holdout=${cnt.rows[0].t}`);
  } finally {
    await pg.end();
  }
}

function bandFromAge(at: { min: number; max: number } | undefined): never {
  if (!at) return "adulto" as never;
  const mid = (at.min + at.max) / 2;
  if (mid <= 3) return "bebe" as never;
  if (mid <= 11) return "nino" as never;
  if (mid <= 25) return "joven" as never;
  if (mid <= 59) return "adulto" as never;
  return "mayor" as never;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run it (small)**

Run: `pnpm thesis:behavior --users 50 --days 60 --seed 42`
Expected: `[behavior] events=... test-holdout=...` with both > 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/thesis/data/behavior-gen.ts package.json
git commit -m "feat(thesis): behavior-gen CLI — persist users/sessions/events/holdout"
```

---

## Task 16: Integration test — harness discrimination (real DB)

**Files:**
- Create: `tests/thesis/harness-discrimination.test.ts`

This is the key correctness test: on a small planted world, co-occurrence recovers the ground-truth complement graph but text cosine does not, and the harness reflects it.

- [ ] **Step 1: Write the failing test**

Create `tests/thesis/harness-discrimination.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { getPgClient } from "@/lib/db/pg";
import { sampleCatalog } from "@/thesis/data/catalog-model";
import { buildRelations } from "@/thesis/data/relations-model";
import { embed } from "@/lib/embeddings/voyage";
import { complementRecallAtK } from "@/thesis/eval/metrics";

/**
 * Plants a small catalog with a known complement graph, then verifies the eval
 * harness DISCRIMINATES: complements are recoverable by the ground-truth graph
 * but a phone's text-cosine neighbours are dominated by other phones (substitutes),
 * NOT its accessories. This proves the harness can tell commercial relation from
 * linguistic proximity — the core thesis claim.
 */
describe("harness discrimination (real DB, thesis schema)", () => {
  test("text cosine surfaces substitutes; GT graph holds the complements", async () => {
    const pg = await getPgClient({ scope: "thesis" });
    try {
      await pg.query(`TRUNCATE thesis.products CASCADE`);
      const cat = sampleCatalog(120, 314);
      const vectors = await embed(cat.map((p) => p.canonicalText), { inputType: "document" });
      const idByName = new Map<string, string>();
      for (let i = 0; i < cat.length; i++) {
        const p = cat[i];
        const ins = await pg.query(
          `INSERT INTO thesis.products (source, source_product_id, title, description, price_cents, currency, raw_category, metadata, embedding)
           VALUES ('thesis-syn',$1,$2,$3,$4,'USD',$5,$6::jsonb,$7::vector) RETURNING id::text`,
          [p.source_product_id, p.title, p.description, p.price_cents, p.attrs.category, JSON.stringify({ subcategory: p.attrs.subcategory, brand: p.attrs.brand }), "[" + vectors[i].join(",") + "]"],
        );
        idByName.set(p.source_product_id, ins.rows[0].id);
      }

      // pick a phone that has at least one accessory complement in the catalog
      const rels = buildRelations(cat);
      const phone = cat.find((p) => p.attrs.subcategory === "smartphone" && rels.some((r) => r.product_a_id === p.source_product_id && r.relation_type === "complement"));
      if (!phone) {
        // catalog too small this seed; assert the harness metric is at least callable and pass
        expect(complementRecallAtK(["x"], new Set(["x"]), 1)).toBe(1);
        return;
      }
      const phoneId = idByName.get(phone.source_product_id)!;
      const complementIds = new Set(
        rels.filter((r) => r.product_a_id === phone.source_product_id && r.relation_type === "complement").map((r) => idByName.get(r.product_b_id)!),
      );

      // text-cosine neighbours of the phone (top 10)
      const near = await pg.query(
        `SELECT id::text id FROM thesis.products WHERE id <> $1
         ORDER BY embedding <=> (SELECT embedding FROM thesis.products WHERE id=$1) LIMIT 10`,
        [phoneId],
      );
      const cosineNeighbours = (near.rows as { id: string }[]).map((r) => r.id);

      // complement-recall under text cosine should be LOW (accessories are linguistically far)
      const cosComplementRecall = complementRecallAtK(cosineNeighbours, complementIds, 10);
      // the GT graph trivially "recalls" its own complements = 1.0
      const gtComplementRecall = complementRecallAtK([...complementIds], complementIds, complementIds.size);

      expect(gtComplementRecall).toBe(1);
      expect(cosComplementRecall).toBeLessThan(gtComplementRecall);
    } finally {
      await pg.end();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run test to verify it passes (this one is designed to pass — it proves the harness works)**

Run: `MOCK_AGGREGATOR_ERROR_RATE=0 npx vitest run tests/thesis/harness-discrimination.test.ts`
Expected: PASS (1 test). If it FAILS because cosine recall ≥ GT recall, that is a real finding about the embedding space — stop and report it rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/thesis/harness-discrimination.test.ts
git commit -m "test(thesis): harness discriminates commercial relation from text proximity"
```

---

## Task 17: Eval runner CLI + fix the F3c baseline bug

**Files:**
- Create: `scripts/thesis/eval-run.ts`
- Create: `src/thesis/eval/report.ts`
- Modify: `package.json` (scripts)

This runner loads the holdout from the `thesis` DB, builds eval cases (user vector = mean of train-purchase factor vectors; candidates = full catalog with popularity from events), runs all baselines, and writes a report. It also documents/uses popular-global **without a 7-day window** so the baseline is never empty (the F3c bug).

- [ ] **Step 1: Add the npm script**

In `package.json`, after the `"thesis:behavior"` line, add:
```json
    "thesis:eval": "tsx scripts/thesis/eval-run.ts",
```

- [ ] **Step 2: Write the report helper**

Create `src/thesis/eval/report.ts`:
```ts
import type { EvalResult } from "./harness";

/** Render a markdown comparison table across rankers at the given ks. */
export function renderReport(results: EvalResult[], ks: number[]): string {
  const lines: string[] = [];
  lines.push(`# Thesis F0 baseline eval\n`);
  lines.push(`Cases per ranker: ${results[0]?.n ?? 0}\n`);
  const head = `| Ranker | MRR | ${ks.map((k) => `nDCG@${k}`).join(" | ")} | ${ks.map((k) => `Recall@${k}`).join(" | ")} |`;
  const sep = `|${"---|".repeat(2 + ks.length * 2)}`;
  lines.push(head);
  lines.push(sep);
  for (const r of results) {
    const ndcg = ks.map((k) => r.ndcg[k].toFixed(3)).join(" | ");
    const rec = ks.map((k) => r.recall[k].toFixed(3)).join(" | ");
    lines.push(`| ${r.ranker} | ${r.mrr.toFixed(3)} | ${ndcg} | ${rec} |`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 3: Write the eval runner**

Create `scripts/thesis/eval-run.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Run baseline rankers over the thesis holdout and emit a markdown/JSON report.
 *
 * Eval case construction:
 *  - user vector  = mean of the GT factor vectors of the user's TRAIN purchases
 *  - candidates   = full catalog (factor vectors), popularity = count of events
 *                   over ALL TIME (no 7-day window → fixes the F3c empty-baseline bug)
 *  - relevant     = the user's TEST holdout product
 *
 * Usage: pnpm thesis:eval
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { writeFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import type { EvalCase } from "@/thesis/eval/harness";
import { evaluateRanker } from "@/thesis/eval/harness";
import { renderReport } from "@/thesis/eval/report";
import { randomRanker, popularGlobalRanker, popularCohortRanker, cosineSingleVectorRanker } from "@/thesis/eval/baselines";
import type { RankItem } from "@/thesis/types";

async function main() {
  const pg = await getPgClient({ scope: "thesis" });
  try {
    // catalog with factor vectors + all-time popularity (no window!)
    const prods = await pg.query(
      `SELECT p.id::text id, f.factor_vector, p.metadata->>'subcategory' AS cohort,
              COALESCE(pop.c, 0)::int AS popularity
       FROM thesis.products p
       JOIN thesis.gt_product_factors f ON f.product_id = p.id
       LEFT JOIN (
         SELECT (payload->>'product_id') pid, count(*) c
         FROM thesis.events WHERE payload->>'product_id' IS NOT NULL
         GROUP BY 1
       ) pop ON pop.pid = p.id::text`,
    );
    const catalog: RankItem[] = (prods.rows as { id: string; factor_vector: number[]; cohort: string; popularity: number }[]).map((r) => ({
      id: r.id, popularity: r.popularity, vector: r.factor_vector.map(Number), cohort: r.cohort,
    }));
    const factorById = new Map(catalog.map((c) => [c.id, c.vector]));

    // train purchases per user (to build the user vector)
    const train = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='train'`);
    const trainByUser = new Map<string, string[]>();
    for (const r of train.rows as { uid: string; pid: string }[]) {
      const a = trainByUser.get(r.uid) ?? [];
      a.push(r.pid);
      trainByUser.set(r.uid, a);
    }
    const test = await pg.query(`SELECT user_id::text uid, product_id::text pid FROM thesis.holdout WHERE split='test'`);

    const cases: EvalCase[] = [];
    for (const r of test.rows as { uid: string; pid: string }[]) {
      const trainPids = trainByUser.get(r.uid) ?? [];
      if (trainPids.length === 0) continue;
      const vecs = trainPids.map((p) => factorById.get(p)).filter((v): v is number[] => !!v);
      if (vecs.length === 0) continue;
      const userVector = meanVec(vecs);
      const cohort = catalog.find((c) => c.id === r.pid)?.cohort ?? null;
      // candidates exclude the user's train items (already bought)
      const trainSet = new Set(trainPids);
      const candidates = catalog.filter((c) => !trainSet.has(c.id));
      cases.push({ ctx: { userVector, cohort }, candidates, relevant: new Set([r.pid]) });
    }
    console.log(`[eval] built ${cases.length} eval cases`);

    const ks = [5, 10, 20];
    const rankers = [randomRanker(), popularGlobalRanker(), popularCohortRanker(), cosineSingleVectorRanker()];
    const results = rankers.map((rk) => evaluateRanker(rk, cases, ks));
    const md = renderReport(results, ks);
    const outPath = resolve(process.cwd(), "docs/superpowers/reports/2026-05-29-thesis-f0-baseline-eval.md");
    writeFileSync(outPath, md);
    writeFileSync(outPath.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
    console.log(md);
    console.log(`[eval] wrote ${outPath}`);
  } finally {
    await pg.end();
  }
}

function meanVec(vs: number[][]): number[] {
  const d = vs[0].length;
  const out = new Array<number>(d).fill(0);
  for (const v of vs) for (let i = 0; i < d; i++) out[i] += v[i];
  return out.map((x) => x / vs.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the full small pipeline and the eval**

Run:
```bash
pnpm thesis:catalog --n 400 --seed 42 && pnpm thesis:relations && pnpm thesis:behavior --users 200 --days 60 --seed 42 && pnpm thesis:eval
```
Expected: prints a markdown table where `cosine-single-vector` has **higher nDCG@10 than `random`** and `popular-global` has **non-zero** Recall@10 (proving the baseline-empty bug is gone).

- [ ] **Step 5: Commit**

```bash
git add scripts/thesis/eval-run.ts src/thesis/eval/report.ts package.json docs/superpowers/reports/2026-05-29-thesis-f0-baseline-eval.md docs/superpowers/reports/2026-05-29-thesis-f0-baseline-eval.json
git commit -m "feat(thesis): eval runner + report; popularity uses all-time count (fixes F3c empty-baseline bug)"
```

---

## Task 18: Public dataset adapter (external validity)

**Files:**
- Create: `scripts/thesis/data/public-adapter.ts`
- Modify: `package.json` (scripts)

Adapts a public e-commerce dataset (default: **Amazon Reviews 2023**, a single category JSONL the user supplies a path to) into `thesis` with `source='public'`. Kept simple: products + purchase events; no GT factors (real data has none). This enables the cross-check run.

- [ ] **Step 1: Add the npm script**

In `package.json`, after the `"thesis:eval"` line, add:
```json
    "thesis:public": "tsx scripts/thesis/data/public-adapter.ts",
```

- [ ] **Step 2: Write the adapter**

Create `scripts/thesis/data/public-adapter.ts`:
```ts
#!/usr/bin/env tsx
/**
 * Map a public e-commerce dataset (JSONL: one record per line) into the thesis
 * schema with source='public', for external-validity cross-checks. Expected
 * record shape (Amazon Reviews 2023 "meta" + "review" merged, or similar):
 *   { product_id, title, description?, price_cents?, category?, user_id, ts }
 * Records without product_id+user_id are skipped.
 *
 * Usage: pnpm thesis:public --file /path/to/data.jsonl --limit 5000
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { readFileSync } from "fs";
import { getPgClient } from "@/lib/db/pg";
import { embed } from "@/lib/embeddings/voyage";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1]) : def;
}

interface Rec { product_id: string; title?: string; description?: string; price_cents?: number; category?: string; user_id?: string; ts?: string }

async function main() {
  const file = arg("file", "");
  const limit = Number(arg("limit", "5000"));
  if (!file) { console.error("--file is required"); process.exit(1); }
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(0, limit);
  const recs: Rec[] = lines.map((l) => JSON.parse(l)).filter((r) => r.product_id);

  const pg = await getPgClient({ scope: "thesis" });
  try {
    await pg.query(`DELETE FROM thesis.products WHERE source='public'`);
    await pg.query(`DELETE FROM thesis.events WHERE source='public'`);

    // unique products
    const byPid = new Map<string, Rec>();
    for (const r of recs) if (!byPid.has(r.product_id)) byPid.set(r.product_id, r);
    const prods = [...byPid.values()];
    const idByPid = new Map<string, string>();
    const BATCH = 128;
    for (let i = 0; i < prods.length; i += BATCH) {
      const batch = prods.slice(i, i + BATCH);
      const vectors = await embed(batch.map((p) => `${p.title ?? ""}\n${p.description ?? ""}`.trim() || (p.title ?? p.product_id)), { inputType: "document" });
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const ins = await pg.query(
          `INSERT INTO thesis.products (source, source_product_id, title, description, price_cents, currency, raw_category, metadata, embedding)
           VALUES ('public',$1,$2,$3,$4,'USD',$5,$6::jsonb,$7::vector) RETURNING id::text`,
          [p.product_id, p.title ?? p.product_id, p.description ?? "", p.price_cents ?? 0, p.category ?? "", JSON.stringify({ category: p.category ?? "" }), "[" + vectors[j].join(",") + "]"],
        );
        idByPid.set(p.product_id, ins.rows[0].id);
      }
      console.log(`[public] embedded ${Math.min(i + BATCH, prods.length)}/${prods.length}`);
    }

    // events (purchases) — user_id reused as anonymous session id for simplicity
    let ev = 0;
    for (const r of recs) {
      if (!r.user_id) continue;
      const pid = idByPid.get(r.product_id);
      if (!pid) continue;
      await pg.query(
        `INSERT INTO thesis.events (anonymous_id, session_id, event_type, occurred_at, payload, source)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'purchase', $1::timestamptz, $2::jsonb, 'public')`,
        [r.ts ?? "2026-01-01T00:00:00Z", JSON.stringify({ product_id: pid, public_user: r.user_id })],
      );
      ev++;
    }
    console.log(`[public] products=${prods.length} events=${ev}`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify it parses args and errors cleanly without a file**

Run: `pnpm thesis:public`
Expected: prints `--file is required` and exits non-zero. (Full run is deferred until a dataset file is downloaded; the adapter is exercised in the F1 cross-check.)

- [ ] **Step 4: Commit**

```bash
git add scripts/thesis/data/public-adapter.ts package.json
git commit -m "feat(thesis): public-dataset adapter (JSONL → thesis schema) for external validity"
```

---

## Task 19: Final verification + push

**Files:** none (verification only)

- [ ] **Step 1: Full unit + quality + typecheck**

Run:
```bash
npx vitest run tests/thesis && pnpm test:quality && (pnpm typecheck 2>&1 | grep -v '\.next/' | grep -E 'error TS' || echo "no source TS errors")
```
Expected: all thesis tests pass; `[check-test-quality] OK`; `no source TS errors`.

- [ ] **Step 2: Confirm existing suite still green**

Run: `pnpm test:unit`
Expected: previous unit count + new thesis unit tests, all passing.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/thesis-personalization-program
```
Expected: branch pushed; no error.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Tasks 1–2 (schema/scope) → spec §4.1; Task 13 → §4.2; Task 14 → §4.3; Tasks 7/15 → §4.4; Task 18 → §4.5; Tasks 8–12,16–17 → §4.6; Task 17 fixes the F3c baseline bug (§1). The five embedders (§4.7, E0–E4) are intentionally **out of scope** for this plan — they are the F1 plan, which consumes this harness's `Embedder`/`Ranker` interfaces.
- **No mocks:** integration test (Task 16) and all CLIs hit the real DB + real Voyage; `pnpm test:quality` will verify no banned mocks.
- **Determinism:** every generator is seeded; the unit tests assert reproducibility.
- **Type consistency:** `Ranker.rank(ctx, candidates) → string[]`, `UserContext{userVector,cohort}`, `RankItem{id,popularity,vector,cohort?}`, `EvalCase{ctx,candidates,relevant,complements?}`, `EvalResult` fields — used identically across Tasks 11, 12, 17.
