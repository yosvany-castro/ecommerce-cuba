import { describe, test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * ATAQUE 3 (Fase D) — el guard de C2 (agent-import-guard.test.ts) solo hace
 * grep de strings sobre src/app/**: NO sigue imports transitivos. Si un route
 * importara f-slate/X y X importara g-agents, el grep shallow lo dejaría pasar
 * y el grafo LangChain entraría a una lambda de la tienda. Este trazador
 * resuelve el cierre transitivo real desde cada archivo de src/app y falla si
 * ALGUNA cadena alcanza src/sectors/g-agents.
 */

const SRC = resolve(process.cwd(), "src");
const APP = join(SRC, "app");
const FORBIDDEN = join(SRC, "sectors", "g-agents");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function importSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    specs.push(m[1] ?? m[2] ?? m[3]);
  }
  return specs.filter(Boolean);
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

/** Resolve a local import to an absolute file inside src, or null for externals. */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules / bare specifier — not our graph
  for (const suf of CANDIDATE_SUFFIXES) {
    const cand = base + suf;
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

describe("import guard transitive (Fase D — ataque 3)", () => {
  test("ningún archivo de src/app alcanza src/sectors/g-agents por cadena de imports", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    // parentOf rastrea la cadena para un mensaje de error accionable
    const parentOf = new Map<string, string>();

    const stack = walk(APP);
    for (const f of stack) parentOf.set(f, "<src/app entrypoint>");

    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);

      if (file.startsWith(FORBIDDEN)) {
        // reconstruir cadena
        const chain: string[] = [file];
        let cur = file;
        while (parentOf.has(cur) && parentOf.get(cur) !== "<src/app entrypoint>") {
          cur = parentOf.get(cur)!;
          chain.push(cur);
        }
        offenders.push(chain.reverse().join("\n   -> "));
        continue;
      }

      for (const spec of importSpecifiers(file)) {
        const target = resolveLocal(file, spec);
        if (target && !seen.has(target)) {
          if (!parentOf.has(target)) parentOf.set(target, file);
          stack.push(target);
        }
      }
    }

    expect(offenders, `app reaches g-agents via:\n${offenders.join("\n\n")}`).toEqual([]);
  });
});
