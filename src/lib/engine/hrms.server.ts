import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInMonths, isBefore, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { breakdown, iso } from "@/lib/hr/dates";
import type { EngineTool, HrmsResult, WriteTool } from "./types";

/**
 * Mock HRMS. Deterministic, data-validating only — it never rules on policy.
 * Every write is idempotent on sha256(session_id + tool + args), so a replayed
 * Confirm returns the original receipt instead of a second request.
 */

const WFH_MONTHLY_CAP = 8;
const REGULARIZATION_MONTHLY_CAP = 3;

/** The demo's deliberate transient failure: one 500, then success on retry. */
const TRANSIENT_DATE = "2026-12-31";
const transientBurned = new Set<string>();

export type HrmsEmployee = {
  id: string;
  employee_code: string;
  full_name: string;
  employment_type: string;
  date_of_joining: string;
  manager_name: string | null;
  geo: string;
  grade_band: string | null;
  gender: string | null;
  work_location: string | null;
};

export function idempotencyKey(sessionId: string, tool: string, args: unknown): string {
  return createHash("sha256")
    .update(`${sessionId}|${tool}|${JSON.stringify(args)}`)
    .digest("hex");
}

function failCode(
  error_code:
    | "NOT_FOUND"
    | "INVALID_DATE_RANGE"
    | "INSUFFICIENT_BALANCE"
    | "CAP_EXCEEDED"
    | "OVERLAP"
    | "ALREADY_APPROVED"
    | "PAST_DATED"
    | "TRANSIENT",
  message: string,
): HrmsResult {
  return { ok: false, error_code, message };
}

