import { ChatDeepSeek } from "@langchain/deepseek";
import { DEEPSEEK_MODELS } from "@/lib/llm/deepseek";

/**
 * Factories de modelo del agente (A2 §6, wire-verificado). Reglas duras:
 * - modelKwargs es el ÚNICO canal del body extra v4 (thinking,
 *   reasoning_effort); el campo `reasoning` del constructor lo pisa y su tipo
 *   no admite "max".
 * - PROHIBIDO tool_choice forzado (named o "required") con thinking ON: la
 *   API devuelve 400 (verificado empíricamente, A2 test 4).
 * - maxTokens explícito siempre (default de la API no documentado; reasoning
 *   tokens cuentan contra max_tokens).
 * - Instanciación LAZY: el constructor LANZA si falta DEEPSEEK_API_KEY —
 *   jamás a nivel de módulo.
 */

function deepseekV4(opts: {
  model: string;
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  maxTokens: number;
  temperature?: number;
}) {
  return new ChatDeepSeek({
    model: opts.model,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens,
    modelKwargs: {
      thinking: { type: opts.thinking },
      ...(opts.thinking === "enabled" && opts.reasoningEffort
        ? { reasoning_effort: opts.reasoningEffort }
        : {}),
    },
  });
}

/** Loop de tools del merchandiser — tools en thinking mode, tool_choice auto SOLO. */
export const merchandiserLoopModel = () =>
  deepseekV4({
    model: DEEPSEEK_MODELS.flash,
    thinking: "enabled",
    reasoningEffort: "high",
    maxTokens: 8192,
  });

/** Subagente crítico — razonamiento máximo; veredicto = JSON en texto plano
 *  (sin responseFormat: riesgo de tool_choice forzado con thinking ON). */
export const criticModel = () =>
  deepseekV4({
    model: DEEPSEEK_MODELS.pro,
    thinking: "enabled",
    reasoningEffort: "max",
    maxTokens: 16384,
  });
