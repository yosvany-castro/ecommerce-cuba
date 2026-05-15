/**
 * Thin wrapper around DeepSeek's OpenAI-compatible chat completions API.
 *
 * DeepSeek is significantly cheaper than Anthropic Haiku for structured JSON
 * extraction at scale (product normalizer, query normalizer). Anthropic remains
 * available via @/lib/llm/anthropic for tasks where reasoning quality matters
 * (e.g., future Phase 3c reranker).
 *
 * Pricing (deepseek-v4-flash, as of 2026-05): cache hit $0.028/M input,
 * cache miss $0.14/M input, $0.28/M output. ~13× cheaper than Haiku 4.5.
 *
 * NOTE: The SendMessageInput interface includes a `cacheSystem` field used for
 * Anthropic prompt caching. For DeepSeek, caching is automatic (server-side)
 * and requires no client-side action — this field is silently ignored here.
 */
import OpenAI from "openai";
import type { SendMessageInput, SendMessageOutput } from "./anthropic";

export const DEEPSEEK_MODELS = {
  /**
   * Non-thinking mode for cheap JSON extraction. Uses the legacy alias
   * `deepseek-chat` (DeepSeek-V3 non-thinking) which deprecates 2026-07-24.
   * Before that date: migrate to `deepseek-v4-flash` with the appropriate
   * non-thinking parameter — consult api-docs.deepseek.com at migration time.
   * Tested non-thinking returns content directly (no reasoning_content burn).
   */
  flash: "deepseek-chat",
  /** Reasoning model — reserved for future use, not currently called. */
  pro: "deepseek-v4-pro",
} as const;

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY is required");
    }
    _client = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  return _client;
}

export interface SendMessageDeepSeekInput extends SendMessageInput {
  /** Force JSON output mode. Requires the prompt to contain the literal word "JSON". */
  jsonMode?: boolean;
}

export async function sendMessageDeepSeek(
  input: SendMessageDeepSeekInput,
): Promise<SendMessageOutput> {
  const messages = [
    { role: "system" as const, content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const completion = await client().chat.completions.create({
    model: input.model,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    stream: false,
    ...(input.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });

  const text = completion.choices[0]?.message?.content ?? "";
  return {
    text,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
      // DeepSeek doesn't expose cache breakdown via OpenAI compat shape;
      // their context caching is automatic and reflected in billing.
    },
  };
}
