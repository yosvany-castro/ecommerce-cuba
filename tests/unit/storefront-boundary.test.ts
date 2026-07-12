// tests/unit/storefront-boundary.test.ts — la frontera visual/motor es una
// regla ejecutable, no una convención: src/components/tuki/** (la UI pública,
// T12) solo ve el contrato (@/storefront/contract), sus propios hermanos,
// libs de cliente y react/next; jamás @/sectors/** ni el DAL.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TUKI_DIR = "src/components/tuki";

const ALLOWED = [
  /^@\/storefront\/contract$/,
  /^@\/components\/tuki\//,
  /^@\/lib\/client\//,
  // libs PURAS compartidas cliente/server (peso y entrega): mismas fórmulas en
  // PDP/carrito que en el server — cobro = lo mostrado. Sin fetch/pg/sectors.
  /^@\/lib\/weight$/,
  /^@\/lib\/delivery$/,
  /^@\/lib\/img$/,
  /^@\/lib\/supabase\/client$/, // browser client de Supabase Auth (menú login/logout)
  /^\.\.?\//, // relativo, dentro del propio directorio tuki
  /^react$/,
  /^react\//,
  /^next\//,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function importsOf(src: string): string[] {
  return [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("frontera storefront (tuki)", () => {
  it("src/components/tuki/** solo importa contrato, sus propios módulos, libs de cliente y react/next", () => {
    const files = walk(TUKI_DIR).filter((p) => /\.(ts|tsx)$/.test(p));
    expect(files.length).toBeGreaterThan(0); // si el dir queda vacío, el test miente por vacuidad

    const offenders = files.flatMap((p) => {
      const bad = importsOf(readFileSync(p, "utf8")).filter(
        (spec) => !ALLOWED.some((re) => re.test(spec)),
      );
      return bad.map((spec) => `${p} -> ${spec}`);
    });
    expect(offenders).toEqual([]);
  });
});
