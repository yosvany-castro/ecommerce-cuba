#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { randomUUID } from "node:crypto";
import { getPgClient } from "@/lib/db/pg";
import { seedProductWithEmbedding } from "@/../tests/helpers/seed";
import { computeCohortCentroids } from "@/sectors/d-personalization/cohorts/centroid-compute";
import { processEventForPersonalization } from "@/sectors/d-personalization/track-hook";
import { generateFeed } from "@/sectors/d-personalization/feed";

async function main() {
  const pg = await getPgClient({ scope: "test" });
  try {
    await pg.query(
      `TRUNCATE test_schema.feed_rerank_cache, test_schema.products,
                test_schema.cohort_centroids, test_schema.user_profiles,
                test_schema.user_profile_modes, test_schema.session_vectors,
                test_schema.events, test_schema.anonymous_sessions CASCADE`,
    );

    const cohorts = [
      { gender: "femenino", age: { min: 26, max: 59 }, label: "mujer_adulta" },
      {
        gender: "masculino",
        age: { min: 26, max: 59 },
        label: "hombre_adulto",
      },
      { gender: "femenino", age: { min: 4, max: 11 }, label: "niña" },
    ];
    const ids = new Map<string, string[]>();
    for (const c of cohorts) {
      const list: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = await seedProductWithEmbedding(pg, {
          title: `${c.label} producto ${i}`,
          metadata: { gender_target: c.gender, age_target: c.age },
        });
        list.push(p.id);
      }
      ids.set(c.label, list);
    }
    await computeCohortCentroids(pg);

    console.log(
      `# Fase 3c — Auditoría manual de razones · ${new Date().toISOString().slice(0, 10)}\n`,
    );
    console.log(
      `**Instrucciones:** Marca cada razón como coherente (\`[x]\`) o no (\`[ ]\`).`,
    );
    console.log(`Target master doc: ≥80% coherentes.\n`);
    console.log(`---\n`);

    for (const c of cohorts) {
      const aid = randomUUID();
      const sid = randomUUID();
      await pg.query(
        `INSERT INTO anonymous_sessions (anonymous_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [aid],
      );
      const products = ids.get(c.label) ?? [];
      for (let i = 0; i < 8; i++) {
        const id = products[i % products.length];
        const ts = new Date(Date.now() + i * 1000).toISOString();
        await pg.query(
          `INSERT INTO events (anonymous_id, session_id, event_type, occurred_at, payload)
           VALUES ($1, $2, 'product_view', $3, $4::jsonb)`,
          [aid, sid, ts, JSON.stringify({ product_id: id, source: "home" })],
        );
        await processEventForPersonalization(
          {
            anonymous_id: aid,
            user_id: null,
            session_id: sid,
            event_type: "product_view",
            payload: { product_id: id, source: "home" },
            occurred_at: ts,
          },
          pg,
        );
      }

      const feed = await generateFeed(
        { user_id: null, anonymous_id: aid, session_id: sid, limit: 10 },
        pg,
      );

      console.log(`## Usuario sintético: ${c.label}\n`);
      console.log(`| # | Producto | Razón | ¿Coherente? |`);
      console.log(`|---|---|---|---|`);
      feed.forEach((it, idx) => {
        const reason = (it.reason ?? "(sin razón)").replace(/\|/g, "\\|");
        const title = it.product.title.replace(/\|/g, "\\|");
        console.log(`| ${idx + 1} | ${title} | ${reason} | [ ] |`);
      });
      console.log();
    }

    console.log(`---\n`);
    console.log(`## Conteo final (rellenar tras revisión)\n`);
    console.log(`- Coherentes: ___ / 30`);
    console.log(`- Compuerta ≥80%: ✅/⚠️`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
