/**
 * A2 probe: DeepSeek v4 <-> @langchain/deepseek 1.0.27 wire-level verification.
 * Three minimal calls (~$0.001 total):
 *   1. v4-flash + thinking enabled + bindTools -> does it return tool_calls?
 *   2. Continue the tool loop (AIMessage + ToolMessage appended) -> 400 or success?
 *      (DeepSeek docs say reasoning_content MUST be passed back in tool loops;
 *       LangChain's converter strips it -> this is the decisive test.)
 *   3. v4-flash + thinking disabled + withStructuredOutput (functionCalling).
 * A logging fetch captures the exact request body to verify what modelKwargs
 * puts on the wire.
 */
import { readFileSync } from "node:fs";

// Minimal .env.local loader (no dotenv dependency games)
for (const line of readFileSync("/workspaces/ecommerce-cuba/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { ChatDeepSeek } from "@langchain/deepseek";
import { tool } from "@langchain/core/tools";
import { HumanMessage, ToolMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";

const wireBodies: Record<string, unknown>[] = [];
const loggingFetch: typeof fetch = async (url, init) => {
  if (init?.body) {
    try {
      wireBodies.push(JSON.parse(init.body as string));
    } catch {
      /* ignore */
    }
  }
  return fetch(url, init);
};

const getPrice = tool(async ({ sku }: { sku: string }) => `${sku}: 19.99 USD`, {
  name: "get_price",
  description: "Devuelve el precio actual de un SKU",
  schema: z.object({ sku: z.string().describe("El SKU del producto") }),
});

async function main() {
  // ---- Test 1+2: thinking-mode tool loop ----
  const thinkingModel = new ChatDeepSeek({
    model: "deepseek-v4-flash",
    temperature: 0,
    maxTokens: 500,
    modelKwargs: { thinking: { type: "enabled" }, reasoning_effort: "high" },
    configuration: { fetch: loggingFetch },
  });
  const withTools = thinkingModel.bindTools([getPrice]);

  const messages: (HumanMessage | AIMessage | ToolMessage)[] = [
    new HumanMessage("Usa get_price para el SKU 'ABC-1' y responde SOLO el precio. Nada mas."),
  ];

  console.log("=== CALL 1: thinking enabled + tools ===");
  const r1 = await withTools.invoke(messages);
  console.log("wire body 1 keys:", Object.keys(wireBodies[0] ?? {}).join(","));
  console.log("wire thinking:", JSON.stringify((wireBodies[0] as any)?.thinking));
  console.log("wire reasoning_effort:", JSON.stringify((wireBodies[0] as any)?.reasoning_effort));
  console.log("wire max_tokens:", JSON.stringify((wireBodies[0] as any)?.max_tokens), "max_completion_tokens:", JSON.stringify((wireBodies[0] as any)?.max_completion_tokens));
  console.log("tool_calls:", JSON.stringify(r1.tool_calls));
  console.log("reasoning_content present:", typeof (r1.additional_kwargs as any)?.reasoning_content);
  console.log("reasoning_content first 80 chars:", String((r1.additional_kwargs as any)?.reasoning_content ?? "").slice(0, 80));
  console.log("usage:", JSON.stringify(r1.usage_metadata));

  if (!r1.tool_calls?.length) {
    console.log("NO TOOL CALLS -> thinking mode did not emit tool_calls. Stopping.");
    return;
  }

  messages.push(r1);
  messages.push(
    new ToolMessage({
      content: "ABC-1: 19.99 USD",
      tool_call_id: r1.tool_calls[0].id!,
    }),
  );

  console.log("\n=== CALL 2: tool result round-trip (decisive: 400 vs OK) ===");
  try {
    const r2 = await withTools.invoke(messages);
    console.log("SUCCESS. content:", JSON.stringify(r2.content).slice(0, 200));
    const assistantMsgOnWire = (wireBodies[1] as any)?.messages?.find((m: any) => m.role === "assistant");
    console.log("assistant msg keys on wire (call 2):", Object.keys(assistantMsgOnWire ?? {}).join(","));
    console.log("reasoning_content sent back?:", "reasoning_content" in (assistantMsgOnWire ?? {}));
  } catch (e: any) {
    console.log("FAILED:", e?.status ?? "", String(e?.message ?? e).slice(0, 500));
    const assistantMsgOnWire = (wireBodies[1] as any)?.messages?.find((m: any) => m.role === "assistant");
    console.log("assistant msg keys on wire (call 2):", Object.keys(assistantMsgOnWire ?? {}).join(","));
  }

  // ---- Test 3: structured output, thinking disabled ----
  console.log("\n=== CALL 3: withStructuredOutput, thinking disabled ===");
  const extractModel = new ChatDeepSeek({
    model: "deepseek-v4-flash",
    temperature: 0,
    maxTokens: 200,
    modelKwargs: { thinking: { type: "disabled" } },
    configuration: { fetch: loggingFetch },
  });
  const structured = extractModel.withStructuredOutput(
    z.object({
      sku: z.string(),
      price_usd: z.number(),
    }),
    { name: "extract_price" },
  );
  try {
    const r3 = await structured.invoke("El producto XYZ-9 cuesta 42.50 USD.");
    console.log("structured result:", JSON.stringify(r3));
    const lastBody = wireBodies[wireBodies.length - 1] as any;
    console.log("wire tool_choice:", JSON.stringify(lastBody?.tool_choice));
    console.log("wire thinking:", JSON.stringify(lastBody?.thinking));
  } catch (e: any) {
    console.log("FAILED:", String(e?.message ?? e).slice(0, 300));
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
