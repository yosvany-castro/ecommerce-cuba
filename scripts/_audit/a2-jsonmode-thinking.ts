import { readFileSync } from "node:fs";
for (const line of readFileSync("/workspaces/ecommerce-cuba/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { ChatDeepSeek } from "@langchain/deepseek";
import { z } from "zod";

async function main() {
  const model = new ChatDeepSeek({
    model: "deepseek-v4-flash",
    temperature: 0,
    maxTokens: 500,
    modelKwargs: { thinking: { type: "enabled" } },
  });
  const structured = model.withStructuredOutput(
    z.object({ sku: z.string(), price_usd: z.number() }),
    { name: "extract_price", method: "jsonMode" },
  );
  try {
    const r = await structured.invoke(
      "El producto XYZ-9 cuesta 42.50 USD. Devuelve JSON con claves sku y price_usd.",
    );
    console.log("THINKING+JSON_MODE OK:", JSON.stringify(r));
  } catch (e: any) {
    console.log("FAILED:", e?.status ?? "", String(e?.message ?? e).slice(0, 400));
  }
}
main();
