// tests/unit/storefront-boundary.test.ts — la frontera visual/motor es una
// regla ejecutable, no una convención: src/components/** solo ve el contrato
// (@/storefront/contract) y libs cliente; jamás @/sectors/**.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Excepciones EXPLÍCITAS (si se añade otra, justificarla aquí igual):
// - SearchResults.tsx: llama hybridSearch directo; getSearchPage quedó diferido
//   en el spec del contrato (2026-06-20). Migrarlo = ampliar el DAL.
// - SearchTraceView/UserDebugView: vistas de ADMIN — inspeccionan el motor por
//   diseño (imports type-only de trace/debug); el contrato es de la tienda.
const ALLOWLIST = new Set([
  "src/components/SearchResults.tsx",
  "src/components/SearchTraceView.tsx",
  "src/components/UserDebugView.tsx",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("frontera storefront", () => {
  it("ningún componente visual importa @/sectors/** (salvo allowlist justificada)", () => {
    const files = walk("src/components").filter((p) => /\.(ts|tsx)$/.test(p));
    const offenders = files.filter(
      (p) => !ALLOWLIST.has(p) && /from ["']@\/sectors\//.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
