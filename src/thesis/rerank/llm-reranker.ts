import { z } from "zod";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";

/** One candidate the LLM sees (compact, with the retrieval-invisible signals). */
export interface LlmCandidate {
  product_id: string;
  title: string;
  price_cents: number;
  brand: string;
  category: string;
  npmi_to_last_viewed: number;
  source: string;
}

export interface LlmRerankContext {
  profile_summary: string;
  is_gift: boolean;
  recipient_summary: string | null;
  last_viewed: string | null;
}

export interface LlmRerankResult {
  order: string[]; // reranked product_ids (top first)
  usedFallback: boolean;
}

const responseSchema = z.object({
  items: z.array(z.object({ product_id: z.string(), rank: z.number().int().min(1) })).min(1),
});

const SYSTEM_PROMPT = `Eres un curador experto de una tienda reseller en Cuba. Recibes un perfil de usuario, si la sesión es un regalo (y para quién), el último producto visto, y una lista de candidatos con señales: npmi_to_last_viewed (fuerza de co-compra con lo último visto) y source. Reordena los candidatos del MÁS al MENOS relevante para ESTE usuario en ESTE momento. Prioriza: relevancia al perfil; si es regalo, ajuste al destinatario; complementos del último visto (npmi alto). Devuelve SOLO JSON: { "items": [ { "product_id": "...", "rank": 1 }, ... ] } con todos los candidatos, ranks únicos desde 1. Sin markdown.`;

/**
 * LLM listwise reranker (DeepSeek via defaultProvider). Returns the reranked id
 * order over the given candidates; on any LLM/parse failure returns the input
 * order with usedFallback=true (the caller COUNTS fallbacks — fixes the audit's
 * "silent fallback"). Candidate signals (npmi, source) are in the prompt so the
 * LLM can use information the pure retrieval order lacks.
 */
export async function llmRerank(candidates: LlmCandidate[], ctx: LlmRerankContext): Promise<LlmRerankResult> {
  const inputOrder = candidates.map((c) => c.product_id);
  if (candidates.length === 0) return { order: [], usedFallback: false };
  try {
    const payload = {
      profile: ctx.profile_summary,
      is_gift: ctx.is_gift,
      recipient: ctx.recipient_summary,
      last_viewed: ctx.last_viewed,
      candidatos: candidates,
    };
    const res = await defaultProvider.chat({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      maxTokens: 2000,
      temperature: 0,
      jsonMode: true,
    });
    const parsed = responseSchema.parse(JSON.parse(stripMarkdownWrapper(res.text)));
    const allowed = new Set(inputOrder);
    const ordered = parsed.items
      .filter((it) => allowed.has(it.product_id))
      .sort((a, b) => a.rank - b.rank)
      .map((it) => it.product_id);
    const seen = new Set(ordered);
    for (const id of inputOrder) if (!seen.has(id)) ordered.push(id);
    return { order: ordered, usedFallback: false };
  } catch {
    return { order: inputOrder, usedFallback: true };
  }
}
