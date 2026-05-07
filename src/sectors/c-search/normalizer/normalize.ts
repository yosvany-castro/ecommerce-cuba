import { defaultProvider, type LLMProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  normalizedQuerySchema,
  type NormalizedQuery,
} from "./prompt";

export async function normalizeQueryWithLLM(
  rawQuery: string,
  provider: LLMProvider = defaultProvider,
): Promise<NormalizedQuery & { prompt_version: string }> {
  const res = await provider.chat({
    system: SYSTEM_PROMPT,
    cacheSystem: true,
    jsonMode: true,
    messages: [{ role: "user", content: rawQuery }],
    maxTokens: 300,
    temperature: 0,
  });
  const text = stripMarkdownWrapper(res.text);
  const parsed = JSON.parse(text);
  return { ...normalizedQuerySchema.parse(parsed), prompt_version: PROMPT_VERSION };
}
