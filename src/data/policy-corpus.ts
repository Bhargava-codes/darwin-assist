/**
 * Darwinbox HR Policy Manual — FY26-v2 — RAG corpus.
 *
 * Verbatim source of truth for Agent 2. Chunking is clause-aware: one chunk per
 * subsection, each self-contained with its heading and tagged with its
 * clause_id. Splitting mid-clause fragments an entitlement and produces
 * confidently wrong answers, so keep each chunk whole.
 *
 * Retrieval embeds `heading + text` per chunk (see src/lib/hr/retrieval.ts).
 */

export const POLICY_VERSION = "FY26-v2";

export type PolicySubject =
  | "LEAVE.CL"
  | "LEAVE.SL"
  | "LEAVE.EL"
  | "LEAVE.ML"
  | "LEAVE.PL"
  | "LEAVE.BL"
  | "LEAVE.UL"
  | "LEAVE.GENERAL"
  | "ATTENDANCE.WORKING_HOURS"
  | "ATTENDANCE.CLOCK_IN_OUT"
  | "ATTENDANCE.REGULARIZATION"
  | "ATTENDANCE.LATE_ARRIVAL"
  | "ATTENDANCE.HALF_DAY_LOP"
  | "WFH.ELIGIBILITY"
  | "WFH.ENTITLEMENT"
  | "WFH.CONDITIONS"
  | "WFH.EXTENDED"
  | "GENERAL.PROVISIONS";

export type PolicyChunk = {
  clause_id: string;
  heading: string;
  subject: PolicySubject;
  keywords: string[];
  text: string;
};

