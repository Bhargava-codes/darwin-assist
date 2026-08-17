import type { SupabaseClient } from "@supabase/supabase-js";
import type { PolicySubject } from "@/data/policy-corpus";
import { retrievePolicy, SIMILARITY_THRESHOLD, type RetrievalOutcome } from "@/lib/hr/retrieval";
import { breakdown, pretty, weekendSentence } from "@/lib/hr/dates";
import { runTool, TOOL_RISK, type ToolCallRecord, type ToolName, type ToolParams } from "@/lib/hr/tools";
import { applyToolWrite, MUTATING_TOOLS, type EmployeeContext } from "@/lib/hr/db.server";
import { LEAVE_TYPE_LABEL, type HrState, type LeaveType } from "@/lib/hr/types";

import { callStructured, costOf, type ModelId } from "./gateway.server";
import { AGENT1_BLOCK_A, agent1Context, agent1TurnState } from "./prompts/agent1";
import { AGENT2_SYSTEM } from "./prompts/agent2";
import { AGENT3_SYSTEM } from "./prompts/agent3";
import type {
  AgentRequest,
  AgentResponse,
  AssistantTurn,
  Citation,
  Intent,
  PendingAction,
  Slots,
  TraceStep,
  TraceToolCall,
  Verdict,
} from "./agent-types";

const ORCHESTRATOR: ModelId = "openai/gpt-5.6-sol";
const WORKER: ModelId = "openai/gpt-5.6-luna";
const BASELINE: ModelId = "openai/gpt-5.6-sol";

const str = (desc: string) => ({ type: ["string", "null"], description: desc });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

/* ------------------------------------------------------------------ Agent 1 */

/** Blocks A + C + D of the Agent 1 prompt. Built per turn from the real employee row. */
const agent1Prime = (employee: EmployeeContext) => `${AGENT1_BLOCK_A}

${agent1Context({
  company_name: "Darwinbox",
  hr_support_channel: "the HR helpdesk",
  supported_languages: "English, Hindi, Hinglish",
  policy_version: "FY26-v2",
  tone_profile: "warm-professional, concise",
  employee_id: employee.employee_id,
  employee_name: employee.name.split(" ")[0] ?? employee.name,
  geo: employee.geo,
  employment_type: employee.employment_type,
  grade_band: employee.grade_band,
  manager_name: employee.manager_name,
  tenure_months: employee.tenure_months,
  today: new Date().toISOString().slice(0, 10),
})}`;


/**
 * The only subjects Agent 2 accepts. Agent 1 must classify into this list —
 * an invented subject (e.g. "LEAVE.CARRY_FORWARD") empties the pgvector subject
 * filter and then fails Agent 2's "subject must be one of the requested" rule,
 * turning a well-grounded question into a false abstention.
 */
const SUBJECT_ENUM = [
  "LEAVE.CL","LEAVE.SL","LEAVE.EL","LEAVE.ML","LEAVE.PL","LEAVE.BL","LEAVE.UL","LEAVE.GENERAL",
  "ATTENDANCE.WORKING_HOURS","ATTENDANCE.CLOCK_IN_OUT","ATTENDANCE.REGULARIZATION",
  "ATTENDANCE.LATE_ARRIVAL","ATTENDANCE.HALF_DAY_LOP",
  "WFH.ELIGIBILITY","WFH.ENTITLEMENT","WFH.CONDITIONS","WFH.EXTENDED","GENERAL.PROVISIONS",
];

const SUBJECT_SET = new Set(SUBJECT_ENUM);

