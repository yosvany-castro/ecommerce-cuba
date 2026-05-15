import { NextResponse } from "next/server";
import { sendMessage, MODELS } from "@/lib/llm/anthropic";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const out = await sendMessage({
      model: MODELS.haiku,
      system: "Eres un asistente conciso.",
      messages: [{ role: "user", content: "Responde con la palabra 'ok' y nada más." }],
      maxTokens: 8,
    });
    return NextResponse.json({
      ok: true,
      model: MODELS.haiku,
      response_excerpt: out.text.slice(0, 16),
      input_tokens: out.usage.input_tokens,
      output_tokens: out.usage.output_tokens,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