export const POLICY_CORPUS: PolicyChunk[] = [
  {
    clause_id: "1.1",
    heading: "1.1 Leave Types & Entitlement",
    subject: "LEAVE.GENERAL",
    keywords: [
      "leave types",
      "entitlement",
      "how many leaves",
      "annual entitlement",
      "contract employees",
      "interns",
      "unpaid leave",
      "ul",
    ],
    text: `1.1 Leave Types & Entitlement

Casual Leave (CL) — 12 days/year — Eligibility: All full-time employees, from day of joining — Consecutive-Day Cap: 3 consecutive days
Sick Leave (SL) — 12 days/year — Eligibility: All full-time employees, from day of joining — Consecutive-Day Cap: 5 consecutive days without medical certificate; beyond 5, medical certificate required
Earned Leave (EL) — 18 days/year (1.5/month, accrued monthly) — Eligibility: Full-time employees who have completed 3 months' tenure — Consecutive-Day Cap: No cap; subject to balance
Maternity Leave (ML) — 26 weeks — Eligibility: Full-time women employees, no minimum tenure requirement — Consecutive-Day Cap: Not applicable
Paternity Leave (PL) — 10 working days — Eligibility: Full-time male employees, from day of joining — Consecutive-Day Cap: Must be availed within 3 months of childbirth
Bereavement Leave (BL) — 5 days — Eligibility: All full-time employees — Consecutive-Day Cap: Immediate family only (spouse, parent, child, sibling)
Unpaid Leave (UL) — No cap, subject to manager approval — Eligibility: All employees — Consecutive-Day Cap: Requires HR approval beyond 10 consecutive days

Note on Contract Employees: Employees on fixed-term contracts and interns are entitled to Sick Leave and Casual Leave only, pro-rated at 1 day per completed month. Contract employees are not eligible for Earned Leave, Maternity Leave, Paternity Leave, or Bereavement Leave under this policy — these are governed separately by the employee's contract terms, if applicable.`,
  },
  {
    clause_id: "1.2",
    heading: "1.2 Casual Leave (CL)",
    subject: "LEAVE.CL",
    keywords: ["casual leave", "cl", "casual", "3 consecutive days", "lapses"],
    text: `1.2 Casual Leave (CL)

- Credited in full at the start of the calendar year; not accrued monthly.
- Cannot be combined with Earned Leave to exceed the 3-day consecutive cap — a request spanning more than 3 consecutive days cannot use CL for any part of that stretch.
- Does not carry forward. Unused CL lapses on 31 March each year.
- No reason is required to apply for CL.`,
  },
  {
    clause_id: "1.3",
    heading: "1.3 Sick Leave (SL)",
    subject: "LEAVE.SL",
    keywords: ["sick leave", "sl", "medical certificate", "self-declaration", "illness"],
    text: `1.3 Sick Leave (SL)

- Credited in full at the start of the calendar year.
- For absences of 1–2 days, a self-declaration is sufficient.
- For absences of 3 days or more, a medical certificate must be uploaded within 3 working days of return.
- Does not carry forward. Unused SL lapses on 31 March each year.
- SL cannot be used for planned/elective procedures without prior manager notification.`,
  },
  {
    clause_id: "1.4",
    heading: "1.4 Earned Leave (EL)",
    subject: "LEAVE.EL",
    keywords: [
      "earned leave",
      "el",
      "carry forward",
      "carry-forward",
      "accrual",
      "encashment",
      "encashed",
      "tenure",
    ],
    text: `1.4 Earned Leave (EL)

- Accrues at 1.5 days per completed month of service, credited on the 1st of each month.
- Employees become eligible to apply only after completing 3 months of continuous service; leave continues to accrue from day 1 but cannot be availed before the 3-month mark.
- Carries forward up to a maximum of 30 days into the next calendar year. Any balance beyond 30 days is encashed at year-end as per the standard payroll calculation.
- EL is the only leave type that may be availed for more than 3 consecutive days without additional approval, subject to balance.
- On resignation, unutilized EL (up to the carry-forward cap) is paid out as part of full and final settlement. CL and SL are not encashed under any circumstance.`,
  },
  {
    clause_id: "1.5",
    heading: "1.5 Maternity Leave (ML)",
    subject: "LEAVE.ML",
    keywords: ["maternity leave", "ml", "maternity", "adoptive mothers", "commissioning mothers"],
    text: `1.5 Maternity Leave (ML)

- 26 weeks for the first two children; 12 weeks for the third child onward, in line with the Maternity Benefit Act as amended.
- May be availed up to 8 weeks before the expected date of delivery.
- Applicable to adoptive mothers (adopting a child below 3 months) and commissioning mothers, at 12 weeks.
- This policy's entitlement of 26 weeks reflects Darwinbox's own extension beyond the statutory minimum and applies uniformly regardless of the number of surviving children from prior pregnancies, subject to the two-child cap above.`,
  },
  {
    clause_id: "1.6",
    heading: "1.6 Paternity Leave (PL)",
    subject: "LEAVE.PL",
    keywords: ["paternity leave", "pl", "paternity", "childbirth", "blocks"],
    text: `1.6 Paternity Leave (PL)

- 10 working days, which may be split into a maximum of 2 blocks.
- Must be availed within 3 months of the child's date of birth; leave not availed within this window lapses and cannot be claimed later.`,
  },
  {
    clause_id: "1.7",
    heading: "1.7 Bereavement Leave (BL)",
    subject: "LEAVE.BL",
    keywords: ["bereavement leave", "bl", "bereavement", "immediate family", "death"],
    text: `1.7 Bereavement Leave (BL)

- 5 days per event, applicable only for immediate family as defined in 1.1.
- Extended family bereavement (grandparent, in-law, etc.) is not covered under BL and must be applied for as CL, SL, or UL depending on circumstances.`,
  },
  {
    clause_id: "1.8",
    heading: "1.8 Leave Application Process",
    subject: "LEAVE.GENERAL",
    keywords: [
      "leave application process",
      "apply in advance",
      "approval",
      "reporting manager",
      "past dates",
      "backdated",
    ],
    text: `1.8 Leave Application Process

- All leave (except emergency SL) must be applied at least 1 day in advance through the HR system.
- Applications route to the direct reporting manager for approval. HR is not the approving authority for standard leave.
- A leave request cannot be submitted for a date range that has already passed; use Attendance Regularization (Section 2.3) instead.`,
  },
  {
    clause_id: "2.1",
    heading: "2.1 Working Hours & Shift",
    subject: "ATTENDANCE.WORKING_HOURS",
    keywords: ["working hours", "shift", "core hours", "lunch break", "8 working hours"],
    text: `2.1 Working Hours & Shift

- Standard working hours: 9:30 AM – 6:30 PM, Monday to Friday, with a 1-hour lunch break.
- Core hours (mandatory presence, in-office or logged-in): 11:00 AM – 4:00 PM.
- Employees are expected to complete a minimum of 8 working hours per day, flexible around core hours.`,
  },
  {
    clause_id: "2.2",
    heading: "2.2 Clock In / Clock Out",
    subject: "ATTENDANCE.CLOCK_IN_OUT",
    keywords: ["clock in", "clock out", "punch", "biometric", "missed clock-out", "half-day mark"],
    text: `2.2 Clock In / Clock Out

- Attendance is logged via clock-in and clock-out in the mobile app or biometric terminal (for office-based roles).
- A missed clock-out is auto-flagged and defaults to a half-day mark unless regularized within 3 working days.
- Clocking in from a location other than the registered office or approved WFH location must be declared via the app.`,
  },
  {
    clause_id: "2.3",
    heading: "2.3 Attendance Regularization",
    subject: "ATTENDANCE.REGULARIZATION",
    keywords: [
      "regularization",
      "regularize",
      "forgot to punch",
      "missed entry",
      "3 times per calendar month",
      "5 working days",
    ],
    text: `2.3 Attendance Regularization

- Employees may regularize a missed or incorrect clock-in/out up to 3 times per calendar month. Requests beyond this cap require manager escalation and are not processed through self-service.
- Regularization requests must be raised within 5 working days of the missed entry; requests older than 5 working days are not accepted.
- A reason is mandatory for every regularization request — "forgot to punch" is an acceptable reason but must be stated explicitly.
- Approved regularizations do not count against leave balance.`,
  },
  {
    clause_id: "2.4",
    heading: "2.4 Late Arrivals & Early Departures",
    subject: "ATTENDANCE.LATE_ARRIVAL",
    keywords: ["late arrival", "late", "early departure", "4 unregularized late arrivals", "lop"],
    text: `2.4 Late Arrivals & Early Departures

- Arrival after 11:00 AM without prior notice to the manager is marked as late.
- 4 unregularized late arrivals in a calendar month convert automatically to 0.5 days of CL deduction; if CL balance is exhausted, LOP (Loss of Pay) applies.`,
  },
  {
    clause_id: "2.5",
    heading: "2.5 Half-Day & Leave Without Pay (LOP)",
    subject: "ATTENDANCE.HALF_DAY_LOP",
    keywords: ["half-day", "half day", "lop", "loss of pay", "fewer than 4 hours"],
    text: `2.5 Half-Day & Leave Without Pay (LOP)

- Working fewer than 4 hours in a day is marked as a half-day and deducts 0.5 day from CL/SL/EL balance in that order of priority.
- If no leave balance is available to offset a half-day or absence, it is marked as LOP and deducted from that month's payroll.`,
  },
  {
    clause_id: "3.1",
    heading: "3.1 WFH Eligibility",
    subject: "WFH.ELIGIBILITY",
    keywords: [
      "wfh eligibility",
      "work from home eligibility",
      "1 month of service",
      "floor presence",
      "interns",
    ],
    text: `3.1 Eligibility

- Full-time employees who have completed 1 month of service are eligible for WFH.
- Contract employees and interns are eligible for WFH only with explicit written manager approval; there is no standing entitlement.
- Roles requiring mandatory floor presence (e.g., facilities, front-desk, IT hardware support) are not eligible for WFH regardless of tenure.`,
  },
  {
    clause_id: "3.2",
    heading: "3.2 WFH Entitlement & Cadence",
    subject: "WFH.ENTITLEMENT",
    keywords: [
      "wfh days per month",
      "work from home entitlement",
      "8 wfh days",
      "manager approval",
      "not a leave type",
    ],
    text: `3.2 Entitlement & Cadence

- Employees may avail up to 8 WFH days per calendar month, non-carry-forward.
- WFH requests do not require HR policy approval — they require direct manager approval only, applied through the same system as leave.
- WFH is not a leave type and does not deduct from any leave balance.`,
  },
  {
    clause_id: "3.3",
    heading: "3.3 WFH Conditions",
    subject: "WFH.CONDITIONS",
    keywords: ["wfh conditions", "core hours on wfh", "reachable", "first month of joining"],
    text: `3.3 Conditions

- Core hours (11:00 AM – 4:00 PM) and clock-in/clock-out requirements apply identically on WFH days.
- Employees must be reachable via company communication tools during working hours.
- WFH is not applicable for the first month of joining (probation induction requires in-office presence) unless the offer letter states otherwise.`,
  },
  {
    clause_id: "3.4",
    heading: "3.4 Extended / Long-Term WFH",
    subject: "WFH.EXTENDED",
    keywords: ["extended wfh", "long-term wfh", "relocation", "hr business partner"],
    text: `3.4 Extended / Long-Term WFH

- WFH beyond 8 days in a month (e.g., medical necessity, relocation) requires a separate long-term WFH request, approved jointly by the manager and HR Business Partner, and is evaluated case-by-case. This is not processed through standard self-service and is outside the scope of this assistant.`,
  },
  {
    clause_id: "4.1",
    heading: "4.1 Policy Applicability",
    subject: "GENERAL.PROVISIONS",
    keywords: ["policy applicability", "india entity", "geographies", "addenda"],
    text: `4.1 Policy Applicability

This policy applies to the India entity only. Employees based in other geographies are governed by locally applicable addenda, not covered in this document.`,
  },
  {
    clause_id: "4.2",
    heading: "4.2 Escalation",
    subject: "GENERAL.PROVISIONS",
    keywords: ["escalation", "hr helpdesk", "exceptions", "retroactive approvals", "disputes"],
    text: `4.2 Escalation

Any request that does not fit the scenarios described above — including exceptions, retroactive approvals, or disputes with a manager's decision — should be routed to the HR Helpdesk and is outside the scope of self-service tools.`,
  },
  {
    clause_id: "4.3",
    heading: "4.3 Policy Precedence",
    subject: "GENERAL.PROVISIONS",
    keywords: ["policy precedence", "offer letter", "employment contract", "silent"],
    text: `4.3 Policy Precedence

Where this document conflicts with an individual's signed offer letter or employment contract, the offer letter/contract takes precedence. Where this document is silent on a matter, no entitlement should be assumed to exist.`,
  },
];
