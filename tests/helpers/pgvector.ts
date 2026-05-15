/**
 * Parses the text representation of a pgvector value, e.g. '[0.1,-0.2,...]'.
 * Returns null for null inputs.
 */
export function parsePgVector(input: unknown): number[] | null {
  if (input === null || input === undefined) return null;
  if (Array.isArray(input)) return input as number[];
  if (typeof input === "string") {
    return JSON.parse(input);
  }
  throw new Error(`Unexpected pgvector value type: ${typeof input}`);
}
