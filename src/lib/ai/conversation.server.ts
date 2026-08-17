import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toEmployeeContext, type EmployeeContext, type EmployeeRow } from "@/lib/hr/db.server";
import type {
  AssistantTurn,
  Slots,
  TraceTurn,
  UserTurn,
} from "@/lib/ai/agent-types";
import { emptySlots } from "@/lib/ai/agent-types";
import { SIMILARITY_THRESHOLD } from "@/lib/hr/retrieval";

/**
 * Turn lifecycle persistence. Server-only.
 *
 * Conversation memory (conversations, messages, session_slots) is written with the
 * caller's own client so RLS proves ownership. Audit rows (turn_traces, agent_steps,
 * retrieval_logs, tool_calls) are HR-Ops-read-only, so they are written with the
 * service-role client.
 */

export type Caller = {
  /** Acts as the signed-in employee — RLS applies. */
  user: SupabaseClient;
  /** Service role, for audit rows and HR writes. */
  admin: SupabaseClient;
  employee: EmployeeContext;
};

export function userClient(token: string): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

/** Verifies the bearer token and resolves the employee row it maps to. */
export async function resolveCaller(request: Request): Promise<Caller | null> {
  const token = bearerFrom(request);
  if (!token) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return null;

  const { data } = await supabaseAdmin
    .from("employees")
    .select(
      "id, auth_user_id, employee_code, full_name, employment_type, date_of_joining, manager_name, geo, grade_band, is_hr_ops",
    )
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (!data) return null;

  return {
    user: userClient(token),
    admin: supabaseAdmin,
    employee: toEmployeeContext(data as EmployeeRow),
  };
}

/* ------------------------------------------------------- conversation memory */

export type LoadedConversation = {
  id: string;
  turn_index: number;
  slots: Slots;
  messages: (UserTurn | AssistantTurn)[];
};

const DEFAULT_TITLE = "HR assistant session";

/** Returns the employee's active conversation, creating one on first use. */
export async function openConversation(caller: Caller): Promise<LoadedConversation> {
  const { data: existing } = await caller.user
    .from("conversations")
    .select("id, turn_count")
    .eq("employee_id", caller.employee.id)
    .eq("outcome", "ACTIVE")
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existing?.id as string | undefined;
  let turn_index = Number(existing?.turn_count ?? 0);

  if (!conversationId) {
    const { data, error } = await caller.user
      .from("conversations")
      .insert({ employee_id: caller.employee.id, title: DEFAULT_TITLE, outcome: "ACTIVE" })
      .select("id")
      .single();
    if (error) throw new Error(`conversation insert failed: ${error.message}`);
    conversationId = data.id as string;
    turn_index = 0;
    await caller.user
      .from("session_slots")
      .insert({ conversation_id: conversationId, slots: emptySlots, probe_count: 0 });
  }

  const [slotRow, messageRows, feedbackRows] = await Promise.all([
    caller.user
      .from("session_slots")
      .select("slots, probe_count, pending_confirmation, current_intent")
      .eq("conversation_id", conversationId)
      .maybeSingle(),
    caller.user
      .from("messages")
      .select("id, role, content, chips, clause_refs, verdict, pending, turn_index")
      .eq("conversation_id", conversationId)
      .order("turn_index", { ascending: true })
      .order("created_at", { ascending: true }),
    caller.user
      .from("feedback")
      .select("turn_index, rating")
      .eq("conversation_id", conversationId),
  ]);

  const ratings = new Map<number, "up" | "down">(
    ((feedbackRows.data ?? []) as { turn_index: number; rating: "up" | "down" }[]).map((r) => [
      Number(r.turn_index),
      r.rating,
    ]),
  );

  const stored = (slotRow.data?.slots ?? {}) as Partial<Slots>;
  const slots: Slots = {
    ...emptySlots,
    ...stored,
    probes: Number(slotRow.data?.probe_count ?? stored.probes ?? 0),
  };

  const messages = ((messageRows.data ?? []) as {
    id: string;
    role: "user" | "assistant";
    content: string;
    chips: string[] | null;
    clause_refs: { clause_id: string; text: string }[] | null;
    verdict: AssistantTurn["verdict"];
    pending: AssistantTurn["pending"];
    turn_index: number;
  }[]).map((row) =>
    row.role === "user"
      ? ({ id: row.id, role: "user", text: row.content } satisfies UserTurn)
      : ({
          id: row.id,
          role: "assistant",
          text: row.content,
          chips: row.chips ?? [],
          citations: row.clause_refs ?? [],
          verdict: row.verdict,
          pending: row.pending ?? null,
          abstain: row.verdict === "UNKNOWN",
          turn_index: Number(row.turn_index),
          feedback: ratings.get(Number(row.turn_index)) ?? null,
        } satisfies AssistantTurn),
  );

  return { id: conversationId, turn_index, slots, messages };
}

