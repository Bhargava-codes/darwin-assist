import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  AGENT_META,
  AgentBar,
  HairlineGrid,
  Metric,
  Panel,
  SectionHead,
  type AgentKey,
} from "@/components/ops/primitives";
import type { OpsPayload } from "@/lib/ops/types";

export const Route = createFileRoute("/ops/")({
  head: () => ({
    meta: [
      { title: "Agent health — hrlens HR Ops console" },
      {
        name: "description",
        content:
          "Value, engagement, performance and cost for the HR assistant, over the raw session log: deflection, feedback, latency P95s, per-agent spend and step-level traces.",
      },
      { property: "og:title", content: "Agent health — hrlens HR Ops console" },
      {
        property: "og:description",
        content: "Deflection, latency P95s, per-agent cost and step-level session traces.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpsConsole,
});

const AGENTS: AgentKey[] = ["agent_1", "agent_2", "agent_3"];

const ms = (value: number) => `${Math.round(value)}ms`;
const sec = (value: number) => `${(value / 1000).toFixed(2)}s`;
const usd = (value: number) => `$${value.toFixed(value < 0.1 ? 4 : 3)}`;
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;

/* ------------------------------------------------------------------- top bar */

function TopBar() {
  return (
    <div className="flex h-[100px] w-full items-center gap-8 bg-ops-shell px-8">
      <div className="flex shrink-0 items-baseline gap-3">
        <span className="font-mono text-[18px] font-bold text-ops-violet-bright">▎▎▎ hrlens</span>
        <span className="font-mono text-[11px] text-ops-faint">darwinbox · prod</span>
      </div>

      <div className="flex flex-1 justify-center">
        <label className="flex h-9 w-full max-w-[520px] items-center gap-2 bg-ops-shell-field px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-ops-faint" />
          <input
            type="search"
            placeholder="Search by session_id or employee_code"
            className="h-full flex-1 bg-transparent font-mono text-[12px] text-ops-shell-text placeholder:text-ops-faint focus:outline-none"
          />
          <span className="shrink-0 border border-ops-shell-line px-1.5 py-0.5 font-mono text-[10px] text-ops-faint">
            Cmd K
          </span>
        </label>
      </div>

      <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-ops-violet font-mono text-[11px] font-bold text-white">
        HR
      </div>
    </div>
  );
}

/* ------------------------------------------------- section 05 · sessions */

type EngineSessionRow = {
  id: string;
  employee_code: string;
  employee_name: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
  cost_usd: number;
  /** Average model latency per turn in this session. */
  latency_ms: number;
  /** Wall-clock session length from first to last activity. */
  duration_ms: number;
  baseline_mode: boolean;
  title: string;
  events: number;
  per_agent: Record<AgentKey, number | null>;
  rag: number;
  tools: number;
  feedback: "up" | "down" | null;
};

/** Every engine conversation, keyed by the session_id the employee app shows. */
function EngineSessions() {
  const [rows, setRows] = useState<EngineSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/ops/engine-sessions");
        const body = (await response.json()) as { sessions?: EngineSessionRow[]; error?: string };
        if (!response.ok) {
          setError(body.error ?? "Could not load the session log.");
          return;
        }
        setRows(body.sessions ?? []);
      } catch {
        setError("Could not load the session log.");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter(
      (row) =>
        row.id.toLowerCase().includes(q) ||
        row.employee_code.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q),
    );
  }, [query, rows]);

  return (
    <section>
      <SectionHead
        index="05"
        title="Sessions"
        hint="latest first · open a session for its full transcript"
      />
      <div className="mb-3 flex items-center gap-2">
        <label className="flex h-8 w-full max-w-[420px] items-center gap-2 border border-ops-line bg-ops-surface px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ops-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by session_id, employee_code or first message"
            className="h-full flex-1 bg-transparent font-mono text-[11px] text-ops-ink placeholder:text-ops-faint focus:outline-none"
          />
        </label>
      </div>
      {error && <p className="text-[12px] text-ops-rose">{error}</p>}
      {!rows && !error && <p className="text-[12px] text-ops-muted">Reading the session log…</p>}
      {rows && (
        <div className="overflow-x-auto border border-ops-line bg-ops-surface">
          <table className="w-full min-w-[1120px] border-collapse">
            <thead>
              <tr className="bg-ops-hairline">
                {[
                  ["Session ID", "left"],
                  ["Avg turn latency", "right"],
                  ["Duration", "right"],
                  ["A1", "right"],
                  ["A2", "right"],
                  ["A3", "right"],
                  ["RAG", "right"],
                  ["Tools", "right"],
                  ["FB", "right"],
                  ["Cost", "right"],
                  ["First message", "left"],
                ].map(([label, align]) => (
                  <th
                    key={label}
                    className={cn(
                      "px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ops-muted",
                      align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-ops-line transition-colors hover:bg-ops-hairline"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to="/ops/sessions/$sessionId"
                      params={{ sessionId: row.id }}
                      className="flex items-center gap-2 font-mono text-[11px] text-ops-ink underline-offset-2 hover:underline"
                    >
                      <ChevronRight className="h-3.5 w-3.5 text-ops-faint" />
                      {row.id}
                      {row.baseline_mode && (
                        <span className="border border-ops-line px-1 font-mono text-[10px] text-ops-faint">
                          baseline
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ops-ink">
                    {(row.latency_ms / 1000).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ops-muted">
                    {`${(row.duration_ms / 1000).toFixed(1)}s`}
                  </td>
                  {AGENTS.map((agent) => (
                    <td
                      key={agent}
                      className={cn(
                        "px-4 py-2.5 text-right font-mono text-[12px] tabular-nums",
                        row.per_agent?.[agent] == null ? "text-ops-faint" : AGENT_META[agent].text,
                      )}
                    >
                      {row.per_agent?.[agent] ?? "—"}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ops-muted">
                    {row.rag}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ops-muted">
                    {row.tools}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.feedback === "up" ? (
                      <ThumbsUp className="ml-auto h-3.5 w-3.5 text-ops-emerald" />
                    ) : row.feedback === "down" ? (
                      <ThumbsDown className="ml-auto h-3.5 w-3.5 text-ops-rose" />
                    ) : (
                      <span className="font-mono text-[12px] text-ops-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ops-muted">
                    {usd(row.cost_usd)}
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-2.5 text-[12px] text-ops-muted">
                    {row.title}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && filtered.length === 0 && (
        <p className="mt-2 text-[12px] text-ops-faint">No sessions match that filter.</p>
      )}
    </section>
  );
}


/* -------------------------------------------------------------------- page */


function OpsConsole() {
  const [data, setData] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) {
          setError("Open the employee app first so your session is ready, then reload this page.");
          return;
        }
        const response = await fetch("/api/ops", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await response.json()) as OpsPayload & { error?: string };
        if (!response.ok) {
          setError(body.error ?? "Could not load the session log.");
          return;
        }
        setData(body);
      } catch {
        setError("Could not load the session log.");
      }
    })();
  }, []);

  const latencyScale = 4000;
  const costMax = useMemo(
    () => Math.max(0.0001, ...(data?.cost.agents ?? []).map((a) => a.usd)),
    [data],
  );

  return (
    <div className="min-h-screen bg-ops-bg pb-16">
      <TopBar />

      <div className="px-8 pt-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ops-faint">
          prod / observability · last 7 days
        </p>
        <h1 className="mt-2 text-[24px] font-semibold text-ops-ink">Agent health</h1>
        <p className="mt-1 text-[14px] text-ops-muted">
          Value, then engagement, then performance, then cost — over the raw session log.
        </p>
      </div>

      {error && (
        <p className="mx-8 mt-8 border border-ops-line bg-ops-surface p-4 text-[13px] text-ops-rose">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="mx-8 mt-12 text-[13px] text-ops-muted">Reading the session log…</p>
      )}

      {data && (
        <div className="space-y-8 px-8 pt-8">
          {/* 01 · VALUE */}
          <section>
            <SectionHead
              index="01"
              title="Value"
              hint="are users gaining value from the agent?"
            />
            <HairlineGrid className="grid-cols-1 md:grid-cols-3">
              <Metric
                label="Deflection"
                value={`${data.value.deflection_pct}%`}
                sub={`${data.value.resolved} of ${data.value.total} resolved without HR`}
                size="big"
                tone="text-ops-emerald"
                tip="Share of conversations closed without human escalation. The core value the agent delivers."
              />
              <Metric
                label="Explicit feedback"
                value={`${data.value.feedback_pct}%`}
                size="big"
                tip="Share of sessions where the employee gave a thumbs up or down, split by sentiment."
              >
                <FeedbackBar
                  up={data.value.feedback_up}
                  down={data.value.feedback_down}
                  total={Math.max(1, data.value.total)}
                />
              </Metric>
              <Metric
                label="D7 retention"
                value={`${data.value.d7_pct}%`}
                sub={data.value.d7_maturing ? "cohort still maturing" : "returned after 7 days"}
                size="big"
                tone="text-ops-strong"
                tip="Share of first-time users who returned 7 days later. On a 7-day-old system the cohort is still forming — read as directional."
              />
            </HairlineGrid>
          </section>

          {/* 02 · ENGAGEMENT */}
          <section>
            <SectionHead
              index="02"
              title="Engagement"
              hint="are users engaging with the agent?"
            />
            <HairlineGrid className="grid-cols-1 md:grid-cols-2">
              <Metric
                label="Conversations"
                value={String(data.engagement.conversations)}
                sub="last 7 days"
                size="big"
                tip="Total sessions started in the window."
              />
              <Metric
                label="AHT"
                value={duration(data.engagement.aht_seconds)}
                sub="avg handle time per session"
                size="big"
                tip="Average time from the first message to the last activity on resolved sessions."
              />
            </HairlineGrid>
          </section>

          {/* 03 · TECHNICAL */}
          <section>
            <SectionHead
              index="03"
              title="Technical"
              hint="how long does the user wait, and what runs?"
            />
            <div className="space-y-4">
              <HairlineGrid className="grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Per-turn latency"
                  value={sec(data.technical.per_turn_p95_ms)}
                  sub="the true wait per reply"
                  size="big"
                  tip="Session latency divided by turns — how long the user actually waits each time they speak. The honest experienced number, normalized for conversation length."
                />
                <Metric
                  label="Turn 1"
                  value={sec(data.technical.turn1_p95_ms)}
                  sub="P95 · first reply"
                  tip="P95 latency of the first reply in a session, before any context is warm."
                />
                <Metric
                  label="Turn 2"
                  value={sec(data.technical.turn2_p95_ms)}
                  sub="P95 · context warm"
                  tip="P95 latency of the second reply, once session context is loaded."
                />
                <Metric
                  label="Session total"
                  value={sec(data.technical.session_p95_ms)}
                  sub={`P95 · ~${data.technical.avg_turns} turns`}
                  tone="text-ops-faint"
                  tip="Total wait summed across the whole conversation. Not felt at once — the user experiences it as the per-turn figure, this many times."
                />
              </HairlineGrid>

              <Panel
                title="Per-agent latency & interactions"
                tip="P95 latency and total invocations per agent. Agent 2 (RAG) and Agent 3 (tools) run in parallel, so session latency is bounded by the slower, not the sum."
              >
                {data.technical.agents.map((row) => (
                  <AgentBar
                    key={row.agent}
                    agent={row.agent}
                    fraction={row.p95_ms / latencyScale}
                    value={ms(row.p95_ms)}
                    meta={`${row.calls} calls`}
                  />
                ))}
              </Panel>

              <HairlineGrid className="grid-cols-1 md:grid-cols-2">
                <Metric
                  label="Tool calls"
                  value={String(data.technical.tool_calls)}
                  sub="7 days · the end outcome"
                  tip="Every HR tool invocation Agent 3 executed in the window."
                />
                <Metric
                  label="RAG pulls"
                  value={String(data.technical.rag_pulls)}
                  sub="policy retrievals"
                  tip="Policy retrievals run against the embedded corpus."
                />
              </HairlineGrid>
            </div>
          </section>

          {/* 04 · COST */}
          <section>
            <SectionHead index="04" title="Cost" hint="what does the agent cost to run?" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <HairlineGrid className="grid-cols-1 lg:col-span-1">
                <Metric
                  label="Cost / session"
                  value={`$${data.cost.per_session_usd.toFixed(4)}`}
                  sub="avg, optimized"
                  tip="Total spend divided by sessions, using the routed multi-model path."
                />
                <Metric
                  label="Total · 7 days"
                  value={`$${data.cost.total_usd.toFixed(3)}`}
                  sub={`${data.cost.sessions} sessions`}
                  tip="Summed model spend across every turn in the window."
                />
              </HairlineGrid>
              <div className="lg:col-span-2">
                <Panel
                  title="Cost split by agent"
                  tip="Where the spend goes. Agent 2 carries the RAG context; Agent 1 runs every turn."
                >
                  {data.cost.agents.map((row) => (
                    <AgentBar
                      key={row.agent}
                      agent={row.agent}
                      fraction={row.usd / costMax}
                      value={usd(row.usd)}
                      meta={`${row.share_pct}%`}
                    />
                  ))}
                </Panel>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 05 · SESSIONS — reads the engine log directly, so it renders even
          when the legacy metrics feed is unavailable. */}
      <div className="px-8 pt-8">
        <EngineSessions />
      </div>

    </div>
  );
}

function FeedbackBar({ up, down, total }: { up: number; down: number; total: number }) {
  const upPct = (up / total) * 100;
  const downPct = (down / total) * 100;
  return (
    <div className="mt-3">
      <div className="flex h-0.5 w-full bg-ops-line">
        <div className="h-0.5 bg-ops-emerald" style={{ width: `${upPct}%` }} />
        <div className="h-0.5 bg-ops-rose" style={{ width: `${downPct}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums">
        <span className="flex items-center gap-1.5 text-ops-emerald">
          <span className="h-2 w-2 bg-ops-emerald" /> {up} up
        </span>
        <span className="text-ops-rose">{down} down</span>
      </div>
    </div>
  );
}
