/**
 * Provider-agnostic LLM interfaces. Concrete adapters live under `./providers/`.
 *
 * The interface intentionally exposes the union of features needed across
 * providers. Each adapter ignores fields that don't apply to its backend
 * (e.g., DeepSeek server-side caches automatically — `cacheSystem` is a no-op
 * for it; Anthropic doesn't have JSON mode like DeepSeek's `response_format`
 * — `jsonMode` is a no-op there, the prompt itself enforces JSON output).
 */
export interface ChatInput {
  /** System prompt. Sent as system role for both providers. */
  system: string;
  /** Conversation messages (no system; system goes in the field above). */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Hard cap on output tokens. */
  maxTokens: number;
  /** 0 for deterministic; default 0 if not specified. */
  temperature?: number;
  /** If true, request enforced JSON output (provider-specific implementation). */
  jsonMode?: boolean;
  /**
   * If true, instruct the provider to cache the system prompt so repeated calls
   * pay reduced rates. Anthropic uses ephemeral cache_control. DeepSeek caches
   * server-side automatically — this flag is silently ignored.
   */
  cacheSystem?: boolean;
}

export interface ChatOutput {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    /** Anthropic-specific (when cacheSystem is on). DeepSeek leaves these undefined. */
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface LLMProvider {
  /** Stable identifier for logging / metrics. */
  name: string;
  chat(input: ChatInput): Promise<ChatOutput>;
}
