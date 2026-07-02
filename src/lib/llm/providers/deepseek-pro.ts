import { sendMessageDeepSeek, DEEPSEEK_MODELS } from "../deepseek";
import type { ChatInput, ChatOutput, LLMProvider } from "../types";

/**
 * DeepSeek v4-pro provider with thinking ENABLED. For agent workloads
 * (Phase 2 merchandiser) where reasoning quality matters more than cost.
 *
 * NOT for high-volume extraction: every call bills reasoning tokens on top of
 * the answer. Use deepseekFlashProvider (thinking disabled) for that.
 *
 * `maxTokens` caps the whole completion including reasoning — callers should
 * budget generously (reasoning alone can run hundreds of tokens).
 */
export const deepseekProProvider: LLMProvider = {
  name: DEEPSEEK_MODELS.pro,
  async chat(input: ChatInput): Promise<ChatOutput> {
    const res = await sendMessageDeepSeek({
      model: DEEPSEEK_MODELS.pro,
      system: input.system,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature ?? 0,
      jsonMode: input.jsonMode ?? false,
      thinking: "enabled",
      reasoningEffort: "high",
    });
    return {
      text: res.text,
      usage: res.usage,
    };
  },
};
