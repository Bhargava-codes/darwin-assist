import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowRight, Clock } from "lucide-react";
import { useHr } from "@/lib/hr/store";
import { LEAVE_TYPE_LABEL } from "@/lib/hr/types";
import { LoadingPanel } from "@/components/app/LoadingPanel";
import { pretty, prettyShort } from "@/lib/hr/dates";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Darwinbox HR Assistant — Leave, Attendance & WFH" },
      {
        name: "description",
        content:
          "See your leave balance, clock in and out, and keep track of attendance and work-from-home requests in one place.",
      },
      { property: "og:title", content: "Darwinbox HR Assistant" },
      {
        property: "og:description",
        content: "Your leave balance, clock-in and requests — all in one place.",
      },
    ],
  }),
  component: HomeScreen,
});

function HomeScreen() {
  const { state, employee, setDraft, toggleClock } = useHr();
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");

  if (!state || !employee) return <LoadingPanel />;

  const pending = [
    ...state.leave_requests.filter((r) => r.status === "Pending"),
    ...state.wfh_requests.filter((r) => r.status === "Pending"),
  ];

  const submitAsk = () => {
    const value = ask.trim();
    if (!value) return;
    setDraft(value);
    setAsk("");
    void navigate({ to: "/assistant" });
  };

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-6">
      <header>
        <p className="text-[13px] text-muted-foreground">{format(new Date(), "EEEE, d MMMM")}</p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-foreground">
          Hi {employee.name}
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Here's where you stand today.</p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Clock className="size-3.5" />
              {state.clocked_in_at ? "You're clocked in" : "You haven't clocked in yet"}
            </p>
            <p className="mt-1 text-[20px] font-semibold text-foreground">
              {state.clocked_in_at
                ? `Since ${format(new Date(state.clocked_in_at), "h:mm a")}`
                : state.last_clock_out
                  ? `You clocked out at ${format(new Date(state.last_clock_out), "h:mm a")}`
                  : "--:--"}
            </p>
          </div>
          <button
            onClick={toggleClock}
            className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground active:bg-primary-dark"
          >
            {state.clocked_in_at ? "Clock out" : "Clock in"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your leave balance
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ["CL", "Casual"],
              ["SL", "Sick"],
              ["EL", "Earned"],
            ] as const
          ).map(([type, name]) => (
            <div key={type} className="rounded-2xl border border-border bg-card p-3 shadow-card">
              <p className="text-[11px] font-medium text-muted-foreground">{name}</p>
              <p className="mt-1 text-[22px] font-semibold text-foreground">
                {state.balances[type].available}
              </p>
              <p className="text-[11px] text-muted-foreground">
                left of {state.balances[type].total}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-[12px] text-muted-foreground">Work from home</p>
          <p className="mt-1 text-[18px] font-semibold text-foreground">
            {state.wfh_this_month.used} of {state.wfh_this_month.allowance} used
          </p>
          <p className="text-[11px] text-muted-foreground">this month</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-[12px] text-muted-foreground">Attendance fixes</p>
          <p className="mt-1 text-[18px] font-semibold text-foreground">
            {state.regularizations_this_month.used} of{" "}
            {state.regularizations_this_month.allowance} used
          </p>
          <p className="text-[11px] text-muted-foreground">this month</p>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Waiting on your manager
        </h2>
        <div className="mt-3 space-y-2">
          {pending.length === 0 && (
            <p className="text-[14px] text-muted-foreground">
              Nothing waiting for approval right now.
            </p>
          )}
          {pending.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 shadow-card"
            >
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  {"type" in request ? LEAVE_TYPE_LABEL[request.type] : "Work from home"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {"start_date" in request && request.start_date
                    ? `${prettyShort(request.start_date)} – ${pretty(request.end_date)}`
                    : "date" in request && request.date
                      ? pretty(request.date)
                      : "—"}
                </p>
              </div>
              <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning">
                Pending
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-auto">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-2 shadow-card">
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAsk();
            }}
            placeholder="Ask about leave, attendance or WFH"
            className="h-9 flex-1 bg-transparent px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={submitAsk}
            aria-label="Ask the assistant"
            className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
        {employee.is_hr_ops && (
          <Link
            to="/ops"
            className="mt-3 block text-center text-[12px] font-medium text-muted-foreground underline"
          >
            Open the HR Ops console
          </Link>
        )}
      </section>
    </div>

  );
}
