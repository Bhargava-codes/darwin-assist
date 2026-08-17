import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AGENT_META, type AgentKey } from "@/components/ops/primitives";

export type TraceEvent = {
  turn_index: number;
  step_index: number;
  actor: string;
  action: string;
  model: string | null;
  mode: string | null;
  status: string;
  latency_ms: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  payload: unknown;
  result: unknown;
  created_at: string;
};

export type TranscriptMessage = {
  turn_index: number;
  role: string;
  actor: string | null;
  content: string;
  chips: unknown;
  citations: unknown;
  verdict: string | null;
  created_at: string;
};

export type SessionMeta = {
  id: string;
  employee_code: string;
  employee_name: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
  baseline_mode: boolean;
  cost_usd: number;
  /** Average model latency per turn. */
  latency_ms: number;
  /** Wall-clock session length. */
  duration_ms: number;
};

export const ms = (value: number) => `${Math.round(value)}ms`;
export const usd = (value: number) => `$${value.toFixed(value < 0.1 ? 4 : 3)}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function agentOf(actor: string): AgentKey | null {
  const a = actor.toLowerCase();
  if (a === "a1") return "agent_1";
  if (a === "a2" || a === "rag") return "agent_2";
  if (a === "a3" || a === "hrms") return "agent_3";
  return null;
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-ops-bg p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">{label}</p>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ops-muted">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/* --------------------------------------------------------------- transcript */

function UserBubble({ message }: { message: TranscriptMessage }) {
  return (
    <div className="max-w-[70%]">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">
        Employee · {time(message.created_at)}
      </p>
      <div className="border border-ops-line bg-ops-violet-soft px-3 py-2 text-[13px] leading-relaxed text-ops-ink">
        {message.content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  reply,
}: {
  message: TranscriptMessage;
  reply?: TraceEvent | undefined;
}) {
  return (
    <div className="ml-auto max-w-[70%]">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">
        <span className={cn("px-1.5", AGENT_META.agent_1.soft, AGENT_META.agent_1.text)}>A1</span>
        {reply?.model && <span className="border border-ops-line px-1.5">{reply.model}</span>}
        {reply && <span className="border border-ops-line px-1.5">{ms(reply.latency_ms)}</span>}
        {message.verdict && <span className="border border-ops-line px-1.5">{message.verdict}</span>}
        <span>{time(message.created_at)}</span>
      </div>
      <div className="border border-ops-line bg-ops-surface px-3 py-2 text-[13px] leading-relaxed text-ops-ink">
        {message.content}
      </div>
    </div>
  );
}

function SystemNote({ event }: { event: TraceEvent }) {
  const agent = agentOf(event.actor);
  const isTool = event.actor.toLowerCase() === "hrms";

  if (isTool) {
    return (
      <div className="mx-auto w-full max-w-[76%] border border-ops-amber-soft bg-ops-surface">
        <div className="flex items-center gap-2 border-b border-ops-line bg-ops-amber-soft px-3 py-1.5">
          <span className="font-mono text-[11px] text-ops-ink">{event.action}</span>
          <span
            className={cn(
              "px-1.5 font-mono text-[10px] uppercase",
              event.status === "ok" ? "text-ops-emerald" : "text-ops-rose",
            )}
          >
            {event.status}
          </span>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-ops-muted">
            {ms(event.latency_ms)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-px bg-ops-line lg:grid-cols-2">
          <Json label="args" value={event.payload} />
          <Json label="result" value={event.result} />
        </div>
      </div>
    );
  }

  return (
    <details className="mx-auto w-full max-w-[76%] border border-ops-line bg-ops-hairline">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5">
        {agent ? (
          <span className={cn("px-1.5 font-mono text-[10px]", AGENT_META[agent].soft, AGENT_META[agent].text)}>
            {event.actor.toUpperCase()}
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase text-ops-faint">{event.actor}</span>
        )}
        <span className="flex-1 truncate text-center text-[12px] text-ops-muted">
          {event.action}
        </span>
        <span
          className={cn(
            "font-mono text-[10px]",
            event.status === "ok" ? "text-ops-emerald" : "text-ops-rose",
          )}
        >
          {event.status}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-ops-faint">
          {ms(event.latency_ms)}
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-px border-t border-ops-line bg-ops-line lg:grid-cols-2">
        <Json label="input" value={event.payload} />
        <Json label="output" value={event.result} />
      </div>
    </details>
  );
}

export function Transcript({
  messages,
  events,
}: {
  messages: TranscriptMessage[];
  events: TraceEvent[];
}) {
  const [showSystem, setShowSystem] = useState(true);

  const turns = useMemo(() => {
    const indices = [
      ...new Set([...messages.map((m) => m.turn_index), ...events.map((e) => e.turn_index)]),
    ].sort((a, b) => a - b);
    return indices.map((index) => ({
      index,
      user: messages.filter((m) => m.turn_index === index && m.role === "user"),
      assistant: messages.filter((m) => m.turn_index === index && m.role !== "user"),
      steps: events
        .filter((e) => e.turn_index === index)
        .sort((a, b) => a.step_index - b.step_index),
    }));
  }, [messages, events]);

  if (turns.length === 0)
    return <p className="p-4 text-[12px] text-ops-muted">No steps recorded yet.</p>;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowSystem((v) => !v)}
          className="border border-ops-line bg-ops-surface px-2 py-1 font-mono text-[11px] text-ops-muted transition-colors hover:bg-ops-hairline"
        >
          {showSystem ? "Hide system & tool steps" : "Show system & tool steps"}
        </button>
        <span className="font-mono text-[11px] text-ops-faint">
          {turns.length} turns · {events.length} steps
        </span>
      </div>

      <div className="space-y-6">
        {turns.map((turn) => {
          const reply = turn.steps.find(
            (s) => s.actor.toLowerCase() === "a1" && s.action === "reply",
          );
          const inner = showSystem
            ? turn.steps.filter((s) => s !== reply)
            : [];
          return (
            <div key={turn.index} className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ops-faint">
                turn {turn.index}
              </p>
              {turn.user.map((m) => (
                <UserBubble key={`u-${m.created_at}`} message={m} />
              ))}
              {inner.map((step) => (
                <SystemNote key={`${step.turn_index}-${step.step_index}-${step.action}`} event={step} />
              ))}
              {turn.assistant.map((m) => (
                <AssistantBubble key={`a-${m.created_at}`} message={m} reply={reply} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- trace log */

export function TraceLog({ events }: { events: TraceEvent[] }) {
  if (events.length === 0)
    return <p className="p-4 text-[12px] text-ops-muted">No steps recorded yet.</p>;
  return (
    <div className="space-y-px border border-ops-line bg-ops-line">
      {events.map((event) => (
        <details
          key={`${event.turn_index}-${event.step_index}-${event.action}`}
          className="bg-ops-surface"
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-ops-hairline">
            <span className="w-8 font-mono text-[11px] tabular-nums text-ops-faint">
              T{event.turn_index}
            </span>
            <span className="w-16 font-mono text-[10px] uppercase text-ops-muted">{event.actor}</span>
            <span className="flex-1 truncate text-[12px] text-ops-ink">{event.action}</span>
            <span className="hidden w-40 truncate font-mono text-[10px] text-ops-faint md:block">
              {event.model ?? "—"}
            </span>
            <span
              className={cn(
                "shrink-0 font-mono text-[10px]",
                event.status === "ok" ? "text-ops-emerald" : "text-ops-rose",
              )}
            >
              {event.status}
            </span>
            <span className="w-14 text-right font-mono text-[11px] tabular-nums text-ops-muted">
              {ms(event.latency_ms)}
            </span>
            <span className="w-16 text-right font-mono text-[11px] tabular-nums text-ops-muted">
              {usd(event.cost_usd)}
            </span>
          </summary>
          <div className="grid grid-cols-1 gap-px border-t border-ops-line bg-ops-line lg:grid-cols-2">
            <Json label="input" value={event.payload} />
            <Json label="output" value={event.result} />
          </div>
        </details>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- waterfall */

export function Waterfall({ events }: { events: TraceEvent[] }) {
  const max = Math.max(1, ...events.map((e) => e.latency_ms));
  const turns = [...new Set(events.map((e) => e.turn_index))].sort((a, b) => a - b);
  if (events.length === 0)
    return <p className="p-4 text-[12px] text-ops-muted">No steps recorded yet.</p>;
  return (
    <div className="space-y-5">
      {turns.map((turn) => (
        <div key={turn} className="border border-ops-line bg-ops-surface p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ops-faint">
            turn {turn}
          </p>
          <div className="space-y-1.5">
            {events
              .filter((e) => e.turn_index === turn)
              .sort((a, b) => a.step_index - b.step_index)
              .map((event) => {
                const agent = agentOf(event.actor);
                return (
                  <div
                    key={`${event.step_index}-${event.action}`}
                    className="flex items-center gap-3"
                  >
                    <span className="w-40 shrink-0 truncate font-mono text-[11px] text-ops-muted">
                      {event.actor} · {event.action}
                    </span>
                    <span className="h-2 flex-1 bg-ops-hairline">
                      <span
                        className={cn("block h-2", agent ? AGENT_META[agent].bg : "bg-ops-line")}
                        style={{ width: `${Math.max(2, (event.latency_ms / max) * 100)}%` }}
                      />
                    </span>
                    <span className="w-16 text-right font-mono text-[11px] tabular-nums text-ops-faint">
                      {ms(event.latency_ms)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- config */

export function SessionConfig({
  session,
  events,
}: {
  session: SessionMeta;
  events: TraceEvent[];
}) {
  const models = [...new Set(events.map((e) => e.model).filter(Boolean))] as string[];
  const modes = [...new Set(events.map((e) => e.mode).filter(Boolean))] as string[];
  const rows: [string, string][] = [
    ["Session ID", session.id],
    ["Employee", `${session.employee_code} · ${session.employee_name}`],
    ["Mode", session.baseline_mode ? "baseline (single-shot)" : "multi-agent engine"],
    ["Models", models.length ? models.join(", ") : "—"],
    ["Retrieval modes", modes.length ? modes.join(", ") : "—"],
    ["Turns", String(session.turn_count)],
    ["Steps", String(events.length)],
    ["Total cost", usd(session.cost_usd)],
    ["Avg turn latency", ms(session.latency_ms)],
    ["Session duration", `${(session.duration_ms / 1000).toFixed(1)}s`],
    ["Created", new Date(session.created_at).toLocaleString()],
    ["Last active", new Date(session.last_active_at).toLocaleString()],
  ];
  return (
    <div className="space-y-px border border-ops-line bg-ops-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap gap-x-4 bg-ops-surface px-3 py-2">
          <span className="w-40 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">
            {label}
          </span>
          <span className="font-mono text-[12px] text-ops-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}
