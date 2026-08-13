// src/sectors/d-personalization/intent/infer.ts — EL VENDEDOR QUE INTUYE.
// Dado lo que la sesión está MIRANDO, infiere la intención de compra y sus
// complementos ("mochila escolar" → curso escolar → lápices, libretas,
// colores), los resuelve contra el catálogo por coseno y, si el estante está
// vacío, manda a INGERIR el término (presupuesto/freshness de búsqueda mandan).
//
// Corre FIRE-AND-FORGET desde el track de product_view (conexión propia,
// jamás bloquea el request) y con freshness por sesión: el LLM solo se paga
// cuando la sesión miró algo NUEVO. Costo ≈ $0.0002 por inferencia (flash).
import { z } from "zod";
import { withPgDirect } from "@/lib/db/helpers";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import { embed } from "@/lib/embeddings/voyage";
import { hashQuery } from "@/sectors/c-search/cache/hash";
import { queueExternalIngest } from "@/sectors/c-search/ingest-async";
import { singleFlight } from "@/sectors/c-search/decide/single-flight";

const SYSTEM = `Eres el vendedor experto de una tienda online para Cuba. Te digo los productos que un cliente está mirando en su sesión y devuelves JSON con la intención de compra que intuyes y qué productos COMPLEMENTARIOS le acercarías (lo próximo que va a necesitar, no más de lo mismo).

Formato: {"label": string, "terms": string[]}
- label: la intención en 2-4 palabras, natural, en español ("el curso escolar", "tu cocina nueva", "entrenar boxeo")
- terms: 2 a 4 búsquedas CONCRETAS de productos complementarios, en español, sin acentos ("lapices y boligrafos", "libretas escolares", "cartuchera")
- Complementario = lo que se usa JUNTO a lo mirado o el siguiente paso. JAMÁS repitas la categoría de lo que ya mira.
- Si lo mirado no sugiere nada claro, devuelve {"label": "", "terms": []}.
Devuelve SOLO el JSON.`;

const intentSchema = z.object({ label: z.string().max(60), terms: z.array(z.string().min(3).max(60)).max(4) });

const COSINE_FLOOR = 0.45;
const MIN_LOCAL_HITS = 3;

/** Fire-and-forget: infiere y persiste la intención de la sesión. Nunca lanza. */
export function triggerIntentInference(sessionId: string | null): void {
  if (!sessionId) return;
  const p = singleFlight(`intent:${sessionId}`, () => inferSessionIntent(sessionId));
  p.catch(() => {});
}

async function inferSessionIntent(sessionId: string): Promise<void> {
  await withPgDirect(async (pg) => {
    // Últimos vistos de la sesión (títulos + categorías reales).
    const viewed = await pg.query(
      `SELECT DISTINCT ON (e.payload->>'product_id')
              e.payload->>'product_id' AS id, p.title, p.metadata->>'category' AS category, e.occurred_at
       FROM events e
       JOIN products p ON p.id = (e.payload->>'product_id')::uuid
       WHERE e.session_id = $1 AND e.event_type = 'product_view'
       ORDER BY e.payload->>'product_id', e.occurred_at DESC`,
      [sessionId],
    );
    const rows = (viewed.rows as { id: string; title: string; category: string | null; occurred_at: string }[])
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, 5);
    if (rows.length === 0) return;

    // Freshness: si no miró nada nuevo desde el último cómputo, no se re-paga.
    const newest = rows[0].id;
    const prev = await pg.query(`SELECT computed_from FROM session_intents WHERE session_id = $1`, [sessionId]);
    if (prev.rows[0]?.computed_from === newest) return;

    // 1. Inferir con flash (barato, prompt cacheado server-side).
    const lines = rows.map((r) => `- ${r.title.slice(0, 90)}${r.category ? ` [${r.category}]` : ""}`).join("\n");
    const res = await defaultProvider.chat({
      system: SYSTEM,
      cacheSystem: true,
      jsonMode: true,
      messages: [{ role: "user", content: `Está mirando:\n${lines}` }],
      maxTokens: 200,
      temperature: 0,
    });
    const parsed = intentSchema.safeParse(JSON.parse(stripMarkdownWrapper(res.text)));
    if (!parsed.success || parsed.data.terms.length === 0) return;
    const { label, terms } = parsed.data;

    // 2. Resolver complementos contra el catálogo (UN batch de embeddings).
    const vecs = await embed(terms, { inputType: "query" });
    const viewedIds = rows.map((r) => r.id);
    const found: string[] = [];
    let emptiestTerm: string | null = null; // término SIN matches → a surtir
    for (let i = 0; i < vecs.length; i++) {
      const r = await pg.query(
        `SELECT id::text AS id, 1 - (embedding <=> $1::vector) AS score
         FROM products
         WHERE is_active = true AND embedding IS NOT NULL
           AND NOT (id = ANY($2::uuid[]))
         ORDER BY embedding <=> $1::vector ASC
         LIMIT 5`,
        [JSON.stringify(vecs[i]), viewedIds],
      );
      let termHits = 0;
      for (const row of r.rows as { id: string; score: number }[]) {
        if (row.score >= COSINE_FLOOR) {
          termHits++;
          if (!found.includes(row.id)) found.push(row.id);
        }
      }
      if (termHits === 0 && !emptiestTerm) emptiestTerm = terms[i];
    }

    // 3. Estante vacío → el vendedor va a SURTIRLO: se ingesta el término sin
    //    matches (o el primero si el total quedó corto). El gasto lo gobiernan
    //    la freshness por query y el presupuesto diario de la búsqueda.
    const toIngest = emptiestTerm ?? (found.length < MIN_LOCAL_HITS ? terms[0] : null);
    if (toIngest) {
      const sp = await pg.query(`SHOW search_path`);
      queueExternalIngest({
        hash: hashQuery(toIngest),
        query: toIngest,
        limit: 20,
        searchPath: (sp.rows[0]?.search_path as string) ?? "public",
      });
    }

    await pg.query(
      `INSERT INTO session_intents (session_id, label, terms, product_ids, computed_from, computed_at)
       VALUES ($1, $2, $3, $4::uuid[], $5, now())
       ON CONFLICT (session_id) DO UPDATE SET
         label = EXCLUDED.label, terms = EXCLUDED.terms, product_ids = EXCLUDED.product_ids,
         computed_from = EXCLUDED.computed_from, computed_at = now()`,
      [sessionId, label, terms, found, newest],
    );
  });
}
