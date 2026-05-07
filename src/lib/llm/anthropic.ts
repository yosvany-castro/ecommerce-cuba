import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock, TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";

export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export interface SendMessageInput {
  model: string;
  system: string;
  cacheSystem?: boolean;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature?: number;
}

export interface SendMessageOutput {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageOutput> {
  const sys: string | Array<TextBlockParam> =
    input.cacheSystem
      ? [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }]
      : input.system;

  const res = await client().messages.create({
    model: input.model,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    system: sys,
    messages: input.messages,
  });

  const text = res.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: (res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
      cache_read_input_tokens: (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
    },
  };
}
