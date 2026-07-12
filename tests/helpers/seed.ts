import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { embed } from "@/lib/embeddings/voyage";

export async function createUser(
  pg: Client,
  overrides: Partial<{ auth_sub: string; email: string; name: string }> = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `u-${randomUUID()}@test.local`;
  const auth_sub = overrides.auth_sub ?? `auth0|${randomUUID()}`;
  const r = await pg.query(
    `INSERT INTO users (auth_sub, email, name) VALUES ($1, $2, $3) RETURNING id, email`,
    [auth_sub, email, overrides.name ?? null],
  );
  return r.rows[0];
}

export async function createAnonymousSession(
  pg: Client,
  anonymousId?: string,
): Promise<string> {
  const id = anonymousId ?? randomUUID();
  await pg.query(
    `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT (anonymous_id) DO NOTHING`,
    [id],
  );
  return id;
}

export async function seedProduct(
  pg: Client,
  overrides: Partial<{
    title: string;
    description: string;
    price_cents: number;
    raw_category: string;
    metadata: Record<string, unknown>;
  }> = {},
): Promise<{ id: string }> {
  const sid = randomUUID();
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata)
     VALUES ('seed', $1, $2, $3, $4, 'USD', null, $5, $6::jsonb)
     RETURNING id`,
    [
      sid,
      overrides.title ?? `Seeded product ${sid.slice(0, 8)}`,
      overrides.description ?? "test description",
      overrides.price_cents ?? 1000,
      overrides.raw_category ?? "ropa",
      JSON.stringify(overrides.metadata ?? {}),
    ],
  );
  return r.rows[0];
}

export async function seedProductWithEmbedding(
  pg: Client,
  overrides: Partial<{
    title: string;
    description: string;
    price_cents: number;
    raw_category: string;
    metadata: Record<string, unknown>;
  }> = {},
): Promise<{ id: string }> {
  const sid = randomUUID();
  const title = overrides.title ?? `Seeded with embedding ${sid.slice(0, 8)}`;
  const description = overrides.description ?? "";
  const canonical = `${title}\n${description}`;
  const [embedding] = await embed([canonical], { inputType: "document" });
  const r = await pg.query(
    `INSERT INTO products (source, source_product_id, title, description, price_cents, currency, image_url, raw_category, metadata, embedding)
     VALUES ('seed', $1, $2, $3, $4, 'USD', null, $5, $6::jsonb, $7::vector)
     RETURNING id`,
    [
      sid,
      title,
      description,
      overrides.price_cents ?? 1000,
      overrides.raw_category ?? "ropa",
      JSON.stringify(overrides.metadata ?? { category: overrides.raw_category ?? "ropa" }),
      "[" + embedding.join(",") + "]",
    ],
  );
  return r.rows[0];
}
