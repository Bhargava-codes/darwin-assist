import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineMessage, PendingAction, TraceEvent } from "./types";
import type { HrmsEmployee } from "./hrms.server";

/**
 * Engine session store. The demo runs on the service-role client (no employee
 * sign-in), so every read here is scoped explicitly by session or employee id.
 */

const EMPLOYEE_COLUMNS =
  "id, employee_code, full_name, employment_type, date_of_joining, manager_name, geo, grade_band, gender, work_location";

export async function loadEmployee(
  db: SupabaseClient,
  employeeCode: string,
): Promise<HrmsEmployee | null> {
  const { data } = await db
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .eq("employee_code", employeeCode)
    .maybeSingle();
  return (data as HrmsEmployee | null) ?? null;
}

export async function listEmployees(db: SupabaseClient): Promise<HrmsEmployee[]> {
  const { data } = await db
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .order("employee_code", { ascending: true });
  return (data ?? []) as HrmsEmployee[];
}

export type EngineSession = {
  id: string;
  employee_id: string;
  baseline_mode: boolean;
  pending: PendingAction | null;
  turn_count: number;
  messages: EngineMessage[];
};

export async function openSession(
  db: SupabaseClient,
  employee: HrmsEmployee,
  sessionId: string | null,
  baselineMode: boolean,
): Promise<EngineSession> {
  if (sessionId) {
    const { data } = await db
      .from("engine_sessions")
      .select("id, employee_id, baseline_mode, pending_action, turn_count")
      .eq("id", sessionId)
      .maybeSingle();
    if (data) {
      if (data.baseline_mode !== baselineMode) {
        await db.from("engine_sessions").update({ baseline_mode: baselineMode }).eq("id", data.id);
      }
      return {
        id: data.id as string,
        employee_id: data.employee_id as string,
        baseline_mode: baselineMode,
        pending: (data.pending_action as PendingAction | null) ?? null,
        turn_count: (data.turn_count as number) ?? 0,
        messages: await loadMessages(db, data.id as string),
      };
    }
  }

  const { data, error } = await db
    .from("engine_sessions")
    .insert({ employee_id: employee.id, baseline_mode: baselineMode })
    .select("id")
    .single();
  if (error) throw new Error(`could not open session: ${error.message}`);
  return {
    id: data.id as string,
    employee_id: employee.id,
    baseline_mode: baselineMode,
    pending: null,
    turn_count: 0,
    messages: [],
  };
}

export async function loadMessages(
  db: SupabaseClient,
  sessionId: string,
): Promise<EngineMessage[]> {
  const { data } = await db
    .from("engine_messages")
    .select("id, turn_index, role, content, chips, citations, receipt, verdict")
    .eq("session_id", sessionId)
    .order("turn_index", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    chips: (row.chips as string[]) ?? [],
    citations: (row.citations as EngineMessage["citations"]) ?? [],
    verdict: (row.verdict as EngineMessage["verdict"]) ?? null,
    receipt: (row.receipt as EngineMessage["receipt"]) ?? null,
    turn_index: (row.turn_index as number) ?? 0,
  }));
}

export async function saveMessage(
  db: SupabaseClient,
  sessionId: string,
  turnIndex: number,
  message: Omit<EngineMessage, "id" | "turn_index">,
): Promise<string> {
  const { data, error } = await db
    .from("engine_messages")
    .insert({
      session_id: sessionId,
      turn_index: turnIndex,
      role: message.role,
      content: message.content,
      chips: message.chips,
      citations: message.citations,
      receipt: message.receipt,
      verdict: message.verdict,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not save message: ${error.message}`);
  return data.id as string;
}

export async function saveTrace(
  db: SupabaseClient,
  sessionId: string,
  turnIndex: number,
  events: TraceEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const { error } = await db.from("trace_events").insert(
    events.map((e) => ({
      session_id: sessionId,
      turn_index: turnIndex,
      step_index: e.step_index,
      actor: e.actor,
      action: e.action,
      model: e.model,
      mode: e.mode,
      tokens_in: e.tokens_in,
      tokens_out: e.tokens_out,
      latency_ms: e.latency_ms,
      cost_usd: e.cost_usd,
      status: e.status,
      payload: e.payload ?? null,
      result: e.result ?? null,
    })),
  );
  if (error) throw new Error(`could not save trace: ${error.message}`);
}

export async function closeTurn(
  db: SupabaseClient,
  sessionId: string,
  turnIndex: number,
  pending: PendingAction | null,
  costUsd: number,
  previousTotal: number,
): Promise<void> {
  await db
    .from("engine_sessions")
    .update({
      turn_count: turnIndex,
      pending_action: pending,
      total_cost_usd: previousTotal + costUsd,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

/** Cost split by mode, so the comparison card reads real spend, not an estimate. */
export async function costSplit(
  db: SupabaseClient,
  sessionId: string,
): Promise<{ agentic: number; baseline: number; total: number }> {
  const { data } = await db
    .from("trace_events")
    .select("mode, cost_usd")
    .eq("session_id", sessionId);
  let agentic = 0;
  let baseline = 0;
  for (const row of data ?? []) {
    const cost = Number(row.cost_usd ?? 0);
    if (row.mode === "baseline") baseline += cost;
    else agentic += cost;
  }
  return { agentic, baseline, total: agentic + baseline };
}

export async function loadTurnTrace(
  db: SupabaseClient,
  sessionId: string,
  turnIndex: number,
): Promise<TraceEvent[]> {
  const { data } = await db
    .from("trace_events")
    .select(
      "step_index, actor, action, model, mode, tokens_in, tokens_out, latency_ms, cost_usd, status, payload, result",
    )
    .eq("session_id", sessionId)
    .eq("turn_index", turnIndex)
    .order("step_index", { ascending: true });
  return (data ?? []) as unknown as TraceEvent[];
}
