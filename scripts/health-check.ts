#!/usr/bin/env tsx
import { config } from "dotenv";
config({ path: ".env.local" });

import { embed, EMBEDDING_DIM } from "@/lib/embeddings/voyage";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";
import { getPgClient } from "@/lib/db/pg";

async function main() {
  console.log("=== Health Check ===");

  const pg = await getPgClient();
  try {
    const ext = await pg.query(`SELECT extversion FROM pg_extension WHERE extname='vector'`);
    console.log(`DB: pgvector ${ext.rows[0]?.extversion ?? "MISSING"}`);
    const tables = await pg.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`);
    console.log(`DB: ${tables.rows[0].n} tables in public`);
  } finally {
    await pg.end();
  }

  const [vec] = await embed(["smoke test"], { inputType: "document" });
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  console.log(`Voyage: dim=${vec.length} (expected ${EMBEDDING_DIM}), norm=${norm.toFixed(4)}`);

  const out = await sendMessage({
    model: MODELS.haiku,
    system: "Asistente conciso.",
    messages: [{ role: "user", content: "Responde 'ok'." }],
    maxTokens: 8,
  });
  console.log(`Anthropic: model=${MODELS.haiku}, response="${out.text.trim()}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
