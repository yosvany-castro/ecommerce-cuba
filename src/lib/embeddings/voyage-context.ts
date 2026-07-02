/**
 * Wrapper over Voyage's contextualized chunk embeddings (voyage-context-3).
 * Input: an array of documents, each an array of chunk strings.
 * Output: per document, an array of chunk vectors (number[][][]), L2-normalized.
 * Docs: https://docs.voyageai.com/docs/contextualized-chunk-embeddings
 */
const API_URL = "https://api.voyageai.com/v1/contextualizedembeddings";
const MODEL = "voyage-context-3";
const DIM = 1024;

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n === 0 ? v.slice() : v.map((x) => x / n);
}

export async function contextualizedEmbed(
  documents: string[][],
  opts: { inputType: "document" | "query" },
): Promise<number[][][]> {
  if (documents.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ inputs: documents, model: MODEL, input_type: opts.inputType, output_dimension: DIM, output_dtype: "float" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voyage context-3 API ${res.status}: ${text}`);
  }
  const json = await res.json();
  // The documented contextualized schema nests: data[doc].data[chunk].embedding,
  // each carrying an `index`. Parse defensively; if the shape differs, the CLI's
  // first-call probe will reveal it and this destructuring must be adjusted.
  const docs = (json as { data: { data: { embedding: number[]; index: number }[]; index: number }[] }).data;
  return docs
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((doc) => doc.data.slice().sort((a, b) => a.index - b.index).map((c) => l2normalize(c.embedding)));
}
