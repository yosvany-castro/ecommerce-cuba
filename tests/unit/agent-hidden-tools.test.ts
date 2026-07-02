import { describe, test, expect, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { hideBuiltinTools } from "@/sectors/g-agents/runtime/merchandiser";

/**
 * Regresión del crash del gate 2026-06-11: el critic alucinó write_todos con
 * {text} en vez de {content}; el ToolNode lo ejecutó (filtrar el request del
 * modelo no des-registra la tool del grafo) y el schema mismatch escaló a
 * MiddlewareError fatal matando el run completo. El middleware DEBE
 * short-circuitear la ejecución de builtins ocultos con un ToolMessage
 * recuperable, jamás dejarla llegar a la tool.
 */
describe("hideBuiltinTools.wrapToolCall", () => {
  const hook = (
    hideBuiltinTools as unknown as {
      wrapToolCall: (req: unknown, handler: (req: unknown) => unknown) => Promise<unknown>;
    }
  ).wrapToolCall;

  test("builtin oculto (write_todos) ⇒ ToolMessage de error sin ejecutar el handler", async () => {
    const handler = vi.fn();
    const out = await hook(
      { toolCall: { name: "write_todos", id: "call_1", args: { todos: [{ text: "x" }] } } },
      handler,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(out).toBeInstanceOf(ToolMessage);
    expect((out as ToolMessage).status).toBe("error");
    expect((out as ToolMessage).tool_call_id).toBe("call_1");
  });

  test("tool propia (propose_placement) ⇒ pasa al handler intacta", async () => {
    const req = { toolCall: { name: "propose_placement", id: "call_2", args: {} } };
    const handler = vi.fn().mockResolvedValue("ok");
    const out = await hook(req, handler);
    expect(handler).toHaveBeenCalledWith(req);
    expect(out).toBe("ok");
  });
});