export async function saveSlots(caller: Caller, conversationId: string, slots: Slots, intent: string | null) {
  await caller.user
    .from("session_slots")
    .upsert(
      {
        conversation_id: conversationId,
        slots,
        probe_count: slots.probes,
        current_intent: intent,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" },
    );
}

export async function appendMessage(
  caller: Caller,
  conversationId: string,
  turnIndex: number,
  message: UserTurn | AssistantTurn,
): Promise<string> {
  const payload =
    message.role === "user"
      ? { role: "user" as const, content: message.text }
      : {
          role: "assistant" as const,
          content: message.text,
          chips: message.chips,
          clause_refs: message.citations,
          verdict: message.verdict,
          pending: message.pending,
          card_type: message.pending ? "confirmation" : message.abstain ? "abstention" : null,
        };
  const { data, error } = await caller.user
    .from("messages")
    .insert({ conversation_id: conversationId, turn_index: turnIndex, ...payload })
    .select("id")
    .single();
  if (error) throw new Error(`message insert failed: ${error.message}`);
  return data.id as string;
}

/* ------------------------------------------------------------- observability */

/** Writes the full audit fan-out for one turn: trace + steps + retrieval + tool calls. */
export async function recordTrace(
  caller: Caller,
  conversationId: string,
  turnIndex: number,
  trace: TraceTurn,
) {
  const { data, error } = await caller.admin
    .from("turn_traces")
    .insert({
      conversation_id: conversationId,
      turn_index: turnIndex,
      user_input: trace.user_message,
      intent: trace.intent,
      verdict: trace.verdict,
      agents_called: trace.steps.map((s) => agentKey(s.agent)),
      path: trace.path,
      confirmation_token: trace.tool_calls.some((t) => t.risk === "MEDIUM" || t.risk === "HIGH"),
      total_latency_ms: Math.round(trace.totals.latency_ms),
      total_tokens: trace.totals.tokens,
      cost_optimized_usd: trace.totals.cost,
      cost_baseline_usd: trace.totals.baseline_cost,
    })
    .select("id")
    .single();
  if (error) {
    console.error("turn_traces insert failed", error.message);
    return;
  }
  const traceId = data.id as string;

  // Every audit write is checked: a silently rejected insert means /ops reports
  // a turn that never happened.
  const writes: { label: string; run: PromiseLike<{ error: { message: string } | null }> }[] = [];

  if (trace.steps.length > 0) {
    writes.push({
      label: "agent_steps",
      run: caller.admin.from("agent_steps").insert(
        trace.steps.map((step, index) => ({
          trace_id: traceId,
          step_index: index,
          agent: agentKey(step.agent),
          role: step.agent,
          model: step.model,
          input_summary: step.input_summary,
          output_summary: step.output_summary,
          tokens_in: step.tokens.input,
          tokens_out: step.tokens.output,
          latency_ms: Math.round(step.latency_ms),
          cost_usd: step.cost,
        })),
      ),
    });
  }

  // Always log the retrieval attempt for a policy turn, including the case where
  // retrieval itself failed — a policy turn with no log row looks like a turn that
  // never asked the corpus, which is exactly what /ops must not hide.
  if (trace.intent === "policy_qa" || trace.chunks.length > 0 || trace.retrieval) {
    writes.push({
      label: "retrieval_logs",
      run: caller.admin.from("retrieval_logs").insert({
        trace_id: traceId,
        query_text: trace.user_message,
        subjects: trace.chunks.map((c) => c.subject).filter(Boolean),
        threshold: SIMILARITY_THRESHOLD,
        chunks: trace.chunks,
        // Status is the turn's outcome, not just whether chunks scored well —
        // ops_coverage_gaps counts questions the policy failed to answer.
        status:
          trace.chunks.length === 0
            ? "RETRIEVAL_FAILED"
            : trace.verdict === "UNKNOWN" || trace.chunks.every((c) => !c.passed)
              ? "NOT_IN_POLICY"
              : "GROUNDED",
        mode: trace.retrieval?.mode ?? "keyword",
        model: trace.retrieval?.model ?? null,
        latency_ms: Math.round(trace.retrieval?.latency_ms ?? 0),
        max_similarity: trace.chunks[0]?.raw_score ?? trace.chunks[0]?.score ?? null,
      }),
    });
  }

  if (trace.tool_calls.length > 0) {
    writes.push({
      label: "tool_calls",
      run: caller.admin.from("tool_calls").insert(
        trace.tool_calls.map((call) => ({
          trace_id: traceId,
          tool_name: call.tool ?? "unknown",
          risk: call.risk,
          params: call.params,
          result: call.result ?? null,
          error_code: call.error_code,
          error_message: call.error_code ? call.result_summary : null,
          attempts: call.attempts,
        })),
      ),
    });
  }

  writes.push({
    label: "conversations",
    run: caller.user
      .from("conversations")
      .update({
        turn_count: turnIndex,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", conversationId),
  });

  const results = await Promise.all(writes.map((w) => w.run));
  results.forEach((result, index) => {
    if (result?.error) {
      console.error(`${writes[index]?.label} write failed`, result.error.message);
    }
  });
}

function agentKey(label: string): "agent_1" | "agent_2" | "agent_3" {
  if (label.startsWith("Agent 2")) return "agent_2";
  if (label.startsWith("Agent 3")) return "agent_3";
  return "agent_1";
}
