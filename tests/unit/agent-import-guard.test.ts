import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * El agente JAMÁS entra al request path — ni por accidente de import. Si
 * algún route/page importa g-agents (aunque sea un type), este test truena
 * antes de que el bundler meta el grafo LangChain (y su instanciación con
 * DEEPSEEK_API_KEY) en una lambda de la tienda.
 */

const APP_DIR = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("import guard (C2)", () => {
  test("src/app/** no importa src/sectors/g-agents/**", () => {
    const offenders = walk(APP_DIR).filter((f) =>
      /from\s+["'][^"']*sectors\/g-agents/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
