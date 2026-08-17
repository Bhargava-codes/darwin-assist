import type { SupabaseClient } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";
import { callStructured } from "@/lib/ai/gateway.server";
import { A1_MODEL, A2_MODEL, A3_MODEL, BASELINE_MODEL, embeddingCost, modelCost } from "./pricing";
import { buildA1Instructions, fillPlaceholders, type A1Context } from "./prompts/a1";
import { A2_SYSTEM, buildA2Input } from "./prompts/a2";
import {
  A3_SYSTEM,
  A3_ERROR_CODES,
  buildA3ReadInput,
  buildA3ExecuteInput,
  buildA3ReportInput,
  missingRequired,
  normaliseArgs,
  toolCatalogFor,
  type A3ErrorCode,
  type A3Report,
  type A3Selection,
} from "./prompts/a3";
import { fullPolicyText } from "./policy-chunks";
import { runTool, type HrmsEmployee } from "./hrms.server";
import { semanticSearch, tagFetch } from "./retrieval.server";
import {
  READ_TOOLS,
  WRITE_TOOLS,
  type Citation,
  type HrmsResult,
  type PendingAction,
  type ReadTool,
  type TraceEvent,
  type Verdict,
  type WriteTool,
} from "./types";


/**
 * The orchestrator. Pure code — it makes no LLM calls of its own and holds
 * every boundary the prompts assume:
 *
 * - A1 sees the transcript and this turn's sub-agent results. Never a raw clause
 *   corpus, never the HR database.
 * - A2 and A3 see a scoped payload and never the transcript.
 * - A3's tool list is filtered by mode: reads only, or exactly one write.
 * - A write executes only from a pending action the employee confirmed, and a
 *   pending action is accepted only when A1's verdict is FULL.
 * - Four sub-agent steps per turn, then A1 must reply.
 */

/**
 * A1 dispatches per turn. Three is measured, not guessed: of 70 recorded turns
 * exactly one needed a fourth, and the long tail is where P95 latency lives.
 * A turn that hits the cap must reply with what it has, and says so in the trace.
 */
const MAX_DISPATCHES = 3;

// Confirmed-write failures are worded by Agent 3 (§7.3), never here.



type Turn = { role: "user" | "assistant"; content: string };

export type EngineTurnOutput = {
  assistant: {
    content: string;
    chips: string[];
    citations: Citation[];
    verdict: Verdict | null;
    receipt: { tool: string; request_id: string; status: string } | null;
  };
  events: TraceEvent[];
  pending: PendingAction | null;
  cost_usd: number;
  latency_ms: number;
};

type A1Intent =
  | "policy_qa"
  | "eligibility_check"
  | "leave_apply"
  | "leave_read"
  | "leave_update"
  | "leave_cancel"
  | "wfh_apply"
  | "wfh_read"
  | "attendance_regularize"
  | "attendance_read"
  | "payslip_read"
  | "mixed"
  | "vague_hr"
  | "unmatched";

type A1Output = {
  action: "reply" | "ask_policy" | "ask_hrms" | "ask_both";
  reply: string | null;
  chips: string[];
  intent: A1Intent | null;
  verdict: Verdict | null;
  offramp: "9.1" | "9.2" | "9.3" | null;
  policy_request: {
    mode: "policy_qa" | "rule_check";
    question: string;
    facts: string;
    args_json: string;
    object: string | null;
    leave_type: string | null;
  } | null;
  hrms_request: { intent: string; values: string } | null;
  pending_action: { tool: WriteTool; args_json: string; summary: string } | null;
};


/** Agent 2 v1 §10. */
type A2Output = {
  mode: "policy_qa" | "rule_check";
  verdict: Verdict | "BLOCKED" | "ESCALATE" | null;
  policy_text: string | null;
  clause: string | null;
  failing_clause: string | null;
  eligible_types: string[];
  shortfall: { requested: string | null; available: string | null; dimension: string | null };
  alternatives: string[];
  violated: string[];
  missing: string[];
  account_state_checked: boolean;
  not_in_policy: boolean;
  chunk_ids: string[];
};


const VERDICT_ENUM = ["FULL", "PARTIAL", "NONE", "UNKNOWN", null];

const A2_VERDICT_ENUM = ["FULL", "PARTIAL", "NONE", "UNKNOWN", "BLOCKED", "ESCALATE", null];


const INTENT_ENUM = [
  "policy_qa",
  "eligibility_check",
  "leave_apply",
  "leave_read",
  "leave_update",
  "leave_cancel",
  "wfh_apply",
  "wfh_read",
  "attendance_regularize",
  "attendance_read",
  "payslip_read",
  "mixed",
  "vague_hr",
  "unmatched",
  null,
];

