import type { PolicySubject } from "@/data/policy-corpus";
import type { HrState } from "@/lib/hr/types";
import type { Risk, ToolName, ToolParams } from "@/lib/hr/tools";

export type Verdict = "FULL" | "PARTIAL" | "NONE" | "UNKNOWN";

export type Intent =
  | "policy_qa"
  | "leave_apply"
  | "leave_read"
  | "leave_update"
  | "leave_cancel"
  | "attendance_regularize"
  | "attendance_read"
  | "wfh_apply"
  | "wfh_read"
  | "wfh_cancel"
  | "mixed"
  | "unmatched";

export type Citation = { clause_id: string; text: string };

export type PendingAction = {
  tool: ToolName;
  params: ToolParams;
  title: string;
  rows: { label: string; value: string }[];
};

export type AssistantTurn = {
  id: string;
  role: "assistant";
  text: string;
  chips: string[];
  citations: Citation[];
  verdict: Verdict | null;
  pending: PendingAction | null;
  abstain: boolean;
  failed?: boolean;
  /** Turn this reply belongs to — the key feedback is recorded against. */
  turn_index?: number;
  feedback?: "up" | "down" | null;
};

export type UserTurn = { id: string; role: "user"; text: string };
export type ChatMessage = UserTurn | AssistantTurn;

export type TraceStep = {
  agent: string;
  model: string;
  input_summary: string;
  output_summary: string;
  latency_ms: number;
  tokens: { input: number; output: number };
  cost: number;
};

export type TraceChunk = {
  clause_id: string;
  subject: string;
  heading: string;
  score: number;
  raw_score: number | null;
  passed: boolean;
  reject_reason: string | null;
};

export type TraceToolCall = {
  tool: ToolName | null;
  risk: Risk | null;
  params: ToolParams;
  attempts: number;
  error_code: string | null;
  result_summary: string;
  result: unknown;
};

export type TraceTurn = {
  turn: number;
  user_message: string;
  intent: Intent | null;
  path: string;
  verdict: Verdict | null;
  steps: TraceStep[];
  chunks: TraceChunk[];
  retrieval: {
    mode: "embeddings" | "keyword";
    model: string | null;
    latency_ms: number;
    input_tokens: number;
  } | null;
  tool_calls: TraceToolCall[];
  totals: { latency_ms: number; tokens: number; cost: number; baseline_cost: number };
};

export type Slots = {
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  date: string | null;
  request_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  reason: string | null;
  probes: number;
};

export const emptySlots: Slots = {
  leave_type: null,
  start_date: null,
  end_date: null,
  date: null,
  request_id: null,
  clock_in: null,
  clock_out: null,
  reason: null,
  probes: 0,
};

export type AgentRequest = {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  slots: Slots;
  state: HrState;
  confirm: PendingAction | null;
  subjects?: PolicySubject[];
};

export type AgentResponse = {
  turn: AssistantTurn;
  slots: Slots;
  state: HrState;
  trace: TraceTurn;
};
