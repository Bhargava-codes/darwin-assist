/** Shared vocabulary for the multi-agent workflow engine (/engine). */

export const READ_TOOLS = [
  "get_employee_profile",
  "get_leave_balance",
  "get_leave_requests",
  "get_attendance",
  "get_wfh_usage",
  "get_regularization_usage",
  "get_payslips",
] as const;

export const WRITE_TOOLS = [
  "apply_leave",
  "cancel_leave",
  "apply_wfh",
  "cancel_wfh",
  "regularize_attendance",
] as const;

export type ReadTool = (typeof READ_TOOLS)[number];
export type WriteTool = (typeof WRITE_TOOLS)[number];
export type EngineTool = ReadTool | WriteTool;

export const ALL_TOOLS: EngineTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

/** Every business failure the mock HRMS is allowed to return. */
export const HRMS_ERRORS = [
  "NOT_FOUND",
  "INVALID_DATE_RANGE",
  "INSUFFICIENT_BALANCE",
  "CAP_EXCEEDED",
  "OVERLAP",
  "ALREADY_APPROVED",
  "PAST_DATED",
] as const;

export type HrmsErrorCode = (typeof HRMS_ERRORS)[number];

export type HrmsOk = {
  ok: true;
  data: unknown;
  /** True when an idempotency key replayed an earlier write. */
  duplicate?: boolean;
};

export type HrmsFail = {
  ok: false;
  error_code: HrmsErrorCode | "TRANSIENT";
  message: string;
};

export type HrmsResult = HrmsOk | HrmsFail;

export type Verdict = "FULL" | "PARTIAL" | "NONE" | "UNKNOWN";

export type PendingAction = {
  tool: WriteTool;
  args: Record<string, unknown>;
  summary: string;
  rows: { label: string; value: string }[];
};

export type Citation = { chunk_id: string; heading: string };

export type EngineMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chips: string[];
  citations: Citation[];
  verdict: Verdict | null;
  receipt: { tool: string; request_id: string; status: string } | null;
  turn_index: number;
};

export type TraceEvent = {
  step_index: number;
  actor: "orchestrator" | "A1" | "A2" | "A3" | "rag" | "hrms";
  action: string;
  model: string | null;
  mode: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
  status: string;
  payload: unknown;
  result: unknown;
};

export type TurnTrace = {
  turn_index: number;
  events: TraceEvent[];
  cost_usd: number;
  latency_ms: number;
  baseline_mode: boolean;
};

export type EngineTurnResponse = {
  session_id: string;
  messages: EngineMessage[];
  trace: TurnTrace;
  session_cost_usd: number;
  baseline_cost_usd: number;
  agentic_cost_usd: number;
  pending: PendingAction | null;
};
