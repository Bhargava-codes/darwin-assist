import type { SupabaseClient } from "@supabase/supabase-js";
import { isWeekend, parseISO } from "date-fns";
import { breakdown, iso } from "./dates";
import type { ToolName, ToolParams } from "./tools";
import type {
  AttendanceRecord,
  AttendanceStatus,
  HrState,
  LeaveRequest,
  LeaveType,
  RequestStatus,
  WfhRequest,
} from "./types";

/**
 * The database is the system of record. HrState is the in-memory projection the
 * tools and the UI already speak, so every turn loads it, runs the pure tool
 * logic against it, and writes the resulting mutation back here.
 */

export type EmployeeRow = {
  id: string;
  employee_code: string;
  full_name: string;
  employment_type: string;
  date_of_joining: string;
  manager_name: string | null;
  geo: string;
  grade_band: string | null;
  is_hr_ops: boolean;
};

export type EmployeeContext = {
  id: string;
  employee_id: string;
  name: string;
  employment_type: string;
  tenure_months: number;
  manager_name: string;
  geo: string;
  grade_band: string;
  is_hr_ops: boolean;
};

export const WFH_ALLOWANCE = 8;
export const REGULARIZATION_ALLOWANCE = 3;

const monthStart = () => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), 1));
};
const monthEnd = () => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};

