import { deepseekFlashProvider } from "./deepseek-flash";
import { anthropicHaikuProvider } from "./anthropic-haiku";
import type { LLMProvider } from "../types";

export { deepseekFlashProvider, anthropicHaikuProvider };
export type { LLMProvider } from "../types";
export type { ChatInput, ChatOutput } from "../types";

/**
 * Default provider for normalization tasks (low reasoning, high volume).
 * To switch globally for an experiment: change this binding here.
 * To switch for a single call: pass a different provider as argument.
 */
export const defaultProvider: LLMProvider = deepseekFlashProvider;
