import type { SupabaseClient } from "@supabase/supabase-js";
import { embedSmall } from "./embed.server";

/**
 * Two retrieval paths, both deterministic in code — the LLM never chooses how
 * to search.
 *
 * policy_qa  → open question. Embeds the question, top-6 vector search.
 * rule_check → the orchestrator already knows which object is in play, so it
 *              fetches by tag. Zero embedding calls, zero embedding cost.
 */

export type RetrievedChunk = {
  chunk_id: string;
  section: string;
  heading: string;
  content: string;
  similarity: number | null;
};

export type RetrievalOutcome = {
  mode: "policy_qa" | "rule_check";
  chunks: RetrievedChunk[];
  embedding_tokens: number;
  latency_ms: number;
  model: string | null;
};

/**
 * Cosine similarity floor for policy_qa. Calibrated against the live corpus:
 * in-policy questions top out at 0.43-0.57, off-domain questions ("who is the
 * CEO of Tesla?", "pizza recipe") never exceed 0.21. 0.32 sits in the gap.
 * Enforced inside match_policy_small as well, so a caller cannot bypass it.
 */
export const POLICY_SIMILARITY_FLOOR = 0.32;

export async function semanticSearch(
  db: SupabaseClient,
  apiKey: string,
  question: string,
  matchCount = 6,
  matchThreshold = POLICY_SIMILARITY_FLOOR,
): Promise<RetrievalOutcome> {
  const started = Date.now();
  const embedded = await embedSmall(apiKey, [question]);
  const vector = embedded.vectors[0] ?? [];
  const { data, error } = await db.rpc("match_policy_small", {
    query_embedding: vector as unknown as string,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });
  if (error) throw new Error(`policy search failed: ${error.message}`);
  // Below the floor the RPC returns nothing, so the orchestrator's
  // NOT_IN_POLICY path fires instead of citing a weak match.
  const rows = (data ?? []) as {
    chunk_id: string;
    section: string;
    heading: string;
    content: string;
    similarity: number;
  }[];
  return {
    mode: "policy_qa",
    chunks: rows.map((r) => ({
      chunk_id: r.chunk_id,
      section: r.section,
      heading: r.heading,
      content: r.content,
      similarity: r.similarity,
    })),
    embedding_tokens: embedded.input_tokens,
    latency_ms: Date.now() - started,
    model: "openai/text-embedding-3-small",
  };
}

export async function tagFetch(
  db: SupabaseClient,
  tags: string[],
): Promise<RetrievalOutcome> {
  const started = Date.now();
  const wanted = Array.from(new Set([...tags.filter(Boolean), "general"]));
  const { data, error } = await db
    .from("policy_chunks_small")
    .select("chunk_id, section, heading, content")
    .overlaps("object_tags", wanted)
    .order("chunk_id", { ascending: true })
    .limit(6);
  if (error) throw new Error(`policy tag fetch failed: ${error.message}`);
  return {
    mode: "rule_check",
    chunks: (data ?? []).map((r) => ({ ...r, similarity: null })),
    embedding_tokens: 0,
    latency_ms: Date.now() - started,
    model: null,
  };
}
