import { addDays, isWeekend, parseISO } from "date-fns";
import { breakdown, iso, weekendSentence } from "./dates";
import type { HrState, LeaveType, RequestStatus } from "./types";
import { LEAVE_TYPE_LABEL } from "./types";

export type ToolName =
  | "check_leave_balance"
  | "get_leave_history"
  | "apply_leave"
  | "update_leave"
  | "cancel_leave"
  | "get_attendance"
  | "get_regularization_usage"
  | "regularize_attendance"
  | "get_wfh_usage"
  | "apply_wfh"
  | "cancel_wfh";

export type Risk = "LOW" | "MEDIUM" | "HIGH";

export const TOOL_RISK: Record<ToolName, Risk> = {
  check_leave_balance: "LOW",
  get_leave_history: "LOW",
  get_attendance: "LOW",
  get_regularization_usage: "LOW",
  get_wfh_usage: "LOW",
  apply_leave: "MEDIUM",
  regularize_attendance: "MEDIUM",
  apply_wfh: "MEDIUM",
  update_leave: "HIGH",
  cancel_leave: "HIGH",
  cancel_wfh: "HIGH",
};

export const TOOL_PARAMS: Record<ToolName, { required: string[]; optional: string[] }> = {
  check_leave_balance: { required: [], optional: ["leave_type"] },
  get_leave_history: { required: [], optional: ["status"] },
  get_attendance: { required: [], optional: ["month"] },
  get_regularization_usage: { required: [], optional: [] },
  get_wfh_usage: { required: [], optional: [] },
  apply_leave: { required: ["leave_type", "start_date", "end_date"], optional: ["reason"] },
  update_leave: { required: ["request_id"], optional: ["start_date", "end_date", "leave_type"] },
  cancel_leave: { required: ["request_id"], optional: [] },
  regularize_attendance: {
    required: ["date", "clock_in", "clock_out", "reason"],
    optional: [],
  },
  apply_wfh: { required: ["date"], optional: ["reason"] },
  cancel_wfh: { required: ["request_id"], optional: [] },
};

export type ToolParams = Record<string, string | undefined>;

export type ToolError =
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "INSUFFICIENT_BALANCE"
  | "CAP_EXCEEDED"
  | "NOT_FOUND"
  | "ALREADY_APPROVED"
  | "MISSING_PARAMETERS"
  | "OUT_OF_SCOPE";

const TRANSIENT: ToolError[] = ["TIMEOUT", "SERVICE_UNAVAILABLE"];

export type ToolOutcome = {
  ok: boolean;
  state?: HrState | undefined;
  error_code?: ToolError | undefined;
  message?: string;
  result?: Record<string, unknown>;
};

export type ToolCallRecord = {
  tool: ToolName | null;
  risk: Risk | null;
  params: ToolParams;
  attempts: number;
  attempt_log: { attempt: number; error_code?: ToolError | undefined }[];
  outcome: ToolOutcome;
  requires_confirmation: boolean;
};

const clone = (s: HrState): HrState => JSON.parse(JSON.stringify(s)) as HrState;