const A1_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "reply",
    "chips",
    "intent",
    "verdict",
    "offramp",
    "policy_request",
    "hrms_request",
    "pending_action",
  ],
  properties: {
    action: { type: "string", enum: ["reply", "ask_policy", "ask_hrms", "ask_both"] },
    reply: { type: ["string", "null"] },
    chips: { type: "array", items: { type: "string" } },
    intent: { type: ["string", "null"], enum: INTENT_ENUM },
    verdict: { type: ["string", "null"], enum: VERDICT_ENUM },
    offramp: { type: ["string", "null"], enum: ["9.1", "9.2", "9.3", null] },

    policy_request: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["mode", "question", "facts", "args_json", "object", "leave_type"],
      properties: {
        mode: { type: "string", enum: ["policy_qa", "rule_check"] },
        question: { type: "string" },
        facts: { type: "string" },
        args_json: {
          type: "string",
          description:
            'rule_check only. JSON object of resolved request facts: {"object","operation","start_date","end_date","working_days","leave_type","entry_type","reason"}. Absolute dates only, working_days already computed. Empty string on policy_qa.',
        },
        object: { type: ["string", "null"], enum: ["leave", "attendance", "wfh", "general", null] },
        leave_type: { type: ["string", "null"] },
      },

    },
    hrms_request: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["intent", "values"],
      properties: { intent: { type: "string" }, values: { type: "string" } },
    },
    pending_action: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["tool", "args_json", "summary"],
      properties: {
        tool: { type: "string", enum: [...WRITE_TOOLS] },
        args_json: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
} as const;

const A2_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "verdict",
    "policy_text",
    "clause",
    "failing_clause",
    "eligible_types",
    "shortfall",
    "alternatives",
    "violated",
    "missing",
    "account_state_checked",
    "not_in_policy",
    "chunk_ids",
  ],
  properties: {
    mode: { type: "string", enum: ["policy_qa", "rule_check"] },
    verdict: { type: ["string", "null"], enum: A2_VERDICT_ENUM },
    policy_text: {
      type: ["string", "null"],
      maxLength: 500,
      description:
        "The single clause sentence that answers the request. Verbatim, but no more than one sentence or 500 characters. Null when not_in_policy.",
    },
    clause: { type: ["string", "null"] },
    failing_clause: {
      type: ["string", "null"],
      maxLength: 500,
      description:
        "The decisive clause that caused a NONE/PARTIAL verdict. One sentence, verbatim, max 500 characters. Null for FULL or UNKNOWN.",
    },
    eligible_types: { type: "array", items: { type: "string" } },
    shortfall: {
      type: "object",
      additionalProperties: false,
      required: ["requested", "available", "dimension"],
      properties: {
        requested: { type: ["string", "null"] },
        available: { type: ["string", "null"] },
        dimension: { type: ["string", "null"] },
      },
    },
    alternatives: { type: "array", items: { type: "string" } },
    violated: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
    account_state_checked: { type: "boolean" },
    not_in_policy: { type: "boolean" },
    chunk_ids: { type: "array", items: { type: "string" } },
  },
} as const;


/** A3 phase 1 — one tool, its arguments, and any required field not supplied. */
function a3SelectSchema(allowed: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["tool", "args_json", "missing"],
    properties: {
      tool: { type: ["string", "null"], enum: [...allowed, null] },
      args_json: { type: "string" },
      missing: { type: "array", items: { type: "string" } },
    },
  };
}

/** A3 phase 2 — the §10 output object. */
const A3_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "status", "data_json", "error_code", "detail", "missing", "user_message", "attempts"],
  properties: {
    mode: { type: "string", enum: ["read", "execute"] },
    status: { type: "string", enum: ["ok", "error"] },
    data_json: { type: "string" },
    error_code: { type: ["string", "null"], enum: [...A3_ERROR_CODES, null] },
    detail: { type: ["string", "null"] },
    missing: { type: "array", items: { type: "string" } },
    user_message: { type: ["string", "null"] },
    attempts: { type: "integer" },
  },
} as const;

/**
 * §5.1 split. TRANSIENT is infrastructure — retryable once. Everything else is
 * the HR system understanding the request and saying no.
 */
function errorClass(code: string): "transient" | "definitive" {
  return code === "TRANSIENT" ? "transient" : "definitive";
}

/** A local §10 object, for the paths where no model call is warranted (§9.2). */
function a3LocalReport(
  mode: "read" | "execute",
  fields: { error_code: A3ErrorCode; detail?: string | null; missing?: string[]; user_message?: string | null },
): A3Report {
  return {
    mode,
    status: "error",
    data_json: "{}",
    error_code: fields.error_code,
    detail: fields.detail ?? null,
    missing: fields.missing ?? [],
    user_message: mode === "execute" ? (fields.user_message ?? null) : null,
    attempts: 1,
  };
}

/**
 * A read report built in code. The tool result is the system of record, so the
 * only work left is mapping a failure code — no model needed, and no paraphrase
 * step where a figure could drift.
 */
function localReadReport(run: ToolRun): A3Report {
  const attempts = Math.min(Math.max(run.attempts, 1), 2);
  if (run.result.ok) {
    return {
      mode: "read",
      status: "ok",
      data_json: JSON.stringify(run.result.data ?? {}),
      error_code: null,
      detail: null,
      missing: [],
      user_message: null,
      attempts,
    };
  }
  const transient = run.result.error_code === "TRANSIENT";
  return {
    mode: "read",
    status: "error",
    data_json: "{}",
    error_code: (transient && run.attempts >= 2
      ? "RETRIES_EXHAUSTED"
      : run.result.error_code) as A3ErrorCode,
    detail: run.result.message,
    missing: [],
    user_message: null,
    attempts,
  };
}

/**
 * Intent → read tool, first match wins. Ordered so the specific objects
 * (regularisation, WFH, payslip) are tested before the general ones. A miss
 * returns null and the A3 selector decides, exactly as before.
 */