const CLASSIFY_SCHEMA = obj({
  intent: {
    type: "string",
    enum: [
      "policy_qa",
      "leave_apply",
      "leave_read",
      "leave_update",
      "leave_cancel",
      "attendance_regularize",
      "attendance_read",
      "wfh_apply",
      "wfh_read",
      "wfh_cancel",
      "mixed",
      "unmatched",
    ],
  },
  policy_question: str("The policy question in the user's own words, or null."),
  subjects: {
    type: "array",
    items: { type: "string", enum: SUBJECT_ENUM },
    description:
      "Policy subjects, chosen only from the allowed list. Leave empty when unsure — never invent a subject.",
  },
  leave_type: str("One of CL, SL, EL, ML, PL, BL, UL if the user named a leave type."),
  start_date: str("ISO yyyy-mm-dd"),
  end_date: str("ISO yyyy-mm-dd"),
  date: str("ISO yyyy-mm-dd for a single-day request"),
  request_id: str("An existing request id if the user referenced one"),
  clock_in: str("HH:mm"),
  clock_out: str("HH:mm"),
  reason: str("A stated reason"),
  is_read_only_interjection: {
    type: "boolean",
    description: "True if this is a read-only question asked in the middle of another flow.",
  },
  unsupported_topic: {
    type: "boolean",
    description:
      "True when the question is about an HR topic this manual has no subject for at all — sabbatical, gratuity, notice period, payroll, insurance, appraisal. False for anything about leave, attendance or work-from-home.",
  },
});

type ClassifyOut = {
  intent: Intent;
  policy_question: string | null;
  subjects: string[];
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  date: string | null;
  request_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  reason: string | null;
  is_read_only_interjection: boolean;
  unsupported_topic: boolean;
};

/* ------------------------------------------------------------------ Agent 2 */

/* Key order is fixed by the Agent 2 contract: status → policy → not_found. */
const AGENT2_SCHEMA = obj({
  status: { type: "string", enum: ["GROUNDED", "NOT_IN_POLICY"] },
  policy: {
    type: "array",
    items: obj({
      subject: { type: "string", enum: SUBJECT_ENUM },
      policy_area: { type: "string", enum: ["LEAVE", "ATTENDANCE", "WFH", "GENERAL"] },
      entitlement: str("Verbatim entitlement phrase, or null when the clause states none."),
      limits: {
        type: "array",
        items: obj({
          value: { type: "number" },
          unit: {
            type: "string",
            enum: ["days", "weeks", "months", "times", "occurrences", "working_days", "hours"],
          },
          basis: {
            type: "string",
            enum: [
              "consecutive",
              "per_calendar_year",
              "per_calendar_month",
              "eligibility_threshold",
              "filing_window",
              "trigger_threshold",
              "carry_forward",
            ],
          },
        }),
      },
      requires_reason: { type: ["boolean", "null"] },
      conditions: { type: "array", items: { type: "string" } },
      text_verbatim: { type: "string" },
      clause_id: { type: "string" },
    }),
  },
  not_found: { type: "array", items: { type: "string" } },
});

type Agent2Entry = {
  subject: string;
  policy_area: string;
  entitlement: string | null;
  limits: { value: number; unit: string; basis: string }[];
  requires_reason: boolean | null;
  conditions: string[];
  text_verbatim: string;
  clause_id: string;
};

type Agent2Out = {
  status: "GROUNDED" | "NOT_IN_POLICY";
  policy: Agent2Entry[];
  not_found: string[];
};

/* ------------------------------------------------------------------ Agent 3 */

/* status → calls → missing_parameters, one call per request. */
const AGENT3_SCHEMA = obj({
  status: {
    type: "string",
    enum: [
      "SUCCESS",
      "MISSING_PARAMETERS",
      "CONFIRMATION_REQUIRED",
      "BUSINESS_ERROR",
      "SYSTEM_ERROR",
    ],
  },
  calls: {
    type: "array",
    items: obj({
      tool: { type: "string" },
      risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      parameters_json: {
        type: "string",
        description: "JSON object string using only the selected tool's parameter names.",
      },
      error_code: str("null unless the tool itself reported an error"),
      error_message: str("null unless the tool itself reported an error"),
    }),
  },
  missing_parameters: { type: "array", items: { type: "string" } },
});

type Agent3Out = {
  status: string;
  calls: {
    tool: string;
    risk: string;
    parameters_json: string;
    error_code: string | null;
    error_message: string | null;
  }[];
  missing_parameters: string[];
};

/* ------------------------------------------------------------- Compose step */

