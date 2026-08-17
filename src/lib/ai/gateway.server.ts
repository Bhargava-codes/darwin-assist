/**
 * Lovable AI Gateway — Responses API client.
 * Server-only. Every call streams (reasoning models otherwise exceed request
 * timeouts) and is consumed server-side, since the app needs the whole turn.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export type ModelId = "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra" | "openai/gpt-5.6-luna";

/** Display-only pricing (USD per 1M tokens) used by the Trace tab. */
export const MODEL_PRICING: Record<ModelId, { in: number; out: number }> = {
  "openai/gpt-5.6-sol": { in: 1.25, out: 10 },
  "openai/gpt-5.6-terra": { in: 0.4, out: 3.2 },
  "openai/gpt-5.6-luna": { in: 0.05, out: 0.4 },
};

export type Usage = { input_tokens: number; output_tokens: number };

export type StructuredCall<T> = {
  data: T;
  usage: Usage;
  latency_ms: number;
  model: ModelId;
  run_id: string | undefined;
};

export class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function callStructured<T>(opts: {
  apiKey: string;
  model: ModelId;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  runId?: string | undefined;
  /**
   * Reasoning budget. Schema-constrained agents (A2/A3) run at "low": they
   * classify against a fixed contract rather than reason open-endedly, and the
   * default budget costs seconds per call. Omit to leave the model's default.
   */
  effort?: "low" | "medium" | "high";
  /**
   * Raw JSON deltas as they arrive. The caller can surface a field mid-flight
   * (A1's reply) so the user reads the answer while the call is still open.
   */
  onDelta?: (delta: string) => void;
}): Promise<StructuredCall<T>> {
  const started = Date.now();
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": opts.apiKey,
      "X-Lovable-AIG-SDK": "fetch",
      ...(opts.runId ? { [RUN_ID_HEADER]: opts.runId } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      instructions: opts.instructions,
      input: opts.input,
      stream: true,
      store: false,
      ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
      text: {
        format: {
          type: "json_schema",
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      },
    }),
  });


  const runId = res.headers.get(RUN_ID_HEADER) ?? opts.runId;

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new GatewayError(res.status, detail || res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = event["type"];
      if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
        text += event["delta"];
        opts.onDelta?.(event["delta"]);
      }
      if (type === "response.completed" || type === "response.incomplete") {
        const response = event["response"] as
          | { output_text?: string; usage?: Record<string, number> }
          | undefined;
        if (!text && typeof response?.output_text === "string") text = response.output_text;
        if (response?.usage) {
          usage = {
            input_tokens: response.usage["input_tokens"] ?? 0,
            output_tokens: response.usage["output_tokens"] ?? 0,
          };
        }
      }
      if (type === "error") {
        throw new GatewayError(500, JSON.stringify(event));
      }
    }
  }

  const latency_ms = Date.now() - started;
  if (!text.trim()) throw new GatewayError(502, "Model returned no output.");

  return {
    data: JSON.parse(text) as T,
    usage,
    latency_ms,
    model: opts.model,
    run_id: runId ?? undefined,
  };
}

export function costOf(model: ModelId, usage: Usage) {
  const p = MODEL_PRICING[model];
  return (usage.input_tokens * p.in + usage.output_tokens * p.out) / 1_000_000;
}
