#!/usr/bin/env tsx
/**
 * Scans tests/ for prohibited anti-patterns.
 * Exits non-zero if any are found. Run in pre-commit and CI.
 */
import { Project, SyntaxKind, Node } from "ts-morph";
import { glob } from "fs/promises";

const VIOLATIONS: { file: string; line: number; rule: string; snippet: string }[] = [];

function record(rule: string, node: Node, file: string) {
  VIOLATIONS.push({
    file,
    line: node.getStartLineNumber(),
    rule,
    snippet: node.getText().slice(0, 120),
  });
}

async function main() {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  const files: string[] = [];
  // Tightened glob: only *.test.ts, *.spec.ts, *.test.tsx, *.spec.tsx
  // Avoids matching helpers like setup.ts, db.ts, playwright.ts
  for await (const f of glob("tests/**/*.{test,spec}.{ts,tsx}")) files.push(f);
  if (files.length === 0) {
    console.log("[check-test-quality] No test files found yet.");
    return;
  }

  for (const filePath of files) {
    const sf = project.addSourceFileAtPath(filePath);
    sf.forEachDescendant((node) => {
      // Rule 7: .skip / .only / xit (only on test globals)
      if (Node.isPropertyAccessExpression(node)) {
        const name = node.getName();
        const obj = node.getExpression().getText();
        const TEST_GLOBALS = ["it", "test", "describe", "fit", "fdescribe", "suite", "context"];
        if (
          (["skip", "only"].includes(name) && TEST_GLOBALS.includes(obj)) ||
          /^(xit|xtest|xdescribe)\b/.test(obj)
        ) {
          record("R7-skipped-or-only", node, filePath);
        }
      }
      // Rule 1, 6: weak assertions
      if (Node.isCallExpression(node)) {
        const callText = node.getExpression().getText();
        if (callText === "expect") {
          const args = node.getArguments();
          if (args.length === 1) {
            let cursor: Node | undefined = node.getParentIfKind(SyntaxKind.PropertyAccessExpression);
            while (cursor && Node.isPropertyAccessExpression(cursor)) {
              cursor = cursor.getParent();
            }
            const chain = cursor?.getText() ?? "";
            if (
              /\.toBeDefined\(\)\s*$/.test(chain) ||
              /\.not\.toBeNull\(\)\s*$/.test(chain) ||
              /\.toEqual\(\s*expect\.anything\(\)\s*\)\s*$/.test(chain) ||
              /\.toEqual\(\s*expect\.any\(Object\)\s*\)\s*$/.test(chain)
            ) {
              record("R1-weak-assertion", node, filePath);
            }
          }
        }
        // Rule 3, 4: prohibited mocks
        if (callText === "vi.mock" || callText === "jest.mock") {
          const arg = node.getArguments()[0]?.getText() ?? "";
          const allowed = arg.includes("sectors/b-catalog/mock");
          // Allow "fake timers" via vi.useFakeTimers (different call shape)
          if (!allowed) {
            const banned = ["@/lib/db", "@/lib/llm", "@/lib/embeddings", "@/lib/auth"];
            if (banned.some((b) => arg.includes(b))) {
              record("R3-prohibited-mock", node, filePath);
            }
          }
        }
      }
    });
  }

  if (VIOLATIONS.length > 0) {
    console.error("\n[check-test-quality] Anti-pattern violations found:\n");
    for (const v of VIOLATIONS) {
      console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.snippet}`);
    }
    process.exit(1);
  }
  console.log(`[check-test-quality] OK — scanned ${files.length} files, 0 violations.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
