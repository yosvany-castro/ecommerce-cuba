/**
 * Thin wrapper around DeepSeek's OpenAI-compatible chat completions API.
 *
 * DeepSeek is significantly cheaper than Anthropic Haiku for structured JSON
 * extraction at scale (product normalizer, query normalizer). Anthropic remains
 * available via @/lib/llm/anthropic for tasks where reasoning quality matters
 * (e.g., future Phase 3c reranker).
 *
 * Pricing (deepseek-v4-flash, as of 2026-05): cache hit $0.0028/M input,
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
   * Cheap high-volume model for JSON extraction. V4 defaults to thinking
   * ENABLED — callers that want the old `deepseek-chat` behavior (deprecated
   * 2026-07-24, ≡ v4-flash non-thinking) MUST pass `thinking: "disabled"` or
   * every call burns reasoning tokens.
   */
  flash: process.env.DEEPSEEK_MODEL_FLASH ?? "deepseek-v4-flash",
  /** Reasoning model for agent workloads (thinking enabled by default). */
  pro: process.env.DEEPSEEK_MODEL_PRO ?? "deepseek-v4-pro",
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
      // SDK default is ~10 min — a hung DeepSeek must fail fast into the
      // callers' graceful fallbacks (normalizer/reranker catch), not freeze
      // an SSR render. ponytail: 60s flat; per-call budgets if ever needed.
      timeout: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 60_000),
    });
  }
  return _client;
}

export interface SendMessageDeepSeekInput extends SendMessageInput {
  /** Force JSON output mode. Requires the prompt to contain the literal word "JSON". */
  jsonMode?: boolean;
  /**
   * V4 thinking-mode toggle. The API default is ENABLED — pass "disabled" for
   * extraction workloads or reasoning tokens are billed on every call.
   */
  thinking?: "enabled" | "disabled";
  /** Reasoning effort when thinking is enabled. DeepSeek accepts high | max. */
  reasoningEffort?: "high" | "max";
}

export async function sendMessageDeepSeek(
  input: SendMessageDeepSeekInput,
): Promise<SendMessageOutput> {
  const messages = [
    { role: "system" as const, content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // `thinking` / `reasoning_effort` are DeepSeek extensions absent from the
  // OpenAI param types; the SDK forwards unknown body fields as-is.
  const completion = await client().chat.completions.create({
    model: input.model,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    stream: false,
    ...(input.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...(input.thinking ? { thinking: { type: input.thinking } } : {}),
    ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

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
