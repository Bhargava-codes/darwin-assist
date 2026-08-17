export type LeaveType = "CL" | "SL" | "EL" | "ML" | "PL" | "BL" | "UL";

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  CL: "Casual Leave",
  SL: "Sick Leave",
  EL: "Earned Leave",
  ML: "Maternity Leave",
  PL: "Paternity Leave",
  BL: "Bereavement Leave",
  UL: "Unpaid Leave",
};

export type RequestStatus = "Pending" | "Approved" | "Rejected" | "Cancelled" | "Past";

export type LeaveRequest = {
  id: string;
  /** Row id in public.leave_requests — present whenever the row came from the database. */
  db_id?: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  status: RequestStatus;
  reason: string;
  applied_on: string;
};


export type AttendanceStatus = "present" | "absent" | "flagged" | "wfh" | "weekend" | "future";

export type AttendanceRecord = {
  date: string;
  status: AttendanceStatus;
  clock_in: string | null;
  clock_out: string | null;
  flag_reason: string | null;
  regularized: boolean;
};

export type WfhRequest = {
  id: string;
  /** Row id in public.wfh_requests — present whenever the row came from the database. */
  db_id?: string;
  date: string;
  status: RequestStatus;
  reason: string;
};


export type Balance = { total: number; used: number; available: number };

export type HrState = {
  balances: Record<"CL" | "SL" | "EL", Balance>;
  wfh_this_month: { allowance: number; used: number; remaining: number };
  regularizations_this_month: { allowance: number; used: number; remaining: number };
  leave_requests: LeaveRequest[];
  attendance: AttendanceRecord[];
  wfh_requests: WfhRequest[];
  clocked_in_at: string | null;
  last_clock_out: string | null;
};

export const employee = {
  employee_id: "E-4471",
  name: "Bhargava",
  employment_type: "full-time",
  tenure_months: 26,
  manager_name: "Priya Nair",
  geo: "IN",
} as const;

export type Employee = typeof employee;