const COMPOSE_SCHEMA = obj({ reply: { type: "string" } });

/* Eligibility constraints transcribed from the corpus clauses. Agent 2 returns
   verbatim policy text; the categorical/scalar judgement stays deterministic in
   code so a model can never widen an eligibility rule. */
type Constraint = {
  leave_type: string;
  max_consecutive_days: number;
  min_tenure_months: number;
  allowed_employment_types: string[];
  clause_id: string;
};

const POLICY_CONSTRAINTS: Constraint[] = [
  { leave_type: "CL", max_consecutive_days: 3, min_tenure_months: -1, allowed_employment_types: ["all"], clause_id: "1.2" },
  { leave_type: "SL", max_consecutive_days: -1, min_tenure_months: -1, allowed_employment_types: ["all"], clause_id: "1.3" },
  { leave_type: "EL", max_consecutive_days: -1, min_tenure_months: 3, allowed_employment_types: ["Full-time", "full-time"], clause_id: "1.4" },
];

function constraintFor(type: string): Constraint | undefined {
  return POLICY_CONSTRAINTS.find((k) => k.leave_type === type);
}

/* ------------------------------------------------------------------ Helpers */

const HEDGES = /\b(generally|typically|usually|as a rule)\b/gi;

function sanitize(text: string) {
  return text
    .replace(HEDGES, "")
    .replace(/\s{2,}/g, " ")
    .replace(/!+/g, ".")
    .replace(/^(great question[.,]?\s*)/i, "")
    .trim();
}

function toolSummary(record: ToolCallRecord): TraceToolCall {
  return {
    tool: record.tool,
    risk: record.risk,
    params: record.params,
    attempts: record.attempts,
    error_code: record.outcome.error_code ?? null,
    result_summary: record.outcome.ok
      ? "ok"
      : (record.outcome.error_code ?? "awaiting confirmation"),
    result: record.outcome.result ?? record.outcome.message ?? null,
  };
}

function mkStep(
  agent: string,
  call: { model: ModelId; latency_ms: number; usage: { input_tokens: number; output_tokens: number } },
  input_summary: string,
  output_summary: string,
): TraceStep {
  return {
    agent,
    model: call.model,
    input_summary,
    output_summary,
    latency_ms: call.latency_ms,
    tokens: { input: call.usage.input_tokens, output: call.usage.output_tokens },
    cost: costOf(call.model, call.usage),
  };
}

const id = () => Math.random().toString(36).slice(2, 10);

type Judgement = {
  verdict: Verdict | null;
  facts: string[];
  eligible_types: LeaveType[];
  gap: string | null;
  failing_clause: Citation | null;
};

/* ------------------------------------------------------------------ The turn */

export type TurnContext = {
  /** Service-role client: the turn writes HR rows and audit rows the employee cannot write. */
  admin: SupabaseClient;
  employee: EmployeeContext;
};

