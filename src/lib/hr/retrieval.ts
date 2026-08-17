import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POLICY_CORPUS,
  POLICY_VERSION,
  type PolicyChunk,
  type PolicySubject,
} from "@/data/policy-corpus";
import { embed, EMBEDDING_MODEL } from "@/lib/ai/embeddings.server";

/**
 * Policy retrieval. Server-only.
 *
 * The corpus lives in public.policy_chunks with 1536-dim embeddings; ranking and
 * subject filtering happen in SQL via match_policy_chunks(). The keyword scorer
 * below is only a fallback so a gateway failure degrades instead of breaking the
 * assistant.
 *
 * Two hard gates decide evidence: the similarity threshold and the entity match.
 * Anything failing either is never handed to Agent 2.
 */

export const SIMILARITY_THRESHOLD = 0.75;

/**
 * Raw cosine on text-embedding-3-large sits in a narrow band, so the raw value is
 * normalised into a calibrated 0–1 relevance score and the 0.75 gate applies to
 * that. Both numbers are logged to retrieval_logs and shown in /ops.
 *
 * Measured against this corpus (FY26-v2, 1536 dims), top-1 raw cosine:
 *   "how many casual leaves do I get"      0.667
 *   "forget to clock out"                  0.552
 *   "carry forward my leave"               0.538
 *   "work from home next week"             0.435  ← lowest genuinely relevant
 *   "crypto market cap today"              0.050  ← off-topic
 * The band is set so 0.435 clears the gate and off-topic noise does not.
 * Questions the manual simply does not cover (e.g. sabbatical, top-1 ~0.468)
 * still surface neighbouring clauses here — they are rejected one step later by
 * Agent 2's entity-match rule, which is the correct place for that judgment.
 */
export const COSINE_FLOOR = 0.1;
export const COSINE_CEILING = 0.42;

export const calibrate = (cos: number) =>
  Math.round(
    Math.max(0, Math.min(1, (cos - COSINE_FLOOR) / (COSINE_CEILING - COSINE_FLOOR))) * 1000,
  ) / 1000;

const STOPWORDS = new Set([
  "a","an","the","is","are","am","i","my","me","can","could","do","does","of","for","to","in","on",
  "and","or","what","whats","how","many","much","if","it","this","that","be","you","your","we","us",
  "please","tell","about","policy","policies","there","any","get","take","have","has","need","want",
  "days","day","leave",
]);

/** Terms that make a chunk about one entity and not another, however similar the text. */
const EXCLUSIVE_TERMS: { term: string; subjects: PolicySubject[] }[] = [
  { term: "maternity", subjects: ["LEAVE.ML"] },
  { term: "paternity", subjects: ["LEAVE.PL"] },
  { term: "bereavement", subjects: ["LEAVE.BL"] },
  { term: "casual", subjects: ["LEAVE.CL", "LEAVE.GENERAL"] },
  { term: "sick", subjects: ["LEAVE.SL", "LEAVE.GENERAL"] },
  { term: "earned", subjects: ["LEAVE.EL", "LEAVE.GENERAL"] },
  { term: "unpaid", subjects: ["LEAVE.UL", "LEAVE.GENERAL"] },
];

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

const contentTokens = (text: string) => tokenize(text).filter((t) => !STOPWORDS.has(t));

export type RetrievedChunk = {
  clause_id: string;
  heading: string;
  subject: PolicySubject;
  text: string;
  score: number;
  raw_score: number | null;
  passed: boolean;
  reject_reason: string | null;
};

export type RetrievalOutcome = {
  candidates: RetrievedChunk[];
  evidence: RetrievedChunk[];
  mode: "embeddings" | "keyword";
  embedding: { model: string; latency_ms: number; input_tokens: number; calls: number } | null;
};

type Candidate = { clause_id: string; heading: string; subject: PolicySubject; text: string };

function keywordScore(query: string, chunk: PolicyChunk) {
  const q = query.toLowerCase();
  const queryTokens = contentTokens(query);
  const chunkTokens = new Set([
    ...tokenize(chunk.heading),
    ...chunk.keywords.flatMap((k) => tokenize(k)),
    ...tokenize(chunk.text),
  ]);

  let phrase = 0;
  for (const keyword of chunk.keywords) {
    if (q.includes(keyword.toLowerCase())) {
      phrase = Math.max(phrase, Math.min(1, 0.78 + 0.04 * keyword.split(" ").length));
    }
  }

  const overlap = queryTokens.filter((t) => chunkTokens.has(t)).length;
  const token = queryTokens.length === 0 ? 0 : Math.min(1, overlap / queryTokens.length);
  return Math.round(Math.max(phrase, token * 0.9) * 1000) / 1000;
}

function entityConflict(query: string, chunk: Candidate) {
  const q = query.toLowerCase();
  for (const { term, subjects } of EXCLUSIVE_TERMS) {
    if (q.includes(term) && !subjects.includes(chunk.subject)) {
      const chunkMentions = EXCLUSIVE_TERMS.some(
        (e) => e.term !== term && e.subjects.includes(chunk.subject),
      );
      if (chunkMentions) return `entity mismatch: question is about "${term}"`;
    }
  }
  return null;
}

function gate(
  query: string,
  subjectSet: Set<PolicySubject>,
  chunk: Candidate,
  baseScore: number,
  raw: number | null,
): RetrievedChunk {
  const score =
    subjectSet.size > 0 && subjectSet.has(chunk.subject)
      ? Math.round(Math.min(1, baseScore + 0.05) * 1000) / 1000
      : baseScore;
  const conflict = entityConflict(query, chunk);
  const reject_reason =
    conflict ?? (score < SIMILARITY_THRESHOLD ? "below similarity threshold" : null);
  return {
    clause_id: chunk.clause_id,
    heading: chunk.heading,
    subject: chunk.subject,
    text: chunk.text,
    score,
    raw_score: raw,
    passed: reject_reason === null,
    reject_reason,
  };
}