const READ_ROUTES: { tool: ReadTool; test: RegExp }[] = [
  { tool: "get_regularization_usage", test: /regulari[sz]/ },
  { tool: "get_wfh_usage", test: /\bwfh\b|work from home|remote/ },
  { tool: "get_payslips", test: /payslip|pay slip|salary|payroll|ctc/ },
  { tool: "get_leave_balance", test: /balance|quota|entitlement|remaining|left|available/ },
  {
    tool: "get_leave_requests",
    test: /leave (request|application|history|status)|my leaves|applied|upcoming leave|pending/,
  },
  { tool: "get_attendance", test: /attendance|clock|punch|swipe|hours worked|late mark/ },
  {
    tool: "get_employee_profile",
    test: /profile|my details|manager|designation|grade|joining date|tenure|location/,
  },
];

const READ_INTENT_MAP: Partial<Record<A1Intent, ReadTool>> = {
  leave_read: "get_leave_balance",
  attendance_read: "get_attendance",
  wfh_read: "get_wfh_usage",
  payslip_read: "get_payslips",
};

function routeReadTool(
  a1Intent: A1Intent | null,
  intent: string,
  values: string,
): ReadTool | null {
  const mapped = a1Intent && READ_INTENT_MAP[a1Intent];
  if (mapped) return mapped;
  const text = `${intent} ${values ?? ""}`.toLowerCase();
  return READ_ROUTES.find((route) => route.test.test(text))?.tool ?? null;
}


function parseArgs(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function summarise(value: unknown, limit = 900): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function rowsFrom(args: Record<string, unknown>): { label: string; value: string }[] {
  const LABELS: Record<string, string> = {
    leave_type: "Leave type",
    start_date: "From",
    end_date: "To",
    date: "Date",
    reason: "Reason",
    clock_in: "Clock in",
    clock_out: "Clock out",
    request_id: "Request",
  };
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({ label: LABELS[k] ?? k, value: String(v) }));
}

export type EngineRunInput = {
  apiKey: string;
  db: SupabaseClient;
  employee: HrmsEmployee;
  sessionId: string;
  turnIndex: number;
  baselineMode: boolean;
  /**
   * Naive baseline prefetches every read tool into the prompt. Set false to
   * measure the baseline without that snapshot, so the cost comparison can be
   * reported both ways instead of leaning on a stacked baseline.
   */
  baselinePrefetch?: boolean;
  transcript: Turn[];
  userMessage: string;
  pending: PendingAction | null;
  /** Optional progress reporter — one short, honest line per phase. */
  onStage?: (stage: string) => void;
  /**
   * The reply as A1 writes it. Perceived wait, not real wait: the text lands on
   * screen while the call is still open. Always superseded by the final reply.
   */
  onReplyDelta?: (text: string) => void;

};

/**
 * A1 answers in JSON, so its reply arrives interleaved with other fields. Pull
 * the "reply" string out of the partial buffer and emit only what has grown —
 * never a half-written escape sequence.
 */
function replyDeltaReader(emit: (text: string) => void) {
  let buffer = "";
  let sent = "";
  return (delta: string) => {
    buffer += delta;
    const match = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(buffer);
    if (!match) return;
    let text: string;
    try {
      text = JSON.parse(`"${match[1]!.replace(/\\+$/, "")}"`) as string;
    } catch {
      return;
    }
    if (text.length <= sent.length) return;
    sent = text;
    emit(text);
  };
}