export async function runTurn(
  apiKey: string,
  req: AgentRequest,
  ctx: TurnContext,
): Promise<AgentResponse> {
  const { admin, employee } = ctx;
  const AGENT1_PRIME = agent1Prime(employee);
  const steps: TraceStep[] = [];
  const tool_calls: TraceToolCall[] = [];
  const rbox: { out: RetrievalOutcome | null } = { out: null };
  let state = req.state;

  /** Mirrors a successful write tool onto real rows. */
  const persist = async (tool: ToolName, params: ToolParams, before: HrState) => {
    if (!MUTATING_TOOLS.includes(tool)) return;
    await applyToolWrite(admin, employee.id, tool, params, before);
  };

  let slots: Slots = { ...req.slots };
  let citations: Citation[] = [];
  let verdict: Verdict | null = null;
  let pending: PendingAction | null = null;
  let chips: string[] = [];
  let abstain = false;
  let path = "Agent 1";
  let intent: Intent | null = null;

  /* ---- Commit path: a tapped Confirm executes the held write directly. ---- */
  if (req.confirm) {
    const before = state;
    const record = runTool(req.confirm.tool, req.confirm.params, state, {
      confirmation_token: true,
    });
    tool_calls.push(toolSummary(record));
    path = "Agent 1 → Agent 3";
    if (record.outcome.ok) {
      await persist(req.confirm.tool, req.confirm.params, before);
      if (record.outcome.state) state = record.outcome.state;
      slots = { ...slots, leave_type: null, start_date: null, end_date: null, date: null, probes: 0 };

      const lines = req.confirm.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
      return finish({
        text: `Done. ${req.confirm.title} submitted.\n\n${lines}`,
        verdict: "FULL",
      });
    }
    return finish({
      text: record.outcome.message ?? "That could not be submitted.",
      verdict: record.outcome.error_code === "CAP_EXCEEDED" ? "NONE" : "PARTIAL",
      chips: ["Raise with HR"],
    });
  }

  /* ---- Step 1: Agent 1 classifies and extracts slots. ---- */
  const historyText = req.history
    .slice(-8)
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");

  const classify = await callStructured<ClassifyOut>({
    apiKey,
    model: ORCHESTRATOR,
    instructions: `${AGENT1_PRIME}

Task: classify the intent and extract slots. Today is ${new Date().toISOString().slice(0, 10)}. Resolve relative dates against today and assume the current or next occurrence of a stated day/month. Do not invent dates the user did not state.
Slots already held (do not re-ask these): ${JSON.stringify(slots)}
"unmatched" is a first-class outcome — never force a bad route to avoid it.`,
    input: `Conversation so far:\n${historyText || "(none)"}\n\nNew user message: ${req.message}`,
    schemaName: "classification",
    schema: CLASSIFY_SCHEMA,
  });
  steps.push(
    mkStep("Agent 1 · classify", classify, req.message, `intent=${classify.data.intent}`),
  );
  intent = classify.data.intent;
  const c = classify.data;

  slots = {
    ...slots,
    leave_type: c.leave_type ?? slots.leave_type,
    start_date: c.start_date ?? slots.start_date,
    end_date: c.end_date ?? slots.end_date,
    date: c.date ?? slots.date,
    request_id: c.request_id ?? slots.request_id,
    clock_in: c.clock_in ?? slots.clock_in,
    clock_out: c.clock_out ?? slots.clock_out,
    reason: c.reason ?? slots.reason,
  };

  // Drop anything outside the contract so retrieval and Agent 2 never see a
  // subject that cannot match a clause.
  const subjects = c.subjects.filter((s) => SUBJECT_SET.has(s)) as PolicySubject[];
  const isCreate =
    intent === "leave_apply" || intent === "wfh_apply" || intent === "attendance_regularize";
  const isUpdate = intent === "leave_update" || intent === "leave_cancel" || intent === "wfh_cancel";
  const isRead = intent === "leave_read" || intent === "attendance_read" || intent === "wfh_read";

  /* ---- Step 2: run Agent 2 and/or Agent 3. ---- */
  const pbox: { policy: Agent2Out | null } = { policy: null };
  const box: { record: ToolCallRecord | null } = { record: null };

  const needPolicy = intent === "policy_qa" || isCreate || intent === "mixed";
  const needTool = isRead || isCreate || isUpdate || intent === "mixed";

  const policyQuery = c.policy_question ?? req.message;

  const policyTask = async () => {
    if (!needPolicy) return;
    rbox.out = await retrievePolicy(apiKey, admin, policyQuery, subjects);
    const evidence = rbox.out.evidence;
    // Agent 2 can only resolve subjects it was asked about, so ask about both the
    // classifier's guess and the subjects the retrieved clauses actually belong to.
    const requested = Array.from(new Set([...subjects, ...evidence.map((e) => e.subject)]));
    // A topic the manual has no subject for must abstain even when neighbouring
    // clauses score well — otherwise the reply cites leave rules at a question
    // about, say, sabbaticals.
    if (evidence.length === 0 || c.unsupported_topic) {
      pbox.policy = { status: "NOT_IN_POLICY", policy: [], not_found: requested };
      return;
    }
    const call = await callStructured<Agent2Out>({
      apiKey,
      model: WORKER,
      instructions: AGENT2_SYSTEM,
      input: `user_question: ${policyQuery}\nsubjects: ${JSON.stringify(requested)}\n\nRetrieved chunks (all above the ${SIMILARITY_THRESHOLD} similarity threshold):\n${evidence
        .map((e) => `clause_id: ${e.clause_id}\nsubject: ${e.subject}\n${e.heading}\n${e.text}`)
        .join("\n\n")}`,
      schemaName: "policy_lookup",
      schema: AGENT2_SCHEMA,
    });
    pbox.policy = call.data;
    steps.push(
      mkStep(
        "Agent 2 · policy lookup",
        call,
        `${requested.join(", ") || "no subject hint"} · ${evidence.length} chunk(s)`,
        call.data.status === "NOT_IN_POLICY"
          ? "NOT_IN_POLICY"
          : `GROUNDED · ${call.data.policy.length} subject(s)`,
      ),
    );
  };

  const toolTask = async () => {
    if (!needTool) return;
    const call = await callStructured<Agent3Out>({
      apiKey,
      model: WORKER,
      instructions: AGENT3_SYSTEM,
      input: `intent: ${intent}\nslots: ${JSON.stringify(slots)}\nuser_message: ${req.message}\nknown request ids: ${state.leave_requests
        .map((r) => r.id)
        .join(", ")}\nknown wfh ids: ${state.wfh_requests.map((r) => r.id).join(", ")}`,
      schemaName: "tool_selection",
      schema: AGENT3_SCHEMA,
    });
    const selected = call.data.calls[0];
    steps.push(
      mkStep(
        "Agent 3 · tool executor",
        call,
        `intent=${intent}`,
        `${call.data.status} · ${selected?.tool ?? "no tool"}`,
      ),
    );
    if (!selected || call.data.status === "MISSING_PARAMETERS") return;

    const tool = selected.tool as ToolName;
    if (!(tool in TOOL_RISK)) return;
    let params: ToolParams = {};
    try {
      params = JSON.parse(selected.parameters_json || "{}") as ToolParams;
    } catch {
      params = {};
    }
    const before = state;
    const executed = runTool(tool, params, state, { dry_run: isCreate || isUpdate });
    box.record = executed;
    tool_calls.push(toolSummary(executed));
    if (executed.outcome.ok && executed.outcome.state && !isCreate && !isUpdate) {
      await persist(tool, params, before);
      state = executed.outcome.state;
    }
  };


  if (needPolicy && needTool) {
    path = "Agent 1 → [Agent 2 ‖ Agent 3] → Agent 1";
    await Promise.all([policyTask(), toolTask()]);
  } else if (needPolicy) {
    path = "Agent 1 → Agent 2 → Agent 1";
    await policyTask();
  } else if (needTool) {
    path = "Agent 1 → Agent 3 → Agent 1";
    await toolTask();
  }

  /* ---- Step 3: deterministic judgement. Agent 1 evaluates, never invents. -- */
  const judgement: Judgement = {
    verdict: null,
    facts: [],
    eligible_types: [],
    gap: null,
    failing_clause: null,
  };

  const findings: { subject: string; clause_id: string; text_verbatim: string }[] = (
    pbox.policy?.policy ?? []
  ).map((p) => ({ subject: p.subject, clause_id: p.clause_id, text_verbatim: p.text_verbatim }));
  citations = findings.map((f) => ({ clause_id: f.clause_id, text: f.text_verbatim }));

  if (intent === "policy_qa" || intent === "unmatched") {
    verdict = pbox.policy?.status === "GROUNDED" && findings.length > 0 ? "FULL" : "UNKNOWN";
    if (verdict === "UNKNOWN") {
      abstain = true;
      chips = ["Raise with HR"];
    }
  }

  let probe: string | null = null;

  if (intent === "leave_apply") {
    const dates = slots.start_date && slots.end_date
      ? breakdown(slots.start_date, slots.end_date)
      : slots.date
        ? breakdown(slots.date, slots.date)
        : null;

    if (!dates) {
      probe = "which dates";
      slots.probes += 1;
    } else {
      judgement.facts.push(`${dates.working_days} working day(s) between ${pretty(slots.start_date ?? slots.date!)} and ${pretty(slots.end_date ?? slots.date!)}`);
      const weekend = weekendSentence(dates);
      if (weekend) judgement.facts.push(weekend);

      const evaluate = (type: LeaveType) => {
        const cons = constraintFor(type);
        const bal = state.balances[type as "CL" | "SL" | "EL"];
        if (!cons) return { ok: false, categorical: true, reason: null, clause: null };
        const allowed =
          cons.allowed_employment_types.length === 0 ||
          cons.allowed_employment_types.includes("all") ||
          cons.allowed_employment_types.includes(employee.employment_type);
        if (!allowed || (cons.min_tenure_months > 0 && employee.tenure_months < cons.min_tenure_months))
          return {
            ok: false,
            categorical: true,
            reason: `not eligible for ${LEAVE_TYPE_LABEL[type]}`,
            clause: cons.clause_id,
          };
        if (cons.max_consecutive_days >= 0 && dates.working_days > cons.max_consecutive_days)
          return {
            ok: false,
            categorical: false,
            reason: `${LEAVE_TYPE_LABEL[type]} is capped at ${cons.max_consecutive_days} consecutive days`,
            clause: cons.clause_id,
          };
        if (bal && bal.available < dates.working_days)
          return {
            ok: false,
            categorical: false,
            reason: `${LEAVE_TYPE_LABEL[type]} has ${bal.available} day(s) available`,
            clause: cons.clause_id,
          };
        return { ok: true, categorical: false, reason: null, clause: cons.clause_id };
      };

      const candidates: LeaveType[] = ["CL", "SL", "EL"];
      judgement.eligible_types = candidates.filter((t) => evaluate(t).ok);

      if (!slots.leave_type) {
        probe = "which leave type";
        slots.probes += 1;
        chips = judgement.eligible_types.map((t) => `${LEAVE_TYPE_LABEL[t]} (${t})`);
        const excluded = candidates
          .filter((t) => !judgement.eligible_types.includes(t))
          .map((t) => evaluate(t).reason)
          .filter(Boolean) as string[];
        judgement.facts.push(...excluded);
      } else {
        const type = slots.leave_type as LeaveType;
        const result = evaluate(type);
        const cons = constraintFor(type);
        if (!cons) {
          verdict = "UNKNOWN";
          abstain = true;
          chips = ["Raise with HR"];
        } else if (result.ok) {
          verdict = "FULL";
          const bal = state.balances[type as "CL" | "SL" | "EL"];
          pending = {
            tool: "apply_leave",
            params: {
              leave_type: type,
              start_date: slots.start_date ?? slots.date!,
              end_date: slots.end_date ?? slots.date!,
              ...(slots.reason ? { reason: slots.reason } : {}),
            },
            title: `${LEAVE_TYPE_LABEL[type]} request`,
            rows: [
              { label: "Type", value: `${LEAVE_TYPE_LABEL[type]} (${type})` },
              {
                label: "Dates",
                value: `${pretty(slots.start_date ?? slots.date!)} – ${pretty(slots.end_date ?? slots.date!)}`,
              },
              { label: "Working days", value: `${dates.working_days}` },
              ...(bal
                ? [
                    {
                      label: "Balance after",
                      value: `${bal.available - dates.working_days} of ${bal.total}`,
                    },
                  ]
                : []),
            ],
          };
        } else if (result.categorical) {
          verdict = "NONE";
          judgement.gap = result.reason;
          chips = ["Raise with HR"];
          const clause = findings.find((f) => f.clause_id === result.clause);
          if (clause)
            judgement.failing_clause = { clause_id: clause.clause_id, text: clause.text_verbatim };
        } else {
          verdict = "PARTIAL";
          judgement.gap = result.reason;
          const alternates = judgement.eligible_types.filter((t) => t !== type);
          chips = alternates.map((t) => `${LEAVE_TYPE_LABEL[t]} (${t})`);
          const cap = cons.max_consecutive_days;
          if (cap >= 0 && cap > 0 && cap < dates.working_days)
            chips.push(`${cap} day(s) of ${LEAVE_TYPE_LABEL[type]}`);
          if (chips.length === 0) chips = ["Raise with HR"];
        }
      }
    }
  }

  if (intent === "wfh_apply") {
    if (!slots.date) {
      probe = "which date";
      slots.probes += 1;
    } else if (state.wfh_this_month.remaining <= 0) {
      verdict = "NONE";
      judgement.gap = `You have used ${state.wfh_this_month.used} of ${state.wfh_this_month.allowance} work-from-home days this calendar month.`;
      chips = ["Raise with HR"];
    } else {
      verdict = "FULL";
      pending = {
        tool: "apply_wfh",
        params: { date: slots.date, ...(slots.reason ? { reason: slots.reason } : {}) },
        title: "Work from home request",
        rows: [
          { label: "Date", value: pretty(slots.date) },
          {
            label: "WFH days left after",
            value: `${state.wfh_this_month.remaining - 1} of ${state.wfh_this_month.allowance}`,
          },
        ],
      };
    }
  }

  if (intent === "attendance_regularize") {
    const missing = (["date", "clock_in", "clock_out", "reason"] as const).filter((k) => !slots[k]);
    if (state.regularizations_this_month.remaining <= 0) {
      verdict = "NONE";
      judgement.gap = `You have used ${state.regularizations_this_month.used} of ${state.regularizations_this_month.allowance} regularizations this calendar month.`;
      chips = ["Raise with HR"];
    } else if (missing.length > 0) {
      probe = missing[0] === "date" ? "which date" : `the ${missing[0]!.replace("_", " ")}`;
      slots.probes += 1;
    } else {
      verdict = "FULL";
      pending = {
        tool: "regularize_attendance",
        params: {
          date: slots.date!,
          clock_in: slots.clock_in!,
          clock_out: slots.clock_out!,
          reason: slots.reason!,
        },
        title: "Attendance regularization",
        rows: [
          { label: "Date", value: pretty(slots.date!) },
          { label: "Corrected", value: `${slots.clock_in} – ${slots.clock_out}` },
          { label: "Reason", value: slots.reason! },
          {
            label: "Regularizations",
            value: `${state.regularizations_this_month.used + 1} of ${state.regularizations_this_month.allowance} used`,
          },
        ],
      };
    }
  }

  if (isUpdate) {
    const rec = box.record;
    if (!rec || !rec.tool) {
      probe = "which request";
      slots.probes += 1;
    } else if (rec.outcome.error_code) {
      verdict = rec.outcome.error_code === "NOT_FOUND" ? "UNKNOWN" : "NONE";
      judgement.gap = rec.outcome.message ?? null;
      chips = ["Raise with HR"];
    } else {
      verdict = "FULL";
      pending = {
        tool: rec.tool,
        params: rec.params,
        title: rec.tool === "cancel_leave" ? "Cancel leave request" : "Update request",
        rows: Object.entries(rec.params).map(([k, v]) => ({
          label: k.replace(/_/g, " "),
          value: String(v),
        })),
      };
    }
  }

  if (isRead && box.record) {
    const rec = box.record;
    if (rec.outcome.error_code) {
      judgement.gap = rec.outcome.message ?? null;
    }
  }

  if (slots.probes > 3) {
    probe = null;
    abstain = true;
    verdict = "UNKNOWN";
    chips = ["Raise with HR"];
  }

  /* ---- Step 4: Agent 1 composes the reply from grounded material only. ---- */
  const material = {
    intent,
    verdict,
    probe_for: probe,
    computed_facts: judgement.facts,
    gap: judgement.gap,
    policy_findings: findings,
    policy_status: pbox.policy?.status ?? null,
    policy_not_found: pbox.policy?.not_found ?? [],
    tool_result: box.record ? { tool: box.record.tool, outcome: box.record.outcome } : null,
    offered_chips: chips,
    confirmation_card: pending,
    abstaining: abstain,
  };

  const compose = await callStructured<{ reply: string }>({
    apiKey,
    model: ORCHESTRATOR,
    instructions: `${AGENT1_PRIME}

Compose the reply from the grounded material below and nothing else.
- Deliver policy text and tool output unmodified. You may add at most one connective sentence, and it must contain no number, date or entitlement.
- If probe_for is set, ask exactly that one thing and nothing else. Do not list options in prose when chips are offered.
- If verdict is PARTIAL, state the gap first, then say alternatives are below. Never invent an alternative.
- If verdict is NONE, state the failing condition and that HR handles it. Do not offer workarounds.
- If abstaining is true, say plainly that the manual does not cover it and HR can answer. Do not hedge.
- If a confirmation card is present, do not repeat its rows in prose; say what will be submitted in one sentence.
- The UI already renders the greeting, so never emit the D17 opener or any greeting.
- 1 to 3 short sentences. Plain text only.`,
    input: `${agent1TurnState({
      current_intent: intent,
      slots,
      missing_slots: probe ? [probe] : [],
      pending_confirmation: pending ? pending.title : null,
      paused_intent: c.is_read_only_interjection ? intent : null,
      turn_count: slots.probes,
      last_tool_error: box.record?.outcome.error_code ?? null,
      conversation_history: historyText,
      agent_2_response: pbox.policy,
      agent_3_response: box.record
        ? { tool: box.record.tool, attempts: box.record.attempts, outcome: box.record.outcome }
        : null,
    })}

# JUDGED MATERIAL (already evaluated in code — do not re-judge, do not add to it)
${JSON.stringify(material)}

New user message: ${req.message}`,
    schemaName: "reply",
    schema: COMPOSE_SCHEMA,
  });
  steps.push(mkStep("Agent 1 · compose", compose, `verdict=${verdict ?? "n/a"}`, "reply"));

  return finish({ text: sanitize(compose.data.reply), verdict });

  /* --------------------------------------------------------------- assembly */
  function finish(out: { text: string; verdict: Verdict | null; chips?: string[] }): AgentResponse {
    const finalChips = out.chips ?? chips;
    const totals = steps.reduce(
      (acc, s) => ({
        latency_ms: acc.latency_ms + s.latency_ms,
        tokens: acc.tokens + s.tokens.input + s.tokens.output,
        cost: acc.cost + s.cost,
        baseline_cost:
          acc.baseline_cost +
          costOf(BASELINE, { input_tokens: s.tokens.input, output_tokens: s.tokens.output }),
      }),
      { latency_ms: 0, tokens: 0, cost: 0, baseline_cost: 0 },
    );

    const turn: AssistantTurn = {
      id: id(),
      role: "assistant",
      text: out.text,
      chips: finalChips,
      citations: citations.filter((cit) =>
        (rbox.out?.candidates ?? []).some(
          (ch) => ch.clause_id === cit.clause_id && ch.passed,
        ),
      ),
      verdict: out.verdict,
      pending,
      abstain,
    };

    return {
      turn,
      slots,
      state,
      trace: {
        turn: 0,
        user_message: req.confirm ? "[Confirm]" : req.message,
        intent,
        path,
        verdict: out.verdict,
        steps,
        chunks: (rbox.out?.candidates ?? []).map((ch) => ({
          clause_id: ch.clause_id,
          subject: ch.subject,
          heading: ch.heading,
          score: ch.score,
          raw_score: ch.raw_score,
          passed: ch.passed,
          reject_reason: ch.reject_reason,
        })),
        retrieval: rbox.out
          ? {
              mode: rbox.out.mode,
              model: rbox.out.embedding?.model ?? null,
              latency_ms: rbox.out.embedding?.latency_ms ?? 0,
              input_tokens: rbox.out.embedding?.input_tokens ?? 0,
            }
          : null,
        tool_calls,
        totals,
      },
    };
  }
}