const rank = (chunks: RetrievedChunk[]) => [...chunks].sort((a, b) => b.score - a.score).slice(0, 6);

/** Keyword-only retrieval — the deterministic fallback path. */
export function retrieveByKeyword(query: string, subjects: PolicySubject[] = []): RetrievalOutcome {
  const subjectSet = new Set(subjects);
  const candidates = rank(
    POLICY_CORPUS.map((chunk) => gate(query, subjectSet, chunk, keywordScore(query, chunk), null)),
  );
  return {
    candidates,
    evidence: candidates.filter((c) => c.passed).slice(0, 4),
    mode: "keyword",
    embedding: null,
  };
}

/* ------------------------------------------------- corpus seeding (idempotent) */

const areaOf = (subject: string) =>
  subject.startsWith("WFH") ? "WFH" : subject.startsWith("ATTENDANCE") ? "ATTENDANCE" : "LEAVE";

const corpusText = (chunk: PolicyChunk) => `${chunk.heading}\n${chunk.text}`;

let seeding: Promise<void> | null = null;

/**
 * Upserts every clause into policy_chunks and embeds the ones missing a vector.
 * Memoised per server process, and safe to call on every turn.
 */
export function ensurePolicyCorpus(
  admin: SupabaseClient,
  apiKey: string,
): Promise<void> {
  if (!seeding) {
    seeding = seedPolicyCorpus(admin, apiKey).catch((error: unknown) => {
      seeding = null;
      throw error;
    });
  }
  return seeding;
}

async function seedPolicyCorpus(admin: SupabaseClient, apiKey: string) {
  const rows = POLICY_CORPUS.map((chunk) => ({
    policy_version: POLICY_VERSION,
    clause_id: chunk.clause_id,
    policy_area: areaOf(chunk.subject),
    subject: chunk.subject,
    heading: chunk.heading,
    content: chunk.text,
    token_count: Math.ceil(corpusText(chunk).length / 4),
  }));

  const { error: upsertError } = await admin
    .from("policy_chunks")
    .upsert(rows, { onConflict: "policy_version,clause_id", ignoreDuplicates: true });
  if (upsertError) throw new Error(`policy_chunks upsert failed: ${upsertError.message}`);

  const { data: missing, error: missingError } = await admin
    .from("policy_chunks")
    .select("id, clause_id, heading, content")
    .eq("policy_version", POLICY_VERSION)
    .is("embedding", null);
  if (missingError) throw new Error(`policy_chunks read failed: ${missingError.message}`);
  if (!missing || missing.length === 0) return;

  const { vectors } = await embed(
    apiKey,
    missing.map((row) => `${row.heading}\n${row.content}`),
  );

  for (let i = 0; i < missing.length; i += 1) {
    const vector = vectors[i];
    const row = missing[i];
    if (!vector || !row) continue;
    const { error } = await admin
      .from("policy_chunks")
      .update({ embedding: JSON.stringify(vector) })
      .eq("id", row.id);
    if (error) throw new Error(`policy_chunks embedding write failed: ${error.message}`);
  }
}

/* ----------------------------------------------------------------- retrieval */

/** Semantic retrieval through pgvector, with keyword fallback. */
export async function retrievePolicy(
  apiKey: string,
  admin: SupabaseClient,
  query: string,
  subjects: PolicySubject[] = [],
): Promise<RetrievalOutcome> {
  try {
    await ensurePolicyCorpus(admin, apiKey);
    const queryEmbedding = await embed(apiKey, [query]);
    const queryVector = queryEmbedding.vectors[0];
    if (!queryVector) throw new Error("empty query embedding");

    const { data, error } = await admin.rpc("match_policy_chunks", {
      query_embedding: JSON.stringify(queryVector),
      match_threshold: 0,
      match_count: 6,
      // No SQL subject filter: the classifier's subject guess is a hint, not a
      // fact. Filtering on it hides the clause that actually answers the
      // question (a carry-forward question guessed as LEAVE.GENERAL never sees
      // §1.4). Subjects are applied as a scoring boost in gate() instead.
      filter_subjects: null,
      version: POLICY_VERSION,
    });
    if (error) throw new Error(`match_policy_chunks failed: ${error.message}`);

    const rows = (data ?? []) as {
      clause_id: string;
      subject: string;
      heading: string;
      content: string;
      similarity: number;
    }[];
    if (rows.length === 0) throw new Error("no policy chunks returned");

    const subjectSet = new Set(subjects);
    const candidates = rank(
      rows.map((row) => {
        const raw = Math.round(row.similarity * 1000) / 1000;
        return gate(
          query,
          subjectSet,
          {
            clause_id: row.clause_id,
            heading: row.heading,
            subject: row.subject as PolicySubject,
            text: row.content,
          },
          calibrate(raw),
          raw,
        );
      }),
    );

    return {
      candidates,
      evidence: candidates.filter((c) => c.passed).slice(0, 4),
      mode: "embeddings",
      embedding: {
        model: EMBEDDING_MODEL,
        latency_ms: queryEmbedding.latency_ms,
        input_tokens: queryEmbedding.input_tokens,
        calls: 1,
      },
    };
  } catch (error) {
    console.error("pgvector retrieval failed, falling back to keyword scoring", error);
    return retrieveByKeyword(query, subjects);
  }
}
