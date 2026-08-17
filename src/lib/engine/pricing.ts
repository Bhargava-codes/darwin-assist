import { MODEL_PRICING, type ModelId } from "@/lib/ai/gateway.server";

/**
 * Real gateway rates, USD per 1M tokens. Trace cost is actual spend, not a
 * modelled figure — the comparison card measures agentic vs baseline on the
 * same price map.
 */

/** A1 — customer-facing orchestration surface. Needs the strongest reasoning. */
export const A1_MODEL: ModelId = "openai/gpt-5.6-sol";
/** A2/A3 — scoped, single-purpose sub-agents. Cheap and fast is enough. */
export const A2_MODEL: ModelId = "openai/gpt-5.6-luna";
export const A3_MODEL: ModelId = "openai/gpt-5.6-luna";
/** Baseline mode runs the whole turn through one big-model call. */
export const BASELINE_MODEL: ModelId = "openai/gpt-5.6-sol";

export const EMBEDDING_PRICE_PER_M = 0.02;

export function modelCost(model: ModelId, tokensIn: number, tokensOut: number): number {
  const price = MODEL_PRICING[model];
  return (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
}

export function embeddingCost(tokens: number): number {
  return (tokens * EMBEDDING_PRICE_PER_M) / 1_000_000;
}
