/**
 * Engine embeddings client. Server-only.
 * Model: openai/text-embedding-3-small at 1536 dims, matching
 * public.policy_chunks_small.embedding.
 */

const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

export const ENGINE_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const ENGINE_EMBEDDING_DIMS = 1536;

const MAX_BATCH = 64;

export type EngineEmbedResult = {
  vectors: number[][];
  input_tokens: number;
  latency_ms: number;
};

export class EngineEmbeddingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function embedSmall(apiKey: string, inputs: string[]): Promise<EngineEmbedResult> {
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
        model: ENGINE_EMBEDDING_MODEL,
        input: batch,
        dimensions: ENGINE_EMBEDDING_DIMS,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new EngineEmbeddingError(res.status, detail || res.statusText);
    }

    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    for (const row of [...json.data].sort((a, b) => a.index - b.index)) {
      vectors.push(row.embedding);
    }
    input_tokens += json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0;
  }

  return { vectors, input_tokens, latency_ms: Date.now() - started };
}
