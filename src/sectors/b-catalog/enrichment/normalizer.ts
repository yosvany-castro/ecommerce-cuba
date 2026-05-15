import { defaultProvider, type LLMProvider } from "@/lib/llm/providers";
import type { MockProduct } from "@/sectors/b-catalog/mock/types";
import { PROMPT_VERSION, SYSTEM_PROMPT, normalizedSchema, type NormalizedFromLLM } from "./prompt";

export type EnrichmentStatus = "ok" | "error";

export interface NormalizedMetadata extends Omit<NormalizedFromLLM, "enrichment_status"> {
  enrichment_status: EnrichmentStatus;
  enrichment_error?: string;
  prompt_version: string;
}

export function stripMarkdownWrapper(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` wrappers that some models emit
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

export async function normalizeWithLLM(
  raw: MockProduct,
  provider: LLMProvider = defaultProvider,
): Promise<NormalizedMetadata> {
  const userMsg = JSON.stringify({
    title: raw.title,
    description: raw.description,
    raw_category: raw.raw_category,
    brand: raw.brand,
    attributes: raw.attributes,
  });

  let llmText = "";
  try {
    const res = await provider.chat({
      system: SYSTEM_PROMPT,
      cacheSystem: true,
      jsonMode: true,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 400,
      temperature: 0,
    });
    llmText = res.text;
    const cleaned = stripMarkdownWrapper(llmText);
    const parsed = JSON.parse(cleaned);
    const valid = normalizedSchema.parse(parsed);
    return { ...valid, prompt_version: PROMPT_VERSION };
  } catch (e) {
    return {
      category: "otros",
      subcategory: raw.raw_category ?? null,
      gender_target: null,
      age_target: { min: null, max: null },
      occasion: [],
      style: [],
      keywords: [],
      enrichment_status: "error",
      enrichment_error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
      prompt_version: PROMPT_VERSION,
    };
  }
}