function ok(data: unknown, duplicate = false): HrmsResult {
  return duplicate ? { ok: true, data, duplicate: true } : { ok: true, data };
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const LEAVE_CODES = ["CL", "SL", "EL", "ML", "PL", "BL", "UL"] as const;
const LEAVE_ALIASES: Record<string, string> = {
  "casual leave": "CL",
  casual: "CL",
  "sick leave": "SL",
  sick: "SL",
  "earned leave": "EL",
  earned: "EL",
  "annual leave": "EL",
  "privilege leave": "EL",
  "maternity leave": "ML",
  maternity: "ML",
  "paternity leave": "PL",
  paternity: "PL",
  "bereavement leave": "BL",
  bereavement: "BL",
  "unpaid leave": "UL",
  "loss of pay": "UL",
  lop: "UL",
};

/** Accepts a code or a plain-English name; anything else is a business error. */
function leaveCode(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  const upper = raw.toUpperCase();
  if ((LEAVE_CODES as readonly string[]).includes(upper)) return upper;
  return LEAVE_ALIASES[raw.toLowerCase()] ?? null;
}

function monthWindow(reference = new Date()) {
  return { from: iso(startOfMonth(reference)), to: iso(endOfMonth(reference)) };
}

function transientTrip(sessionId: string, tool: string, args: Record<string, unknown>): boolean {
  const touchesDate = Object.values(args).some((v) => v === TRANSIENT_DATE);
  if (!touchesDate) return false;
  const key = `${sessionId}|${tool}|${TRANSIENT_DATE}`;
  if (transientBurned.has(key)) return false;
  transientBurned.add(key);
  return true;
}

export type HrmsContext = {
  db: SupabaseClient;
  employee: HrmsEmployee;
  sessionId: string;
  today: string;
};

export async function runTool(
  ctx: HrmsContext,
  tool: EngineTool,
  rawArgs: Record<string, unknown>,
): Promise<HrmsResult> {
  const args = rawArgs ?? {};
  if (transientTrip(ctx.sessionId, tool, args)) {
    return failCode("TRANSIENT", "HRMS temporarily unavailable (503). Retry the call.");
  }

  switch (tool) {
    case "get_employee_profile":
      return ok({
        employee_code: ctx.employee.employee_code,
        name: ctx.employee.full_name,
        employment_type: ctx.employee.employment_type,
        date_of_joining: ctx.employee.date_of_joining,
        tenure_months: differenceInMonths(parseISO(ctx.today), parseISO(ctx.employee.date_of_joining)),
        gender: ctx.employee.gender,
        grade_band: ctx.employee.grade_band,
        work_location: ctx.employee.work_location,
        manager_name: ctx.employee.manager_name,
        geo: ctx.employee.geo,
      });

    case "get_leave_balance":
      return getLeaveBalance(ctx, str(args, "leave_type"));

    case "get_leave_requests":
      return getLeaveRequests(ctx, str(args, "status"));

    case "get_attendance":
      return getAttendance(ctx);

    case "get_wfh_usage":
      return getWfhUsage(ctx);

    case "get_regularization_usage":
      return getRegularizationUsage(ctx);

    case "get_payslips":
      return getPayslips(ctx);

    case "apply_leave":
      return applyLeave(ctx, args);

    case "cancel_leave":
      return cancelLeave(ctx, args);

    case "apply_wfh":
      return applyWfh(ctx, args);

    case "cancel_wfh":
      return cancelWfh(ctx, args);

    case "regularize_attendance":
      return regularizeAttendance(ctx, args);

    default:
      return failCode("NOT_FOUND", `Unknown tool: ${String(tool)}`);
  }
}

export function isWriteTool(tool: EngineTool): tool is WriteTool {
  return (
    tool === "apply_leave" ||
    tool === "cancel_leave" ||
    tool === "apply_wfh" ||
    tool === "cancel_wfh" ||
    tool === "regularize_attendance"
  );
}

// ---------- reads ----------

async function getLeaveBalance(ctx: HrmsContext, leaveType: string | null): Promise<HrmsResult> {
  let query = ctx.db
    .from("leave_balances")
    .select("leave_code, entitled, used, available, cycle_year")
    .eq("employee_id", ctx.employee.id);
  if (leaveType) {
    const code = leaveCode(leaveType);
    if (!code) {
      return failCode("NOT_FOUND", `Unknown leave type "${leaveType}". Valid codes: ${LEAVE_CODES.join(", ")}.`);
    }
    query = query.eq("leave_code", code);
  }
  const { data, error } = await query;
  if (error) return failCode("TRANSIENT", error.message);
  if (!data || data.length === 0) return failCode("NOT_FOUND", "No leave balance on record.");
  return ok({ balances: data });
}

async function getLeaveRequests(ctx: HrmsContext, status: string | null): Promise<HrmsResult> {
  let query = ctx.db
    .from("leave_requests")
    .select("id, leave_code, start_date, end_date, working_days, reason, status, created_at")
    .eq("employee_id", ctx.employee.id)
    .order("start_date", { ascending: false })
    .limit(20);
  if (status) query = query.eq("status", status.toUpperCase());
  const { data, error } = await query;
  if (error) return failCode("TRANSIENT", error.message);
  return ok({ requests: data ?? [] });
}

async function getAttendance(ctx: HrmsContext): Promise<HrmsResult> {
  const { from, to } = monthWindow(parseISO(ctx.today));
  const { data, error } = await ctx.db
    .from("attendance_records")
    .select("work_date, clock_in, clock_out, status, is_flagged, flag_reason, regularized")
    .eq("employee_id", ctx.employee.id)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date", { ascending: true });
  if (error) return failCode("TRANSIENT", error.message);
  const records = data ?? [];
  return ok({
    month: from.slice(0, 7),
    records,
    flagged_days: records.filter((r) => r.is_flagged && !r.regularized).map((r) => r.work_date),
  });
}

async function getWfhUsage(ctx: HrmsContext): Promise<HrmsResult> {
  const { from, to } = monthWindow(parseISO(ctx.today));
  const { data, error } = await ctx.db
    .from("wfh_requests")
    .select("id, start_date, end_date, reason, status")
    .eq("employee_id", ctx.employee.id)
    .gte("start_date", from)
    .lte("start_date", to);
  if (error) return failCode("TRANSIENT", error.message);
  const active = (data ?? []).filter((r) => r.status === "APPROVED" || r.status === "PENDING");
  return ok({
    month: from.slice(0, 7),
    used: active.length,
    cap: WFH_MONTHLY_CAP,
    remaining: Math.max(0, WFH_MONTHLY_CAP - active.length),
    requests: data ?? [],
  });
}

async function getRegularizationUsage(ctx: HrmsContext): Promise<HrmsResult> {
  const { from, to } = monthWindow(parseISO(ctx.today));
  const { data, error } = await ctx.db
    .from("attendance_regularizations")
    .select("id, work_date, corrected_in, corrected_out, reason, status")
    .eq("employee_id", ctx.employee.id)
    .gte("work_date", from)
    .lte("work_date", to);
  if (error) return failCode("TRANSIENT", error.message);
  const active = (data ?? []).filter((r) => r.status !== "REJECTED" && r.status !== "CANCELLED");
  return ok({
    month: from.slice(0, 7),
    used: active.length,
    cap: REGULARIZATION_MONTHLY_CAP,
    remaining: Math.max(0, REGULARIZATION_MONTHLY_CAP - active.length),
    requests: data ?? [],
  });
}

async function getPayslips(ctx: HrmsContext): Promise<HrmsResult> {
  const { data, error } = await ctx.db
    .from("payslips")
    .select("pay_month, gross_amount, net_amount, deductions")
    .eq("employee_id", ctx.employee.id)
    .order("pay_month", { ascending: false })
    .limit(6);
  if (error) return failCode("TRANSIENT", error.message);
  if (!data || data.length === 0) return failCode("NOT_FOUND", "No payslips on record.");
  return ok({ payslips: data });
}

// ---------- writes ----------

async function applyLeave(ctx: HrmsContext, args: Record<string, unknown>): Promise<HrmsResult> {
  const leave_type = leaveCode(str(args, "leave_type"));
  const start_date = str(args, "start_date");
  const end_date = str(args, "end_date") ?? start_date;
  const reason = str(args, "reason");
  if (!leave_type || !start_date || !end_date) {
    return failCode("NOT_FOUND", "leave_type, start_date and end_date are required.");
  }
  if (isBefore(parseISO(end_date), parseISO(start_date))) {
    return failCode("INVALID_DATE_RANGE", "end_date is before start_date.");
  }
  if (isBefore(parseISO(start_date), parseISO(ctx.today))) {
    return failCode("PAST_DATED", "start_date is in the past.");
  }

  const key = idempotencyKey(ctx.sessionId, "apply_leave", { leave_type, start_date, end_date });
  const replay = await ctx.db
    .from("leave_requests")
    .select("id, status, leave_code, start_date, end_date, working_days")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (replay.data) {
    return ok({ ...replay.data, request_id: replay.data.id }, true);
  }

  const { data: clash } = await ctx.db
    .from("leave_requests")
    .select("id, start_date, end_date, status")
    .eq("employee_id", ctx.employee.id)
    .in("status", ["PENDING", "APPROVED"])
    .lte("start_date", end_date)
    .gte("end_date", start_date);
  if (clash && clash.length > 0) {
    return failCode(
      "OVERLAP",
      `Overlaps request ${clash[0]!.id} (${clash[0]!.start_date} to ${clash[0]!.end_date}).`,
    );
  }

  const days = breakdown(start_date, end_date);
  const { data: balance } = await ctx.db
    .from("leave_balances")
    .select("available")
    .eq("employee_id", ctx.employee.id)
    .eq("leave_code", leave_type)
    .maybeSingle();
  const available = Number(balance?.available ?? 0);
  if (leave_type !== "UL" && days.working_days > available) {
    return failCode(
      "INSUFFICIENT_BALANCE",
      `Requested ${days.working_days} working days, ${available} available in ${leave_type}.`,
    );
  }

  const { data, error } = await ctx.db
    .from("leave_requests")
    .insert({
      employee_id: ctx.employee.id,
      leave_code: leave_type,
      start_date,
      end_date,
      working_days: days.working_days,
      reason,
      status: "PENDING",
      idempotency_key: key,
    })
    .select("id, leave_code, start_date, end_date, working_days, status")
    .single();
  if (error || !data) return failCode("TRANSIENT", error?.message ?? "Insert failed.");
  return ok({ request_id: data.id, ...data });
}

async function cancelLeave(ctx: HrmsContext, args: Record<string, unknown>): Promise<HrmsResult> {
  const request_id = str(args, "request_id");
  if (!request_id) return failCode("NOT_FOUND", "request_id is required.");
  const { data: row } = await ctx.db
    .from("leave_requests")
    .select("id, status, leave_code, start_date, end_date")
    .eq("employee_id", ctx.employee.id)
    .eq("id", request_id)
    .maybeSingle();
  if (!row) return failCode("NOT_FOUND", `No leave request ${request_id}.`);
  if (row.status === "APPROVED") {
    return failCode("ALREADY_APPROVED", `Request ${request_id} is already approved.`);
  }
  if (row.status === "CANCELLED") return ok({ request_id, status: "CANCELLED" }, true);
  const { error } = await ctx.db
    .from("leave_requests")
    .update({ status: "CANCELLED" })
    .eq("id", request_id);
  if (error) return failCode("TRANSIENT", error.message);
  return ok({ ...row, request_id, status: "CANCELLED" });
}

async function applyWfh(ctx: HrmsContext, args: Record<string, unknown>): Promise<HrmsResult> {
  const date = str(args, "date") ?? str(args, "start_date");
  const reason = str(args, "reason");
  if (!date) return failCode("NOT_FOUND", "date is required.");
  if (isBefore(parseISO(date), parseISO(ctx.today))) {
    return failCode("PAST_DATED", "date is in the past.");
  }

  const key = idempotencyKey(ctx.sessionId, "apply_wfh", { date });
  const replay = await ctx.db
    .from("wfh_requests")
    .select("id, status, start_date, end_date")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (replay.data) return ok({ request_id: replay.data.id, ...replay.data }, true);

  const { data: same } = await ctx.db
    .from("wfh_requests")
    .select("id")
    .eq("employee_id", ctx.employee.id)
    .in("status", ["PENDING", "APPROVED"])
    .lte("start_date", date)
    .gte("end_date", date);
  if (same && same.length > 0) {
    return failCode("OVERLAP", `WFH already recorded for ${date} (${same[0]!.id}).`);
  }

  const usage = await getWfhUsage({ ...ctx, today: date });
  if (usage.ok) {
    const used = (usage.data as { used: number }).used;
    if (used >= WFH_MONTHLY_CAP) {
      return failCode("CAP_EXCEEDED", `${used} of ${WFH_MONTHLY_CAP} WFH days already used this month.`);
    }
  }

  const { data, error } = await ctx.db
    .from("wfh_requests")
    .insert({
      employee_id: ctx.employee.id,
      start_date: date,
      end_date: date,
      reason,
      status: "PENDING",
      idempotency_key: key,
    })
    .select("id, start_date, end_date, status")
    .single();
  if (error || !data) return failCode("TRANSIENT", error?.message ?? "Insert failed.");
  return ok({ request_id: data.id, ...data });
}

async function cancelWfh(ctx: HrmsContext, args: Record<string, unknown>): Promise<HrmsResult> {
  const request_id = str(args, "request_id");
  if (!request_id) return failCode("NOT_FOUND", "request_id is required.");
  const { data: row } = await ctx.db
    .from("wfh_requests")
    .select("id, status, start_date")
    .eq("employee_id", ctx.employee.id)
    .eq("id", request_id)
    .maybeSingle();
  if (!row) return failCode("NOT_FOUND", `No WFH request ${request_id}.`);
  if (isBefore(parseISO(row.start_date), parseISO(ctx.today))) {
    return failCode("PAST_DATED", `${row.start_date} has already passed.`);
  }
  if (row.status === "CANCELLED") return ok({ request_id, status: "CANCELLED" }, true);
  const { error } = await ctx.db
    .from("wfh_requests")
    .update({ status: "CANCELLED" })
    .eq("id", request_id);
  if (error) return failCode("TRANSIENT", error.message);
  return ok({ request_id, status: "CANCELLED", date: row.start_date });
}

async function regularizeAttendance(
  ctx: HrmsContext,
  args: Record<string, unknown>,
): Promise<HrmsResult> {
  const date = str(args, "date") ?? str(args, "work_date");
  const clock_in = str(args, "clock_in");
  const clock_out = str(args, "clock_out");
  const reason = str(args, "reason");
  if (!date || !reason) return failCode("NOT_FOUND", "date and reason are required.");
  if (isBefore(parseISO(ctx.today), parseISO(date))) {
    return failCode("INVALID_DATE_RANGE", "Cannot regularize a future date.");
  }

  const key = idempotencyKey(ctx.sessionId, "regularize_attendance", { date, clock_in, clock_out });
  const replay = await ctx.db
    .from("attendance_regularizations")
    .select("id, status, work_date")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (replay.data) return ok({ request_id: replay.data.id, ...replay.data }, true);

  const usage = await getRegularizationUsage({ ...ctx, today: date });
  if (usage.ok) {
    const used = (usage.data as { used: number }).used;
    if (used >= REGULARIZATION_MONTHLY_CAP) {
      return failCode(
        "CAP_EXCEEDED",
        `${used} of ${REGULARIZATION_MONTHLY_CAP} regularizations already used this month.`,
      );
    }
  }

  const { data, error } = await ctx.db
    .from("attendance_regularizations")
    .insert({
      employee_id: ctx.employee.id,
      work_date: date,
      corrected_in: clock_in,
      corrected_out: clock_out,
      reason,
      status: "PENDING",
      idempotency_key: key,
    })
    .select("id, work_date, corrected_in, corrected_out, status")
    .single();
  if (error || !data) return failCode("TRANSIENT", error?.message ?? "Insert failed.");
  return ok({ request_id: data.id, ...data });
}
