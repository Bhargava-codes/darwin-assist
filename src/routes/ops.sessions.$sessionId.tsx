import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SessionConfig,
  TraceLog,
  Transcript,
  Waterfall,
  ms,
  usd,
  type SessionMeta,
  type TraceEvent,
  type TranscriptMessage,
} from "@/components/ops/transcript";

export const Route = createFileRoute("/ops/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session transcript — hrlens HR Ops console" },
      {
        name: "description",
        content:
          "Full turn-by-turn transcript of one HR assistant session: employee messages, agent replies, policy lookups and tool executions with latency and cost.",
      },
      { property: "og:title", content: "Session transcript — hrlens HR Ops console" },
      {
        property: "og:description",
        content: "Every agent interaction and user query for one session, in sequence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionTranscriptPage,
});

const TABS = ["Transcript", "Trace log", "Waterfall", "Config"] as const;
type Tab = (typeof TABS)[number];

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 border border-ops-line bg-ops-surface px-2 py-1 font-mono text-[12px] text-ops-ink transition-colors hover:bg-ops-hairline"
    >
      {value}
      {copied ? (
        <Check className="h-3.5 w-3.5 text-ops-emerald" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-ops-faint" />
      )}
    </button>
  );
}

function SessionTranscriptPage() {
  const { sessionId } = useParams({ from: "/ops/sessions/$sessionId" });
  const [tab, setTab] = useState<Tab>("Transcript");
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/ops/engine-sessions?session_id=${encodeURIComponent(sessionId)}`,
        );
        const body = (await response.json()) as {
          session?: SessionMeta;
          events?: TraceEvent[];
          messages?: TranscriptMessage[];
          error?: string;
        };
        if (!live) return;
        if (!response.ok || !body.session) {
          setError(
            response.status === 404
              ? "That session ID does not exist in the engine log."
              : (body.error ?? "Could not load this transcript."),
          );
          return;
        }
        setSession(body.session);
        setEvents(body.events ?? []);
        setMessages(body.messages ?? []);
      } catch {
        if (live) setError("Could not load this transcript.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-ops-bg pb-16">
      <div className="border-b border-ops-line bg-ops-surface px-8 py-5">
        <Link
          to="/ops"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ops-muted transition-colors hover:text-ops-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to agent health
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">
              session_id
            </span>
            <CopyId value={sessionId} />
          </div>
          {session && (
            <>
              <Meta label="employee" value={`${session.employee_code} · ${session.employee_name}`} />
              <Meta label="turns" value={String(session.turn_count)} />
              <Meta label="steps" value={String(events.length)} />
              <Meta label="cost" value={usd(session.cost_usd)} />
              <Meta label="latency" value={ms(session.latency_ms)} />
              <Meta label="created" value={new Date(session.created_at).toLocaleString()} />
              <Meta label="last active" value={new Date(session.last_active_at).toLocaleString()} />
            </>
          )}
        </div>
      </div>

      <div className="flex gap-px border-b border-ops-line bg-ops-line px-8">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
              tab === item
                ? "bg-ops-bg text-ops-ink"
                : "bg-ops-surface text-ops-faint hover:text-ops-muted",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="px-8 pt-6">
        {loading && <p className="text-[12px] text-ops-muted">Reading the transcript…</p>}
        {error && (
          <p className="border border-ops-line bg-ops-surface p-4 text-[13px] text-ops-rose">
            {error}
          </p>
        )}
        {!loading && !error && session && (
          <>
            {tab === "Transcript" && <Transcript messages={messages} events={events} />}
            {tab === "Trace log" && <TraceLog events={events} />}
            {tab === "Waterfall" && <Waterfall events={events} />}
            {tab === "Config" && <SessionConfig session={session} events={events} />}
          </>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ops-faint">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-ops-ink">{value}</span>
    </span>
  );
}
