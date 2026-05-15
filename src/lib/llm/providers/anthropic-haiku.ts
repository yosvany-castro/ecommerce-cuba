import { sendMessage, MODELS } from "../anthropic";
import type { ChatInput, ChatOutput, LLMProvider } from "../types";

/**
 * Anthropic Haiku 4.5 provider. Currently dormant (DeepSeek covers normalizer
 * use cases at ~13× lower cost). Reserved for future high-reasoning tasks
 * where DeepSeek's quality is insufficient (e.g., Phase 3c contextual reranker).
 */
export const anthropicHaikuProvider: LLMProvider = {
  name: "anthropic-haiku-4.5",
  async chat(input: ChatInput): Promise<ChatOutput> {
    const res = await sendMessage({
      model: MODELS.haiku,
      system: input.system,
      cacheSystem: input.cacheSystem ?? false,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature ?? 0,
    });
    return {
      text: res.text,
      usage: res.usage,
    };
  },
};