export async function runEngineTurn(input: EngineRunInput): Promise<EngineTurnOutput> {
  const started = Date.now();
  const events: TraceEvent[] = [];
  let step = 0;
  const today = format(new Date(), "yyyy-MM-dd");

  const stage = (line: string) => input.onStage?.(line);
  const record = (event: Omit<TraceEvent, "step_index">) => {
    events.push({ step_index: step++, ...event });
  };

  const totalCost = () => events.reduce((sum, e) => sum + e.cost_usd, 0);

  if (input.baselineMode) {
    stage("Reading your message");
    const out = await runBaseline(input, today, record);
    return {
      assistant: out,
      events,
      pending: null,
      cost_usd: totalCost(),
      latency_ms: Date.now() - started,
    };
  }

  const trimmed = input.userMessage.trim();

  // Cancel: no agent needed, the action is simply dropped.
  if (/^cancel$/i.test(trimmed) && input.pending) {
    record({
      actor: "orchestrator",
      action: "pending_action.discarded",
      model: null,
      mode: "agentic",
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      cost_usd: 0,
      status: "ok",
      payload: { tool: input.pending.tool },
      result: null,
    });
    return {
      assistant: {
        content: "Dropped it — nothing was submitted.",
        chips: ["Check my leave balance", "See my requests"],
        citations: [],
        verdict: null,
        receipt: null,
      },
      events,
      pending: null,
      cost_usd: 0,
      latency_ms: Date.now() - started,
    };
  }

  // Confirm: the commit gate. A3 executes the stored action; A1 is not re-invoked.
  if (/^confirm$/i.test(trimmed) && input.pending) {
    const out = await runConfirm(input, today, record);
    return {
      assistant: out.assistant,
      events,
      pending: out.pending,
      cost_usd: totalCost(),
      latency_ms: Date.now() - started,
    };
  }

  const context: A1Context = {
    today,
    weekday: format(parseISO(today), "EEEE"),
    employee_name: input.employee.full_name,
    employee_code: input.employee.employee_code,
    employment_type: input.employee.employment_type,
    tenure_months: Math.max(
      0,
      Math.floor(
        (parseISO(today).getTime() - parseISO(input.employee.date_of_joining).getTime()) /
          (1000 * 60 * 60 * 24 * 30.44),
      ),
    ),
    manager_name: input.employee.manager_name ?? "your manager",
    helpdesk: "HR Helpdesk",
    tone: "warm, concise",
  };
  const instructions = buildA1Instructions(context);

  const transcript = input.transcript
    .slice(-6)
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  const findings: string[] = [];
  const citations: Citation[] = [];
  /** Successful HRMS read payloads this turn — A2's account_state (§6.2). */
  const hrmsReads: unknown[] = [];
  let pendingOut: PendingAction | null = null;
  let assistant: EngineTurnOutput["assistant"] = {
    content: "I couldn't work that one out. Let me hand it to HR Helpdesk.",
    chips: [],
    citations: [],
    verdict: "UNKNOWN",
    receipt: null,
  };

  // Speculative, non-mutating: most leave turns need the balance, so start it
  // alongside A1's first call. Its trace events are buffered and only recorded
  // if the turn actually consumes it.
  const prefetchEvents: Omit<TraceEvent, "step_index">[] = [];
  let prefetchUsed = false;
  const balancePrefetch = executeWithRetry(input, today, "get_leave_balance", {}, (event) => {
    prefetchEvents.push(event);
  });
  balancePrefetch.catch(() => {});



  for (let dispatch = 0; dispatch <= MAX_DISPATCHES; dispatch++) {
    const forceReply = dispatch === MAX_DISPATCHES;
    if (forceReply) {
      record({
        actor: "orchestrator",
        action: "budget_exceeded",
        model: null,
        mode: "agentic",
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
        cost_usd: 0,
        status: "capped",
        payload: { max_dispatches: MAX_DISPATCHES },
        result: { effect: "A1 must reply with what it has, or route to HR Helpdesk." },
      });
    }

    const a1Input = [
      `CONVERSATION SO FAR\n${transcript || "(new conversation)"}`,
      `NEW MESSAGE FROM EMPLOYEE\n${trimmed}`,
      `WHAT YOU HAVE THIS TURN\n${findings.length ? findings.join("\n\n") : "(nothing yet)"}`,
      forceReply
        ? "STEP BUDGET SPENT. You must reply now with what you have. If it is not enough, route to HR Helpdesk."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    stage(dispatch === 0 ? "Reading your message" : "Putting your answer together");
    const a1 = await callStructured<A1Output>({
      apiKey: input.apiKey,
      model: A1_MODEL,
      instructions,
      input: a1Input,
      schemaName: "a1_turn",
      schema: A1_SCHEMA as unknown as Record<string, unknown>,
      ...(input.onReplyDelta
        ? {
            onDelta: replyDeltaReader((text) =>
              input.onReplyDelta?.(fillPlaceholders(text, context)),
            ),
          }
        : {}),
    });

    record({
      actor: "A1",
      action: a1.data.action,
      model: A1_MODEL,
      mode: "agentic",
      tokens_in: a1.usage.input_tokens,
      tokens_out: a1.usage.output_tokens,
      latency_ms: a1.latency_ms,
      cost_usd: modelCost(A1_MODEL, a1.usage.input_tokens, a1.usage.output_tokens),
      status: "ok",
      payload: { step: dispatch + 1, message: trimmed, findings: findings.length },
      result: a1.data,
    });

    /** Retrieval is startable on its own, so it can overlap an HRMS read. */
    const retrievalFor = (req: NonNullable<A1Output["policy_request"]>) =>
      req.mode === "rule_check"
        ? tagFetch(input.db, [req.object ?? "general", req.leave_type ?? ""].filter(Boolean))
        : semanticSearch(input.db, input.apiKey, req.question);

    const doPolicy = async (
      req: NonNullable<A1Output["policy_request"]>,
      retrieval?: ReturnType<typeof retrievalFor>,
    ) => {
      stage("Checking your HR policy");
      const outcome = await (retrieval ?? retrievalFor(req));


      record({
        actor: "rag",
        action: req.mode,
        model: outcome.model,
        mode: "agentic",
        tokens_in: outcome.embedding_tokens,
        tokens_out: 0,
        latency_ms: outcome.latency_ms,
        cost_usd: embeddingCost(outcome.embedding_tokens),
        status: outcome.chunks.length > 0 ? "ok" : "empty",
        payload: { question: req.question, tags: [req.object, req.leave_type] },
        result: outcome.chunks.map((c) => ({ chunk_id: c.chunk_id, similarity: c.similarity })),
      });

      // §6.2 — args, employee_context and account_state are assembled in code.
      // A2 must never receive an agent-authored fact.
      const args = req.mode === "rule_check" ? parseArgs(req.args_json) : undefined;
      const operation = String(args?.["operation"] ?? "").toUpperCase();
      const accountState =
        req.mode === "rule_check" && (operation === "CREATE" || operation === "UPDATE")
          ? hrmsReads.length > 0
            ? hrmsReads
            : undefined
          : undefined;

      stage("Reading the clause that applies to you");
      const a2 = await callStructured<A2Output>({
        apiKey: input.apiKey,
        model: A2_MODEL,
        instructions: A2_SYSTEM,
        input: buildA2Input({
          mode: req.mode,
          question: req.mode === "policy_qa" ? req.question : undefined,
          args: args && Object.keys(args).length > 0 ? args : undefined,
          employee_context: {
            doj: input.employee.date_of_joining,
            employment_type: input.employee.employment_type,
            gender: input.employee.gender,
            grade: input.employee.grade_band,
            location: input.employee.work_location,
          },
          account_state: accountState,
          chunks: outcome.chunks,
        }),
        schemaName: "a2_policy",
        schema: A2_SCHEMA as unknown as Record<string, unknown>,
        effort: "low",
      });


      const known = new Set(outcome.chunks.map((c) => c.chunk_id));
      const cited = a2.data.chunk_ids.filter((id) => known.has(id));
      // §10 — empty chunk_ids is valid only when nothing in policy covered this.
      const grounded = cited.length > 0 || a2.data.not_in_policy;
      const invalid = !grounded;

      record({
        actor: "A2",
        action: "policy_lookup",
        model: A2_MODEL,
        mode: "agentic",
        tokens_in: a2.usage.input_tokens,
        tokens_out: a2.usage.output_tokens,
        latency_ms: a2.latency_ms,
        cost_usd: modelCost(A2_MODEL, a2.usage.input_tokens, a2.usage.output_tokens),
        status: invalid ? "invalid" : "ok",
        payload: {
          mode: req.mode,
          chunks: outcome.chunks.map((c) => c.chunk_id),
          account_state_supplied: accountState !== undefined,
        },
        result: {
          mode: a2.data.mode,
          verdict: a2.data.verdict,
          clause: a2.data.clause,
          violated: a2.data.violated,
          missing: a2.data.missing,
          not_in_policy: a2.data.not_in_policy,
          account_state_checked: a2.data.account_state_checked,
          eligible_types: a2.data.eligible_types,
          alternatives: a2.data.alternatives,
          shortfall: a2.data.shortfall,
          chunk_ids: a2.data.chunk_ids,
        },
      });

      if (invalid) {
        findings.push(
          "[policy] The policy lookup returned a verdict with no clause behind it, so it was rejected. Treat this as UNKNOWN and route to HR Helpdesk.",
        );
        return;

      }

      for (const id of cited) {
        const chunk = outcome.chunks.find((c) => c.chunk_id === id);
        if (chunk && !citations.some((c) => c.chunk_id === id)) {
          citations.push({ chunk_id: id, heading: chunk.heading });
        }
      }

      const d = a2.data;
      // A leave rule_check with no type named blocks on type-specific fields
      // (relationship, childbirth date). The real gap is the type itself.
      const leaveObject = `${req.object ?? ""} ${String(args?.["object"] ?? "")}`.toLowerCase();
      const typeNamed = Boolean(req.leave_type || args?.["leave_type"]);
      const typeMissing =
        d.verdict === "BLOCKED" && leaveObject.includes("leave") && !typeNamed;
      const shortfall =
        d.shortfall && (d.shortfall.requested || d.shortfall.available || d.shortfall.dimension)
          ? `Shortfall: requested ${d.shortfall.requested ?? "—"}, available ${d.shortfall.available ?? "—"} (${d.shortfall.dimension ?? "unnamed dimension"}).`
          : "";

      findings.push(
        [
          `[policy] mode=${d.mode} verdict=${d.verdict ?? "n/a"} clauses=${cited.join(", ") || "none"}`,
          d.not_in_policy
            ? "Policy does not cover this. Do not quote a near-miss clause; say it isn't covered and route to HR Helpdesk."
            : "",
          d.policy_text ? `Policy says, verbatim (${d.clause ?? "clause unstated"}): "${d.policy_text}"` : "",
          d.failing_clause ? `Decisive clause, verbatim: "${d.failing_clause}"` : "",
          d.violated.length ? `Failed rules (show the employee all of them, once): ${d.violated.join(" | ")}` : "",
          shortfall,
          d.eligible_types.length ? `Eligible types named by policy: ${d.eligible_types.join(" | ")}` : "",
          d.alternatives.length ? `Alternatives named by policy: ${d.alternatives.join(" | ")}` : "",
          d.verdict === "BLOCKED" && d.missing.length
            ? typeMissing
              ? "Blocked only because the leave type is still unknown. Ask which leave type this is — read the employee's balances first so the options you offer are the ones they actually hold. Do not ask anything type-specific yet."
              : `Blocked — policy needs these before it can rule: ${d.missing.join(", ")}. Ask the employee for them; do not guess.`
            : "",
          d.verdict === "ESCALATE"
            ? "Policy routes this outside self-service. Hand over to HR Helpdesk instead of ruling on it."
            : "",
          d.account_state_checked
            ? "Balances and usage were checked against the HR system."
            : "Balances and usage were NOT checked. Do not state or imply a balance outcome.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    };

    const doHrms = async (
      req: NonNullable<A1Output["hrms_request"]>,
      a1Intent: A1Intent | null,
    ) => {
      stage("Looking up your record in the HR system");

      const readInput = buildA3ReadInput(
        { object: req.intent, query: req.intent, params: req.values || "(none)" },
        READ_TOOLS,
      );

      // Picking a read tool is pattern-matching, not judgment: route it in code
      // and pay for the A3 selector only when the intent doesn't match.
      let tool = routeReadTool(a1Intent, req.intent, req.values);
      let args: Record<string, unknown> = {};

      if (tool) {
        args = normaliseArgs(tool, parseArgs(req.values));
        record({
          actor: "orchestrator",
          action: "route_read_tool",
          model: null,
          mode: "agentic",
          tokens_in: 0,
          tokens_out: 0,
          latency_ms: 0,
          cost_usd: 0,
          status: "ok",
          payload: { intent: req.intent, values: req.values },
          result: { tool, args, routed_by: "code" },
        });
      } else {
        const a3 = await callStructured<A3Selection>({
          apiKey: input.apiKey,
          model: A3_MODEL,
          instructions: A3_SYSTEM,
          input: readInput,
          schemaName: "a3_read_select",
          schema: a3SelectSchema(READ_TOOLS) as unknown as Record<string, unknown>,
          effort: "low",
        });

        record({
          actor: "A3",
          action: "select_read_tool",
          model: A3_MODEL,
          mode: "agentic",
          tokens_in: a3.usage.input_tokens,
          tokens_out: a3.usage.output_tokens,
          latency_ms: a3.latency_ms,
          cost_usd: modelCost(A3_MODEL, a3.usage.input_tokens, a3.usage.output_tokens),
          status: a3.data.tool ? "ok" : "no_tool",
          payload: { mode: "read", intent: req.intent, allowed: READ_TOOLS, reason: "route_miss" },
          result: a3.data,
        });

        // §3.3 — a request no exposed tool answers is VALIDATION_FAILED, not a guess.
        if (!a3.data.tool || !READ_TOOLS.includes(a3.data.tool as ReadTool)) {
          const report = a3LocalReport("read", {
            error_code: "VALIDATION_FAILED",
            detail: `No exposed read tool answers "${req.intent}".`,
            missing: a3.data.missing,
          });
          record({
            actor: "A3",
            action: "report",
            model: null,
            mode: "agentic",
            tokens_in: 0,
            tokens_out: 0,
            latency_ms: 0,
            cost_usd: 0,
            status: report.error_code ?? "error",
            payload: { mode: "read", attempts: 0 },
            result: report,
          });
          findings.push(`[hrms] VALIDATION_FAILED — no read tool covers "${req.intent}".`);
          return;

        }

        tool = a3.data.tool as ReadTool;
        args = normaliseArgs(tool, parseArgs(a3.data.args_json));
      }

      // Reuse the speculative balance read when this is exactly that call.
      const reusable =
        tool === "get_leave_balance" && Object.keys(args).length === 0 && !prefetchUsed;
      let run: ToolRun;
      if (reusable) {
        run = await balancePrefetch;
        prefetchUsed = true;
        for (const event of prefetchEvents) {
          record({ ...event, payload: { ...(event.payload as object), prefetched: true } });
        }
      } else {
        run = await executeWithRetry(input, today, tool, args, record);
      }

      // The tool result is already structured; formatting it in code removes an
      // LLM paraphrase step where a figure could drift.
      const report = localReadReport(run);
      record({
        actor: "A3",
        action: "report",
        model: null,
        mode: "agentic",
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
        cost_usd: 0,
        status:
          report.status === "ok"
            ? run.result.ok && run.result.duplicate
              ? "duplicate"
              : "ok"
            : (report.error_code ?? "error"),
        payload: { mode: "read", tool, attempts: report.attempts, formatted_by: "code" },
        result: report,
      });

      if (run.result.ok) {
        hrmsReads.push({ tool, data: run.result.data });
      }
      // §8.1 — A1 builds its reply from A3's data, verbatim. No re-typed figures.
      findings.push(
        report.status === "ok"
          ? `[hrms:${tool}] ok, data verbatim: ${summarise(report.data_json)}`
          : `[hrms:${tool}] ${report.error_code}${report.detail ? `: ${report.detail}` : ""}${report.missing.length ? ` (missing: ${report.missing.join(", ")})` : ""}`,
      );

    };

    // Dispatch. A combined request runs the record read and the clause
    // retrieval together, then rules on policy with that read in hand — so the
    // ordering A2 depends on is preserved while one A1 round-trip disappears.
    if (!forceReply) {
      const policyReq = a1.data.policy_request;
      const hrmsReq = a1.data.hrms_request;
      const wantsPolicy =
        (a1.data.action === "ask_policy" || a1.data.action === "ask_both") && policyReq;
      const wantsHrms = (a1.data.action === "ask_hrms" || a1.data.action === "ask_both") && hrmsReq;

      if (wantsPolicy && wantsHrms) {
        const retrieval = retrievalFor(policyReq);
        retrieval.catch(() => {});
        await doHrms(hrmsReq, a1.data.intent);
        await doPolicy(policyReq, retrieval);
        continue;
      }
      if (wantsHrms) {
        await doHrms(hrmsReq, a1.data.intent);
        continue;
      }
      if (wantsPolicy) {
        await doPolicy(policyReq);
        continue;
      }
    }





    // reply
    const verdict = a1.data.verdict;
    if (verdict === "FULL" && a1.data.pending_action) {
      const args = normaliseArgs(a1.data.pending_action.tool, parseArgs(a1.data.pending_action.args_json));
      pendingOut = {
        tool: a1.data.pending_action.tool,
        args,
        summary: a1.data.pending_action.summary,
        rows: rowsFrom(args),
      };
      record({
        actor: "orchestrator",
        action: "pending_action.held",
        model: null,
        mode: "agentic",
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
        cost_usd: 0,
        status: "ok",
        payload: pendingOut,
        result: { awaiting: "Confirm" },
      });
    } else if (a1.data.pending_action) {
      record({
        actor: "orchestrator",
        action: "pending_action.rejected",
        model: null,
        mode: "agentic",
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
        cost_usd: 0,
        status: "blocked",
        payload: { verdict, tool: a1.data.pending_action.tool },
        result: { reason: "A write needs verdict FULL." },
      });
    }

    record({
      actor: "orchestrator",
      action: "a1.classification",
      model: null,
      mode: "agentic",
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      cost_usd: 0,
      status: "ok",
      payload: { intent: a1.data.intent, verdict, offramp: a1.data.offramp },
      result: { raw_reply: a1.data.reply },
    });

    const rawReply = a1.data.reply?.trim() || "I don't have enough to answer that yet.";
    const chipsRaw = pendingOut
      ? ["Confirm", "Change", "Cancel"]
      : a1.data.chips.slice(0, 4).map((c) => fillPlaceholders(c, context));

    assistant = {
      content: fillPlaceholders(rawReply, context),
      chips: chipsRaw,
      citations,
      verdict,
      receipt: null,
    };

    break;
  }

  if (!prefetchUsed) {
    record({
      actor: "orchestrator",
      action: "prefetch.discarded",
      model: null,
      mode: "agentic",
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      cost_usd: 0,
      status: "ok",
      payload: { tool: "get_leave_balance" },
      result: { reason: "This turn never needed the balance." },
    });
  }



  return {
    assistant,
    events,
    pending: pendingOut,
    cost_usd: totalCost(),
    latency_ms: Date.now() - started,
  };
}

type Recorder = (event: Omit<TraceEvent, "step_index">) => void;

type ToolRun = { result: HrmsResult; attempts: number };

async function executeWithRetry(
  input: EngineRunInput,
  today: string,
  tool: string,
  args: Record<string, unknown>,
  record: Recorder,
): Promise<ToolRun> {
  let attempt = 0;
  let result: HrmsResult = { ok: false, error_code: "TRANSIENT", message: "not attempted" };
  while (attempt < 2) {
    attempt++;
    const started = Date.now();
    result = await runTool(
      { db: input.db, employee: input.employee, sessionId: input.sessionId, today },
      tool as never,
      args,
    );
    record({
      actor: "hrms",
      action: tool,
      model: null,
      mode: input.baselineMode ? "baseline" : "agentic",
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: Date.now() - started,
      cost_usd: 0,
      status: result.ok ? (result.duplicate ? "duplicate" : "ok") : result.error_code,
      payload: { attempt, args },
      result: result.ok ? result.data : { error_code: result.error_code, message: result.message },
    });
    // §5.1 — only a transient failure is retried. A definitive rejection is a correct answer.
    if (result.ok || result.error_code !== "TRANSIENT") break;
  }
  return { result, attempts: attempt };
}

/**
 * A3 phase 2 — §7/§10. The orchestrator ran the tool, so A3 reports what came
 * back: data verbatim, one mapped code on failure, and in execute mode the one
 * sentence the employee reads.
 */
async function reportA3(args: {
  input: EngineRunInput;
  mode: "read" | "execute";
  stepInput: string;
  tool: string;
  run: ToolRun;
  record: Recorder;
}): Promise<A3Report> {
  const { input, mode, run, tool } = args;
  const transient = !run.result.ok && run.result.error_code === "TRANSIENT";

  const outcome = run.result.ok
    ? {
        status: "ok" as const,
        duplicate: run.result.duplicate === true,
        result_json: JSON.stringify(run.result.data ?? {}),
      }
    : {
        status: "error" as const,
        class: errorClass(run.result.error_code),
        system_code: transient && run.attempts >= 2 ? "RETRIES_EXHAUSTED" : run.result.error_code,
        system_message: run.result.message,
      };

  const call = await callStructured<A3Report>({
    apiKey: input.apiKey,
    model: A3_MODEL,
    instructions: A3_SYSTEM,
    input: buildA3ReportInput({
      mode,
      sessionLanguage: "English",
      input: args.stepInput,
      tool,
      attempts: run.attempts,
      outcome,
    }),
    schemaName: "a3_report",
    schema: A3_REPORT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });


  // The tool result is the system of record; A3 may report it but not restate it.
  const report: A3Report = {
    ...call.data,
    mode,
    status: run.result.ok ? "ok" : "error",
    data_json: run.result.ok ? JSON.stringify(run.result.data ?? {}) : "{}",
    error_code: run.result.ok ? null : (call.data.error_code ?? "UNMAPPED"),
    detail: run.result.ok ? null : (call.data.detail ?? run.result.message),
    missing: call.data.missing ?? [],
    user_message: mode === "execute" ? (call.data.user_message?.trim() || null) : null,
    attempts: Math.min(Math.max(run.attempts, 1), 2),
  };

  args.record({
    actor: "A3",
    action: "report",
    model: A3_MODEL,
    mode: "agentic",
    tokens_in: call.usage.input_tokens,
    tokens_out: call.usage.output_tokens,
    latency_ms: call.latency_ms,
    cost_usd: modelCost(A3_MODEL, call.usage.input_tokens, call.usage.output_tokens),
    status: report.status === "ok" ? (outcome.status === "ok" && outcome.duplicate ? "duplicate" : "ok") : (report.error_code ?? "error"),
    payload: { mode, tool, attempts: report.attempts },
    result: report,
  });

  return report;
}

async function runConfirm(
  input: EngineRunInput,
  today: string,
  record: Recorder,
): Promise<{ assistant: EngineTurnOutput["assistant"]; pending: PendingAction | null }> {
  const held = input.pending!;
  const allowed = [held.tool] as const;
  input.onStage?.("Filing your request");

  const executeInput = buildA3ExecuteInput(
    { operation: held.tool, object: held.summary, args: held.args },
    allowed,
  );

  // §9.2 — a payload short of a required field never reaches the write tool.
  const missing = missingRequired(held.tool, held.args);
  if (missing.length) {
    const report = a3LocalReport("execute", {
      error_code: "VALIDATION_FAILED",
      detail: `Payload missing required field(s): ${missing.join(", ")}.`,
      missing,
      user_message: `The request did not go through because these details are missing: ${missing.join(", ")}.`,
    });
    record({
      actor: "A3",
      action: "report",
      model: null,
      mode: "agentic",
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      cost_usd: 0,
      status: "VALIDATION_FAILED",
      payload: { mode: "execute", tool: held.tool, attempts: 0 },
      result: report,
    });
    return {
      assistant: {
        content: report.user_message!,
        chips: ["Change", "Cancel"],
        citations: [],
        verdict: null,
        receipt: null,
      },
      pending: null,
    };
  }

  const a3 = await callStructured<A3Selection>({
    apiKey: input.apiKey,
    model: A3_MODEL,
    instructions: A3_SYSTEM,
    input: executeInput,
    schemaName: "a3_execute_select",
    schema: a3SelectSchema(allowed) as unknown as Record<string, unknown>,
    effort: "low",
  });


  record({
    actor: "A3",
    action: "select_write_tool",
    model: A3_MODEL,
    mode: "agentic",
    tokens_in: a3.usage.input_tokens,
    tokens_out: a3.usage.output_tokens,
    latency_ms: a3.latency_ms,
    cost_usd: modelCost(A3_MODEL, a3.usage.input_tokens, a3.usage.output_tokens),
    status: a3.data.tool === held.tool ? "ok" : "corrected",
    payload: { mode: "execute", allowed, confirmed: held },
    result: a3.data,
  });

  // The held action is the system of record; A3 may not widen or swap it.
  const run = await executeWithRetry(input, today, held.tool, held.args, record);

  input.onStage?.("Getting your receipt");
  const report = await reportA3({
    input,
    mode: "execute",
    stepInput: executeInput,
    tool: held.tool,
    run,
    record,
  });

  // §8.1 — A3's sentence is terminal; nothing rewrites it.
  const content = report.user_message ?? "";

  if (report.status !== "ok" || !run.result.ok) {
    const escalate = report.error_code === "RETRIES_EXHAUSTED" || report.error_code === "CAP_EXCEEDED";
    return {
      assistant: {
        content: content || `That request did not go through. ${report.detail ?? ""}`.trim(),
        chips: escalate ? ["Contact HR Helpdesk"] : ["Pick different dates", "See my requests"],
        citations: [],
        verdict: null,
        receipt: null,
      },
      pending: null,
    };
  }

  // §5.4 — the receipt is the proof; every returned field travels with it.
  const data = (run.result.data ?? {}) as Record<string, unknown>;
  const requestId = typeof data['request_id'] === "string" ? data['request_id'] : "—";
  const status = typeof data['status'] === "string" ? data['status'] : "PENDING";

  return {
    assistant: {
      content: content || `Recorded — request ${requestId}, status ${status}.`,
      chips: ["See my requests", "Check my leave balance"],
      citations: [],
      verdict: null,
      receipt: { tool: held.tool, request_id: requestId, status },
    },
    pending: null,
  };
}


const BASELINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "chips"],
  properties: {
    reply: { type: "string" },
    chips: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * Baseline: one call, the whole policy document inline and every HRMS read
 * pre-fetched, no routing and no confirmation gate. This is the thing the
 * agentic pipeline is measured against.
 */
async function runBaseline(
  input: EngineRunInput,
  today: string,
  record: Recorder,
): Promise<EngineTurnOutput["assistant"]> {
  const prefetch = input.baselinePrefetch !== false;
  const snapshot: Record<string, unknown> = {};
  if (prefetch) {
    for (const tool of READ_TOOLS) {
      const result = await runTool(
        { db: input.db, employee: input.employee, sessionId: input.sessionId, today },
        tool,
        {},
      );
      snapshot[tool] = result.ok ? result.data : { error: result.error_code };
    }
  }


  const transcript = input.transcript
    .slice(-10)
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  const call = await callStructured<{ reply: string; chips: string[] }>({
    apiKey: input.apiKey,
    model: BASELINE_MODEL,
    instructions:
      "You are an HR assistant. Answer the employee from the policy document and HR data below. Reply warmly and briefly, and cite the clause number for any figure you quote.",
    input: `TODAY: ${today}

POLICY DOCUMENT
${fullPolicyText()}

HR SYSTEM SNAPSHOT
${prefetch ? JSON.stringify(snapshot) : "(not provided)"}


CONVERSATION
${transcript || "(new conversation)"}

NEW MESSAGE
${input.userMessage}`,
    schemaName: "baseline_turn",
    schema: BASELINE_SCHEMA as unknown as Record<string, unknown>,
  });

  record({
    actor: "orchestrator",
    action: "baseline_one_shot",
    model: BASELINE_MODEL,
    mode: "baseline",
    tokens_in: call.usage.input_tokens,
    tokens_out: call.usage.output_tokens,
    latency_ms: call.latency_ms,
    cost_usd: modelCost(BASELINE_MODEL, call.usage.input_tokens, call.usage.output_tokens),
    status: "ok",
    payload: { policy_inlined: true, hrms_prefetched: prefetch ? READ_TOOLS.length : 0 },
    result: call.data,
  });

  return {
    content: call.data.reply,
    chips: call.data.chips.slice(0, 3),
    citations: [],
    verdict: null,
    receipt: null,
  };
}
