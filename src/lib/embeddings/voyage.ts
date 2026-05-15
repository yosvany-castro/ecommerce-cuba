/**
 * Thin wrapper over the Voyage AI API (fetch-based).
 *
 * We pin: model = voyage-4, output_dimension = 1024, output_dtype = float, normalize to unit L2.
 * voyage-4 returns vectors in float space; we re-normalize defensively because
 * downstream pgvector queries assume unit-norm vectors (cosine distance ≡ 1 - dot).
 */

export const EMBEDDING_MODEL = "voyage-4";
export const EMBEDDING_DIM = 1024;

export type InputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

const API_URL = "https://api.voyageai.com/v1/embeddings";

function l2normalize(v: number[]): number[] {
  const sumSq = v.reduce((s, x) => s + x * x, 0);
  const n = Math.sqrt(sumSq);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

export async function embed(
  texts: string[],
  opts: { inputType: InputType },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: opts.inputType,
      output_dimension: EMBEDDING_DIM,
      output_dtype: "float",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as VoyageResponse;
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => l2normalize(d.embedding));
}