function nextId(prefix: string) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 8999)}`;
}

function findLeave(state: HrState, id: string) {
  return state.leave_requests.find(
    (r) => r.id.toLowerCase() === id.toLowerCase() || r.id.endsWith(id),
  );
}

/** One attempt of a tool against a state snapshot. Pure apart from injected faults. */
function attemptTool(
  tool: ToolName,
  params: ToolParams,
  state: HrState,
  attempt: number,
): ToolOutcome {
  switch (tool) {
    case "check_leave_balance": {
      // Injected transient fault: ~1 in 5 first calls time out.
      if (attempt === 1 && Math.random() < 0.2) {
        return { ok: false, error_code: "TIMEOUT", message: "Balance service timed out." };
      }
      const type = params["leave_type"] as "CL" | "SL" | "EL" | undefined;
      if (type && state.balances[type]) {
        return {
          ok: true,
          result: { leave_type: type, ...state.balances[type] },
        };
      }
      return { ok: true, result: { balances: state.balances } };
    }
    case "get_leave_history": {
      const status = params["status"] as RequestStatus | undefined;
      const rows = status
        ? state.leave_requests.filter((r) => r.status === status)
        : state.leave_requests;
      return { ok: true, result: { count: rows.length, requests: rows } };
    }
    case "get_attendance":
      return {
        ok: true,
        result: {
          records: state.attendance,
          flagged: state.attendance.filter((a) => a.status === "flagged" && !a.regularized),
        },
      };
    case "get_regularization_usage":
      return { ok: true, result: state.regularizations_this_month };
    case "get_wfh_usage":
      return {
        ok: true,
        result: { ...state.wfh_this_month, upcoming: state.wfh_requests },
      };
    case "apply_leave": {
      const type = params["leave_type"] as LeaveType;
      const start = params["start_date"]!;
      const end = params["end_date"]!;
      const b = breakdown(start, end);
      const balance = state.balances[type as "CL" | "SL" | "EL"];
      if (balance && b.working_days > balance.available) {
        return {
          ok: false,
          error_code: "INSUFFICIENT_BALANCE",
          message: `You have ${balance.available} day(s) of ${LEAVE_TYPE_LABEL[type]} available and this request needs ${b.working_days} working day(s).`,
          result: {
            requested_days: b.working_days,
            available_days: balance.available,
            alternates_with_balance: Object.entries(state.balances)
              .filter(([k, v]) => k !== type && v.available >= b.working_days)
              .map(([k, v]) => ({ leave_type: k, available: v.available })),
          },
        };
      }
      const next = clone(state);
      if (balance) {
        const nb = next.balances[type as "CL" | "SL" | "EL"];
        nb.used += b.working_days;
        nb.available -= b.working_days;
      }
      const request = {
        id: nextId("LV"),
        type,
        start_date: start,
        end_date: end,
        days: b.working_days,
        status: "Pending" as const,
        reason: params["reason"] ?? "Applied via assistant",
        applied_on: iso(new Date()),
      };
      next.leave_requests = [request, ...next.leave_requests];
      return {
        ok: true,
        state: next,
        result: {
          request,
          working_days: b.working_days,
          weekend_note: weekendSentence(b),
          remaining_balance: balance ? next.balances[type as "CL" | "SL" | "EL"].available : null,
        },
      };
    }
    case "update_leave": {
      const target = findLeave(state, params["request_id"]!);
      if (!target) return { ok: false, error_code: "NOT_FOUND", message: "No such leave request." };
      if (target.status !== "Pending")
        return {
          ok: false,
          error_code: "ALREADY_APPROVED",
          message: `Request ${target.id} is ${target.status} and cannot be edited in self-service.`,
        };
      const next = clone(state);
      const row = findLeave(next, target.id)!;
      const start = params["start_date"] ?? row.start_date;
      const end = params["end_date"] ?? row.end_date;
      const oldDays = row.days;
      const b = breakdown(start, end);
      row.start_date = start;
      row.end_date = end;
      row.days = b.working_days;
      if (params["leave_type"]) row.type = params["leave_type"] as LeaveType;
      const bal = next.balances[row.type as "CL" | "SL" | "EL"];
      if (bal) {
        bal.used += b.working_days - oldDays;
        bal.available -= b.working_days - oldDays;
      }
      return { ok: true, state: next, result: { request: row } };
    }
    case "cancel_leave": {
      const target = findLeave(state, params["request_id"]!);
      if (!target) return { ok: false, error_code: "NOT_FOUND", message: "No such leave request." };
      if (target.status !== "Pending")
        return {
          ok: false,
          error_code: "ALREADY_APPROVED",
          message: `Request ${target.id} is ${target.status} and cannot be cancelled in self-service.`,
        };
      const next = clone(state);
      const row = findLeave(next, target.id)!;
      row.status = "Cancelled";
      const bal = next.balances[row.type as "CL" | "SL" | "EL"];
      if (bal) {
        bal.used -= row.days;
        bal.available += row.days;
      }
      return { ok: true, state: next, result: { request: row } };
    }
    case "regularize_attendance": {
      if (state.regularizations_this_month.remaining <= 0) {
        return {
          ok: false,
          error_code: "CAP_EXCEEDED",
          message: `You have used ${state.regularizations_this_month.used} of ${state.regularizations_this_month.allowance} regularizations this calendar month.`,
          result: state.regularizations_this_month,
        };
      }
      const next = clone(state);
      const day = next.attendance.find((a) => a.date === params["date"]);
      if (!day) return { ok: false, error_code: "NOT_FOUND", message: "No attendance record." };
      day.clock_in = params["clock_in"]!;
      day.clock_out = params["clock_out"]!;
      day.status = "present";
      day.regularized = true;
      day.flag_reason = null;
      next.regularizations_this_month.used += 1;
      next.regularizations_this_month.remaining -= 1;
      return {
        ok: true,
        state: next,
        result: { day, usage: next.regularizations_this_month, reason: params["reason"] },
      };
    }
    case "apply_wfh": {
      const date = params["date"]!;
      if (state.wfh_this_month.remaining <= 0) {
        return {
          ok: false,
          error_code: "CAP_EXCEEDED",
          message: `You have used ${state.wfh_this_month.used} of ${state.wfh_this_month.allowance} work-from-home days this calendar month.`,
          result: state.wfh_this_month,
        };
      }
      if (isWeekend(parseISO(date)))
        return { ok: false, error_code: "NOT_FOUND", message: "That date is not a working day." };
      const next = clone(state);
      const request = {
        id: nextId("WF"),
        date,
        status: "Pending" as const,
        reason: params["reason"] ?? "Applied via assistant",
      };
      next.wfh_requests = [...next.wfh_requests, request].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      next.wfh_this_month.used += 1;
      next.wfh_this_month.remaining -= 1;
      return { ok: true, state: next, result: { request, usage: next.wfh_this_month } };
    }
    case "cancel_wfh": {
      const id = params["request_id"]!;
      const target = state.wfh_requests.find((r) => r.id === id || r.date === id);
      if (!target) return { ok: false, error_code: "NOT_FOUND", message: "No such WFH day." };
      const next = clone(state);
      next.wfh_requests = next.wfh_requests.filter((r) => r.id !== target.id);
      next.wfh_this_month.used = Math.max(0, next.wfh_this_month.used - 1);
      next.wfh_this_month.remaining += 1;
      return { ok: true, state: next, result: { cancelled: target, usage: next.wfh_this_month } };
    }
    default:
      return { ok: false, error_code: "OUT_OF_SCOPE", message: "Unknown tool." };
  }
}

/**
 * Agent 3's executor. Transient errors retry up to 2x with backoff; business
 * errors are never retried — a deterministic "no" stays a no, and retrying a
 * write risks a duplicate submission.
 */
export function runTool(
  tool: ToolName,
  params: ToolParams,
  state: HrState,
  opts: { confirmation_token?: boolean; dry_run?: boolean } = {},
): ToolCallRecord {
  const risk = TOOL_RISK[tool];
  const spec = TOOL_PARAMS[tool];
  const missing = spec.required.filter((k) => !params[k]);
  const base = { tool, risk, params, requires_confirmation: risk !== "LOW" };

  if (missing.length > 0) {
    return {
      ...base,
      attempts: 0,
      attempt_log: [],
      outcome: {
        ok: false,
        error_code: "MISSING_PARAMETERS",
        message: `Missing required parameter(s): ${missing.join(", ")}`,
      },
    };
  }

  if (risk !== "LOW" && !opts.confirmation_token && !opts.dry_run) {
    return {
      ...base,
      attempts: 0,
      attempt_log: [],
      outcome: { ok: false, message: "confirmation_token required" },
    };
  }

  const attempt_log: { attempt: number; error_code?: ToolError | undefined }[] = [];
  let attempt = 0;
  let outcome: ToolOutcome = { ok: false };
  while (attempt < 3) {
    attempt += 1;
    outcome = attemptTool(tool, params, state, attempt);
    attempt_log.push({ attempt, error_code: outcome.error_code });
    if (outcome.ok) break;
    const transient = outcome.error_code && TRANSIENT.includes(outcome.error_code);
    if (!transient) break;
  }
  if (opts.dry_run && outcome.state) outcome = { ...outcome, state: undefined };
  return { ...base, attempts: attempt, attempt_log, outcome };
}

export function nextWorkingDay(from: Date) {
  let day = addDays(from, 1);
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}
