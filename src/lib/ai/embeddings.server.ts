/**
 * Lovable AI Gateway — embeddings client. Server-only.
 *
 * Model: openai/text-embedding-3-large, requested at 1536 dimensions
 * (Matryoshka truncation) so the vectors fit pgvector's ivfflat index cap.
 */

const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

export const EMBEDDING_MODEL = "openai/text-embedding-3-large";

/** Must match the vector(1536) column on public.policy_chunks. */
export const EMBEDDING_DIMS = 1536;

/** USD per 1M input tokens — display only, for the trace. */
export const EMBEDDING_PRICE_PER_M = 0.13;

/** OpenAI caps a batch at 300k tokens; the corpus is far smaller. */
const MAX_BATCH = 96;

export type EmbedResult = {
  vectors: number[][];
  input_tokens: number;
  latency_ms: number;
};

export class EmbeddingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function embed(apiKey: string, inputs: string[]): Promise<EmbedResult> {
  const started = Date.now();
  const vectors: number[][] = [];
  let input_tokens = 0;

  for (let i = 0; i < inputs.length; i += MAX_BATCH) {
    const batch = inputs.slice(i, i + MAX_BATCH);
    const res = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMS,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new EmbeddingError(res.status, detail || res.statusText);
    }

    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of ordered) vectors.push(row.embedding);
    input_tokens += json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0;
  }

  return { vectors, input_tokens, latency_ms: Date.now() - started };
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
