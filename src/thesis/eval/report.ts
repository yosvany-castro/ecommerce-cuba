/**
 * Thesis eval report renderer.
 *
 * Pure helper: no I/O, no DB, no randomness.
 * Takes the aggregated `EvalResult[]` from `evaluateRanker` and renders a
 * deterministic markdown comparison table — one row per ranker, columns for
 * MRR, nDCG@k, and Recall@k at each requested cutoff.
 *
 * Designed to be embedded directly in the thesis appendix.
 */

import type { EvalResult } from "./harness";

/**
 * Render a markdown comparison table across rankers at the given cutoffs `ks`.
 *
 * Output format:
 *   # Thesis F0 Baseline Eval
 *   Cases per ranker: N
 *   | Ranker | MRR | nDCG@5 | nDCG@10 | … | Recall@5 | Recall@10 | … |
 *   |--------|-----|--------|---------|---|----------|-----------|---|
 *   | …      | …   | …      | …       | … | …        | …         | … |
 *
 * All metric values are printed to 3 decimal places.
 * `ks` must be the same list passed to `evaluateRanker`.
 */
export function renderReport(results: EvalResult[], ks: number[]): string {
  const n = results.length > 0 ? results[0].n : 0;

  // Build header columns
  const ndcgHeaders = ks.map((k) => `nDCG@${k}`);
  const recallHeaders = ks.map((k) => `Recall@${k}`);
  const headers = ["Ranker", "MRR", ...ndcgHeaders, ...recallHeaders];

  // Separator row: each cell is dashes matching the header width
  const sep = headers.map((h) => "-".repeat(h.length));

  const fmt = (v: number) => v.toFixed(3);

  const rows: string[][] = results.map((r) => {
    const ndcgCells = ks.map((k) => fmt(r.ndcg[k] ?? 0));
    const recallCells = ks.map((k) => fmt(r.recall[k] ?? 0));
    return [r.ranker, fmt(r.mrr), ...ndcgCells, ...recallCells];
  });

  const toRow = (cells: string[]) => `| ${cells.join(" | ")} |`;

  const lines: string[] = [
    "# Thesis F0 Baseline Eval",
    "",
    `Cases per ranker: ${n}`,
    "",
    toRow(headers),
    toRow(sep),
    ...rows.map(toRow),
    "",
  ];

  return lines.join("\n");
}
