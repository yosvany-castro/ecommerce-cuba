import { z } from "zod";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import { RERANKER_SYSTEM_PROMPT, PROMPT_VERSION } from "./prompt";

// NOTE: F3c brainstorming originally chose Anthropic Haiku 4.5 (dormant) for
// this reranker. At implementation time the Anthropic credit was depleted, so
// we switched to defaultProvider (DeepSeek). The LLMProvider adapter pattern
// (F2) makes this a one-line swap. Anthropic remains as backup for future
// "premium" mode if quality requires it.

const responseSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        rank: z.number().int().min(1).max(10),
        reason: z.string().min(1).max(200),
      }),
    )
    .length(10),
});

export interface RerankerContext {
  profile_summary: string;
  hour: number;
  day_of_week: string;
  last_interaction: string | null;
  recent_query: string | null;
}

export interface RerankerCandidate {
  product_id: string;
  title: string;
  price_cents: number;
  brand: string;
  category: string;
}

export interface RerankerOutput {
  items: { product_id: string; rank: number; reason: string }[];
  prompt_version: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function rerankWithLLM(input: {
  candidates: RerankerCandidate[];
  context: RerankerContext;
}): Promise<RerankerOutput> {
  if (input.candidates.length < 10) {
    throw new Error(
      `reranker requires >= 10 candidates, got ${input.candidates.length}`,
    );
  }
  const userMsg = JSON.stringify({
    profile: input.context.profile_summary,
    contexto: { hora: input.context.hour, dia: input.context.day_of_week },
    ultima_interaccion: input.context.last_interaction,
    query_reciente: input.context.recent_query,
    candidatos: input.candidates,
  });
  const res = await defaultProvider.chat({
    system: RERANKER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 2000,
    temperature: 0.3,
    jsonMode: true,
    cacheSystem: true,
  });
  const text = stripMarkdownWrapper(res.text);
  const parsed = JSON.parse(text);
  const valid = responseSchema.parse(parsed);

  const ranks = new Set(valid.items.map((x) => x.rank));
  if (ranks.size !== 10) {
    throw new Error("reranker returned non-unique ranks");
  }
  const inputIds = new Set(input.candidates.map((c) => c.product_id));
  for (const it of valid.items) {
    if (!inputIds.has(it.product_id)) {
      throw new Error(`reranker returned unknown product_id ${it.product_id}`);
    }
  }

  return {
    items: valid.items,
    prompt_version: PROMPT_VERSION,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
    },
  };
}
