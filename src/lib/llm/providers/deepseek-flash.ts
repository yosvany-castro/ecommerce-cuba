import { sendMessageDeepSeek, DEEPSEEK_MODELS } from "../deepseek";
import type { ChatInput, ChatOutput, LLMProvider } from "../types";

/**
 * DeepSeek v4-flash provider. Default for normalization tasks at high volume:
 * Phase 1 product enrichment + Phase 2 query normalization.
 *
 * Cost: ~$0.14/M input (cache miss), ~$0.028/M input (cache hit, automatic),
 * ~$0.28/M output. ~13× cheaper than Anthropic Haiku 4.5 per call.
 *
 * `cacheSystem` is silently ignored (server-side caching is automatic).
 */
export const deepseekFlashProvider: LLMProvider = {
  name: "deepseek-chat",   // actual API model; will track DEEPSEEK_MODELS.flash when string changes
  async chat(input: ChatInput): Promise<ChatOutput> {
    const res = await sendMessageDeepSeek({
      model: DEEPSEEK_MODELS.flash,
      system: input.system,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature ?? 0,
      jsonMode: input.jsonMode ?? false,
    });
    return {
      text: res.text,
      usage: res.usage,
    };
  },
};
