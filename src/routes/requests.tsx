import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { useHr } from "@/lib/hr/store";
import { LoadingPanel } from "@/components/app/LoadingPanel";
import { LEAVE_TYPE_LABEL, type RequestStatus } from "@/lib/hr/types";
import { pretty, prettyShort } from "@/lib/hr/dates";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Your requests — Darwinbox HR" },
      {
        name: "description",
        content:
          "See every leave, attendance and work-from-home request you've made, and where each one stands.",
      },
      { property: "og:title", content: "Your requests — Darwinbox HR" },
      {
        property: "og:description",
        content: "Everything you've asked for, and where it stands.",
      },
    ],
  }),
  component: RequestsScreen,
});

type Tab = "leave" | "attendance" | "wfh";
const TABS: { id: Tab; label: string }[] = [
  { id: "leave", label: "Leave" },
  { id: "attendance", label: "Attendance" },
  { id: "wfh", label: "WFH" },
];

function StatusPill({ status }: { status: RequestStatus }) {
  const tone: Record<RequestStatus, string> = {
    Pending: "bg-warning/10 text-warning",
    Approved: "bg-success/10 text-success",
    Rejected: "bg-destructive/10 text-destructive",
    Cancelled: "bg-muted text-muted-foreground",
    Past: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", tone[status])}>
      {status}
    </span>
  );
}

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30">
      <div className="w-full max-w-[430px] rounded-t-2xl bg-card p-4 pb-8">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-[13px] text-muted-foreground">
            Close
          </button>
        </div>
        <div className="mt-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <input
        {...props}
        className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function LeaveTab() {
  const { state, act } = useHr();
  const [filter, setFilter] = useState<"All" | "Pending" | "Approved" | "Closed">("All");
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: "CL", start_date: "", end_date: "", reason: "" });

  if (!state) return <LoadingPanel />;

  const requests = state.leave_requests.filter((r) =>
    filter === "All"
      ? true
      : filter === "Closed"
        ? r.status === "Past" || r.status === "Cancelled" || r.status === "Rejected"
        : r.status === filter,
  );

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {(["All", "Pending", "Approved", "Closed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-[13px]",
              filter === f
                ? "border-primary bg-primary-light font-medium text-primary-dark"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <button
        onClick={() => setApplyOpen(true)}
        className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground active:bg-primary-dark"
      >
        Apply for leave
      </button>

      {requests.length === 0 && (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          No leave requests yet.
        </p>
      )}

      {requests.map((request) => (
        <div key={request.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium text-foreground">
                {LEAVE_TYPE_LABEL[request.type]}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {prettyShort(request.start_date)} – {pretty(request.end_date)} · {request.days}{" "}
                {request.days === 1 ? "day" : "days"}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">{request.reason}</p>
            </div>
            <StatusPill status={request.status} />
          </div>
          {request.status === "Pending" && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => {
                  const result = await act("cancel_leave", { request_id: request.id });
                  toast[result.ok ? "success" : "error"](
                    result.ok ? "Leave request cancelled" : result.message,
                  );
                }}
                className="h-9 rounded-full border border-border px-4 text-[13px] font-medium text-destructive"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}

      <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Apply for leave">
        <label className="block">
          <span className="text-[12px] font-medium text-muted-foreground">Leave type</span>
          <select
            value={form.leave_type}
            onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
            className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] text-foreground outline-none"
          >
            {(["CL", "SL", "EL"] as const).map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Start date"
          type="date"
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />
        <Field
          label="End date"
          type="date"
          value={form.end_date}
          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
        />
        <Field
          label="Reason (optional)"
          value={form.reason}
          placeholder="Add a note for your manager"
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          onClick={async () => {
            if (!form.start_date || !form.end_date) {
              toast.error("Pick a start and end date");
              return;
            }
            const result = await act("apply_leave", form);
            toast[result.ok ? "success" : "error"](
              result.ok ? "Leave request sent to your manager" : result.message,
            );
            if (result.ok) setApplyOpen(false);
          }}
          className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          Send request
        </button>
      </Sheet>
    </div>
  );
}

function AttendanceTab() {
  const { state, act } = useHr();
  const [target, setTarget] = useState<string | null>(null);
  const [form, setForm] = useState({ clock_in: "09:30", clock_out: "18:30", reason: "" });

  if (!state) return <LoadingPanel />;

  const records = state.attendance
    .filter((r) => r.status !== "future" && r.status !== "weekend")
    .slice()
    .reverse();

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        You can fix {state.regularizations_this_month.remaining} more{" "}
        {state.regularizations_this_month.remaining === 1 ? "day" : "days"} this month, out of{" "}
        {state.regularizations_this_month.allowance}.
      </p>
      {records.length === 0 && (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          Nothing to fix here — your attendance is clean.
        </p>
      )}
      {records.map((record) => (
        <div key={record.date} className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium text-foreground">
                {format(parseISO(record.date), "EEE, d MMM")}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {record.clock_in ?? "--:--"} – {record.clock_out ?? "--:--"}
              </p>
              {record.flag_reason && (
                <p className="mt-1 text-[12px] text-warning">{record.flag_reason}</p>
              )}
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-1 text-[11px] font-medium capitalize",
                record.status === "flagged"
                  ? "bg-warning/10 text-warning"
                  : record.status === "absent"
                    ? "bg-destructive/10 text-destructive"
                    : record.status === "wfh"
                      ? "bg-primary-light text-primary-dark"
                      : "bg-success/10 text-success",
              )}
            >
              {record.regularized ? "Regularized" : record.status}
            </span>
          </div>
          {record.status === "flagged" && !record.regularized && (
            <button
              onClick={() => setTarget(record.date)}
              className="mt-3 h-9 rounded-full border border-border px-4 text-[13px] font-medium text-primary"
            >
              Fix this day
            </button>
          )}
        </div>
      ))}

      <Sheet open={target !== null} onClose={() => setTarget(null)} title="Fix an attendance day">
        <p className="text-[13px] text-muted-foreground">
          {target ? pretty(target) : ""} — your manager approves this (called regularization in HR).
        </p>
        <Field
          label="Clock in"
          type="time"
          value={form.clock_in}
          onChange={(e) => setForm({ ...form, clock_in: e.target.value })}
        />
        <Field
          label="Clock out"
          type="time"
          value={form.clock_out}
          onChange={(e) => setForm({ ...form, clock_out: e.target.value })}
        />
        <Field
          label="Reason"
          value={form.reason}
          placeholder="e.g. Forgot to clock out"
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          onClick={async () => {
            if (!target) return;
            if (!form.reason.trim()) {
              toast.error("Add a reason so your manager can approve it");
              return;
            }
            const result = await act("regularize_attendance", { date: target, ...form });
            toast[result.ok ? "success" : "error"](
              result.ok ? "Attendance fix sent for approval" : result.message,
            );
            if (result.ok) setTarget(null);
          }}
          className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          Send for approval
        </button>
      </Sheet>
    </div>
  );
}

function WfhTab() {
  const { state, act } = useHr();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: "", reason: "" });

  if (!state) return <LoadingPanel />;

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        You have {state.wfh_this_month.remaining} of {state.wfh_this_month.allowance} work-from-home
        days left this month.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground active:bg-primary-dark"
      >
        Request work from home
      </button>
      {state.wfh_requests.length === 0 && (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          No work-from-home requests yet.
        </p>
      )}
      {state.wfh_requests
        .slice()
        .reverse()
        .map((request) => (
          <div
            key={request.id}
            className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
          >
            <div>
              <p className="text-[15px] font-medium text-foreground">{pretty(request.date)}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{request.reason}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusPill status={request.status} />
              {request.status === "Pending" && (
                <button
                  onClick={async () => {
                    const result = await act("cancel_wfh", { request_id: request.id });
                    toast[result.ok ? "success" : "error"](
                      result.ok ? "Work-from-home request cancelled" : result.message,
                    );
                  }}
                  className="text-[12px] font-medium text-destructive"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ))}

      <Sheet open={open} onClose={() => setOpen(false)} title="Request work from home">
        <Field
          label="Date"
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
        <Field
          label="Reason (optional)"
          value={form.reason}
          placeholder="Add a note for your manager"
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button
          onClick={async () => {
            if (!form.date) {
              toast.error("Pick a date");
              return;
            }
            const result = await act("apply_wfh", form);
            toast[result.ok ? "success" : "error"](
              result.ok ? "Work-from-home request sent" : result.message,
            );
            if (result.ok) setOpen(false);
          }}
          className="h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        >
          Send request
        </button>
      </Sheet>
    </div>
  );
}

function RequestsScreen() {
  const [tab, setTab] = useState<Tab>("leave");

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 pb-3 pt-4">
        <h1 className="text-[17px] font-semibold text-foreground">Requests</h1>
        <p className="text-[12px] text-muted-foreground">
          Everything you've asked for, and where it stands.
        </p>
        <div className="mt-3 flex rounded-full bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-8 flex-1 rounded-full text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="px-4 py-4">
        {tab === "leave" && <LeaveTab />}
        {tab === "attendance" && <AttendanceTab />}
        {tab === "wfh" && <WfhTab />}
      </div>
    </div>
  );
}