export function toEmployeeContext(row: EmployeeRow): EmployeeContext {
  const joined = parseISO(row.date_of_joining);
  const now = new Date();
  const months =
    (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
  return {
    id: row.id,
    employee_id: row.employee_code,
    name: row.full_name,
    employment_type: row.employment_type === "full_time" ? "full-time" : row.employment_type,
    tenure_months: Math.max(0, months),
    manager_name: row.manager_name ?? "your manager",
    geo: row.geo,
    grade_band: row.grade_band ?? "not stated",
    is_hr_ops: row.is_hr_ops,
  };
}

const STATUS_IN: Record<string, RequestStatus> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const shortId = (prefix: string, uuid: string) =>
  `${prefix}-${uuid.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

/** Loads the full employee projection used by the tools, the assistant and the UI. */
export async function loadHrState(
  client: SupabaseClient,
  employeeId: string,
): Promise<HrState> {
  const year = new Date().getFullYear();
  const [balances, leave, attendance, wfh, regs] = await Promise.all([
    client
      .from("leave_balances")
      .select("leave_code, entitled, used, available")
      .eq("employee_id", employeeId)
      .eq("cycle_year", year),
    client
      .from("leave_requests")
      .select("id, leave_code, start_date, end_date, working_days, reason, status, created_at")
      .eq("employee_id", employeeId)
      .order("start_date", { ascending: false }),
    client
      .from("attendance_records")
      .select("work_date, clock_in, clock_out, status, is_flagged, flag_reason, regularized")
      .eq("employee_id", employeeId)
      .gte("work_date", monthStart())
      .lte("work_date", monthEnd())
      .order("work_date", { ascending: true }),
    client
      .from("wfh_requests")
      .select("id, start_date, reason, status")
      .eq("employee_id", employeeId)
      .neq("status", "CANCELLED")
      .order("start_date", { ascending: true }),
    client
      .from("attendance_regularizations")
      .select("id, work_date, status")
      .eq("employee_id", employeeId)
      .neq("status", "CANCELLED")
      .gte("work_date", monthStart())
      .lte("work_date", monthEnd()),
  ]);

  const balanceRows = (balances.data ?? []) as {
    leave_code: string;
    entitled: number;
    used: number;
    available: number;
  }[];
  const balanceFor = (code: "CL" | "SL" | "EL") => {
    const row = balanceRows.find((b) => b.leave_code === code);
    return {
      total: Number(row?.entitled ?? 0),
      used: Number(row?.used ?? 0),
      available: Number(row?.available ?? 0),
    };
  };

  const today = iso(new Date());

  const leave_requests: LeaveRequest[] = ((leave.data ?? []) as {
    id: string;
    leave_code: string;
    start_date: string;
    end_date: string;
    working_days: number;
    reason: string | null;
    status: string;
    created_at: string;
  }[]).map((row) => {
    const mapped = STATUS_IN[row.status] ?? "Pending";
    return {
      id: shortId("LV", row.id),
      db_id: row.id,
      type: row.leave_code as LeaveType,
      start_date: row.start_date,
      end_date: row.end_date,
      days: Number(row.working_days),
      status: mapped === "Approved" && row.end_date < today ? "Past" : mapped,
      reason: row.reason ?? "",
      applied_on: row.created_at.slice(0, 10),
    };
  });

  const attendanceRows = ((attendance.data ?? []) as {
    work_date: string;
    clock_in: string | null;
    clock_out: string | null;
    status: string;
    is_flagged: boolean;
    flag_reason: string | null;
    regularized: boolean;
  }[]).map<AttendanceRecord>((row) => {
    const day = parseISO(row.work_date);
    let status: AttendanceStatus;
    if (isWeekend(day)) status = "weekend";
    else if (row.work_date > today) status = "future";
    else if (row.is_flagged) status = "flagged";
    else if (row.status === "WFH") status = "wfh";
    else if (row.status === "ABSENT") status = "absent";
    else status = "present";
    return {
      date: row.work_date,
      status,
      clock_in: row.clock_in ? row.clock_in.slice(0, 5) : null,
      clock_out: row.clock_out ? row.clock_out.slice(0, 5) : null,
      flag_reason: row.flag_reason,
      regularized: row.regularized,
    };
  });

  const wfhRows = ((wfh.data ?? []) as {
    id: string;
    start_date: string;
    reason: string | null;
    status: string;
  }[]).map<WfhRequest>((row) => ({
    id: shortId("WF", row.id),
    db_id: row.id,
    date: row.start_date,
    status: STATUS_IN[row.status] ?? "Pending",
    reason: row.reason ?? "",
  }));

  const start = monthStart();
  const end = monthEnd();
  const wfhUsed = wfhRows.filter((r) => r.date >= start && r.date <= end).length;
  const regUsed = (regs.data ?? []).length;

  return {
    balances: { CL: balanceFor("CL"), SL: balanceFor("SL"), EL: balanceFor("EL") },
    wfh_this_month: {
      allowance: WFH_ALLOWANCE,
      used: wfhUsed,
      remaining: Math.max(0, WFH_ALLOWANCE - wfhUsed),
    },
    regularizations_this_month: {
      allowance: REGULARIZATION_ALLOWANCE,
      used: regUsed,
      remaining: Math.max(0, REGULARIZATION_ALLOWANCE - regUsed),
    },
    leave_requests,
    attendance: attendanceRows,
    wfh_requests: wfhRows,
    clocked_in_at: null,
    last_clock_out: null,
  };
}

function resolveLeave(state: HrState, ref: string | undefined) {
  if (!ref) return undefined;
  const needle = ref.toLowerCase();
  return state.leave_requests.find(
    (r) => r.id.toLowerCase() === needle || r.db_id === ref || r.id.toLowerCase().endsWith(needle),
  );
}

function resolveWfh(state: HrState, ref: string | undefined) {
  if (!ref) return undefined;
  const needle = ref.toLowerCase();
  return state.wfh_requests.find(
    (r) => r.id.toLowerCase() === needle || r.db_id === ref || r.date === ref,
  );
}

async function adjustBalance(
  admin: SupabaseClient,
  employeeId: string,
  code: string,
  delta: number,
) {
  if (!["CL", "SL", "EL"].includes(code) || delta === 0) return;
  const year = new Date().getFullYear();
  const { data } = await admin
    .from("leave_balances")
    .select("id, used")
    .eq("employee_id", employeeId)
    .eq("cycle_year", year)
    .eq("leave_code", code)
    .maybeSingle();
  if (!data) return;
  await admin
    .from("leave_balances")
    .update({ used: Math.max(0, Number(data.used) + delta), updated_at: new Date().toISOString() })
    .eq("id", data.id);
}

/**
 * Persists the effect of a successful write tool. The pure tool decided whether
 * the action is allowed; this maps that decision onto real rows.
 */
export async function applyToolWrite(
  admin: SupabaseClient,
  employeeId: string,
  tool: ToolName,
  params: ToolParams,
  state: HrState,
): Promise<void> {
  switch (tool) {
    case "apply_leave": {
      const start = params["start_date"]!;
      const end = params["end_date"]!;
      const code = params["leave_type"]!;
      const days = breakdown(start, end).working_days;
      await admin.from("leave_requests").insert({
        employee_id: employeeId,
        leave_code: code,
        start_date: start,
        end_date: end,
        working_days: days,
        reason: params["reason"] ?? "Applied via assistant",
        status: "PENDING",
      });
      await adjustBalance(admin, employeeId, code, days);
      return;
    }
    case "update_leave": {
      const target = resolveLeave(state, params["request_id"]);
      if (!target?.db_id) return;
      const start = params["start_date"] ?? target.start_date;
      const end = params["end_date"] ?? target.end_date;
      const code = params["leave_type"] ?? target.type;
      const days = breakdown(start, end).working_days;
      await admin
        .from("leave_requests")
        .update({
          start_date: start,
          end_date: end,
          leave_code: code,
          working_days: days,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.db_id);
      if (code === target.type) {
        await adjustBalance(admin, employeeId, code, days - target.days);
      } else {
        await adjustBalance(admin, employeeId, target.type, -target.days);
        await adjustBalance(admin, employeeId, code, days);
      }
      return;
    }
    case "cancel_leave": {
      const target = resolveLeave(state, params["request_id"]);
      if (!target?.db_id) return;
      await admin
        .from("leave_requests")
        .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
        .eq("id", target.db_id);
      await adjustBalance(admin, employeeId, target.type, -target.days);
      return;
    }
    case "regularize_attendance": {
      const date = params["date"]!;
      await admin.from("attendance_regularizations").insert({
        employee_id: employeeId,
        work_date: date,
        corrected_in: params["clock_in"]!,
        corrected_out: params["clock_out"]!,
        reason: params["reason"]!,
        status: "APPROVED",
      });
      await admin
        .from("attendance_records")
        .update({
          clock_in: params["clock_in"]!,
          clock_out: params["clock_out"]!,
          status: "PRESENT",
          is_flagged: false,
          flag_reason: null,
          regularized: true,
        })
        .eq("employee_id", employeeId)
        .eq("work_date", date);
      return;
    }
    case "apply_wfh": {
      const date = params["date"]!;
      await admin.from("wfh_requests").insert({
        employee_id: employeeId,
        start_date: date,
        end_date: date,
        reason: params["reason"] ?? "Applied via assistant",
        status: "PENDING",
      });
      return;
    }
    case "cancel_wfh": {
      const target = resolveWfh(state, params["request_id"]);
      if (!target?.db_id) return;
      await admin.from("wfh_requests").update({ status: "CANCELLED" }).eq("id", target.db_id);
      return;
    }
    default:
      return;
  }
}

export const MUTATING_TOOLS: ToolName[] = [
  "apply_leave",
  "update_leave",
  "cancel_leave",
  "regularize_attendance",
  "apply_wfh",
  "cancel_wfh",
];
