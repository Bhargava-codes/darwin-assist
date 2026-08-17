import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { History, Mic, Plus, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useHr } from "@/lib/hr/store";
import type { AssistantTurn, PendingAction, Verdict } from "@/lib/ai/agent-types";
import { LEAVE_TYPE_LABEL, type LeaveType } from "@/lib/hr/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assistant/$sessionId")({
  head: () => ({
    meta: [
      { title: "Ask HR — Darwinbox HR Assistant" },
      {
        name: "description",
        content:
          "Ask about leave, attendance or working from home. Every answer comes from your HR policy, with the clause attached.",
      },
      { property: "og:title", content: "Ask HR — Darwinbox HR Assistant" },
      {
        property: "og:description",
        content: "Answers come straight from your HR policy, with the clause attached.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantScreen,
});

const STARTERS = [
  "I'm taking time off from 15th to 20th June",
  "I need 10 days casual leave",
  "Can I carry forward my leave?",
  "What's the sabbatical policy?",
  "What's my leave balance?",
];

const AMBIGUOUS = new Set([
  "ok","okay","hmm","sure","k","yeah","right","fine","alright","got it","haan","achha","thik hai",
]);

const VERDICT_LABEL: Record<Verdict, string> = {
  FULL: "Allowed",
  PARTIAL: "Needs a change",
  NONE: "Not allowed",
  UNKNOWN: "Not in policy",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const tone: Record<Verdict, string> = {
    FULL: "bg-success/10 text-success",
    PARTIAL: "bg-warning/10 text-warning",
    NONE: "bg-destructive/10 text-destructive",
    UNKNOWN: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tone[verdict],
      )}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** Turns "CL", "CL (7 available)" or "CL - Casual Leave" into plain language. */
function chipLabel(chip: string) {
  const match = chip.trim().match(/^([A-Z]{2})\b\s*(?:[-–—:]\s*[A-Za-z ]+)?\s*(.*)$/);
  if (!match) return chip;
  const label = LEAVE_TYPE_LABEL[match[1] as LeaveType];
  if (!label) return chip;
  return match[2] ? `${label} ${match[2]}`.trim() : label;
}



function ConfirmationCard({
  pending,
  onConfirm,
  onChange,
}: {
  pending: PendingAction;
  onConfirm: () => void;
  onChange: () => void;
}) {
  return (
    <div className="bubble-in mt-2 rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="text-[13px] font-semibold text-foreground">Check this before I submit</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{pending.title}</p>
      <dl className="mt-3 space-y-2">
        {pending.rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
            <dd className="text-right text-[14px] font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onConfirm}
          className="h-10 flex-1 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-colors active:bg-primary-dark"
        >
          Confirm and submit
        </button>
        <button
          onClick={onChange}
          className="h-10 flex-1 rounded-full text-sm font-medium text-muted-foreground transition-colors active:bg-muted"
        >
          Edit details
        </button>
      </div>
    </div>
  );
}

function AbstentionCard({ onRaise }: { onRaise: () => void }) {
  return (
    <div className="bubble-in mt-2 rounded-xl border border-border bg-muted/60 p-4">
      <p className="text-[13px] text-muted-foreground">
        I couldn't find this in your HR policy, so I won't guess. Your HR team can confirm.
      </p>
      <button
        onClick={onRaise}
        className="mt-3 h-9 rounded-full border border-border bg-card px-4 text-[13px] font-medium text-foreground"
      >
        Ask HR
      </button>
    </div>
  );
}

function FeedbackControl({ turn }: { turn: AssistantTurn }) {
  const { rate } = useHr();
  if (turn.turn_index === undefined) return null;
  const rated = turn.feedback ?? null;
  return (
    <div className="mt-2 flex items-center gap-1">
      {rated === null && (
        <span className="mr-1 text-[11px] text-muted-foreground">Was this helpful?</span>
      )}
      {rated !== null && (
        <span className="mr-1 text-[11px] text-muted-foreground">
          {rated === "up" ? "Glad that helped." : "Thanks — noted for HR."}
        </span>
      )}
      <button
        aria-label="This helped"
        aria-pressed={rated === "up"}
        onClick={() => void rate(turn.id, turn.turn_index!, "up")}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border border-border",
          rated === "up" ? "bg-success/10 text-success" : "text-muted-foreground",
        )}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        aria-label="This missed"
        aria-pressed={rated === "down"}
        onClick={() => void rate(turn.id, turn.turn_index!, "down")}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border border-border",
          rated === "down" ? "bg-destructive/10 text-destructive" : "text-muted-foreground",
        )}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  );
}

function AssistantMessage({ turn }: { turn: AssistantTurn }) {
  const { confirm, cancelPending, send, busy } = useHr();
  return (
    <div className="bubble-in max-w-[86%] self-start">
      <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 text-[15px] leading-relaxed text-foreground shadow-card">
        <p className="whitespace-pre-line">{turn.text}</p>
        {turn.verdict && turn.verdict !== "FULL" && (
          <div className="mt-2">
            <VerdictBadge verdict={turn.verdict} />
          </div>
        )}
      </div>
      {turn.abstain && <AbstentionCard onRaise={() => send("Raise this with HR")} />}
      {turn.pending && (
        <>
          <ConfirmationCard
            pending={turn.pending}
            onConfirm={() => void confirm(turn.pending!)}
            onChange={() => cancelPending(turn.id)}
          />
          <FeedbackControl turn={turn} />
        </>
      )}
      {turn.chips.length > 0 && !turn.pending && (
        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          {turn.chips.map((chip) => (
            <button
              key={chip}
              disabled={busy}
              onClick={() => void send(chip)}
              className="h-9 shrink-0 rounded-full border border-primary/25 bg-primary-light px-4 text-[13px] font-medium text-primary-dark disabled:opacity-50"
            >
              {chipLabel(chip)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


const shortId = (id: string) => id.slice(0, 8);

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

/** Past chats, newest first. Tapping one opens its own URL. */
function HistorySheet({ onClose }: { onClose: () => void }) {
  const { sessions, sessionId } = useHr();
  const navigate = useNavigate();
  // Empty chats are noise in a history list — only the one you're in shows.
  const visible = sessions.filter((s) => s.turn_count > 0 || s.id === sessionId);
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-foreground/30">
      <button aria-label="Close history" className="flex-1" onClick={onClose} />
      <div className="bubble-in max-h-[70vh] overflow-y-auto rounded-t-2xl bg-card px-4 pb-8 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Your chats</h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {visible.length === 0 && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Nothing here yet — this is your first chat.
          </p>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {visible.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  onClose();
                  void navigate({ to: "/assistant/$sessionId", params: { sessionId: s.id } });
                }}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left",
                  s.id === sessionId ? "border-primary bg-primary-light" : "border-border bg-card",
                )}
              >
                <p className="truncate text-[14px] font-medium text-foreground">{s.title}</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {shortId(s.id)} · {s.turn_count} {s.turn_count === 1 ? "turn" : "turns"} ·{" "}
                  {relative(s.last_active_at)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AssistantScreen() {
  const { sessionId: routeSessionId } = Route.useParams();
  const {
    messages,
    send,
    busy,
    stage,
    streamingReply,
    error,
    draft,
    setDraft,
    openSession,
    newSession,
    sessionId,
  } =
    useHr();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [nudge, setNudge] = useState(false);

  // The URL is the source of truth for which chat is on screen.
  useEffect(() => {
    void openSession(routeSessionId);
    // openSession is stable enough for this purpose; re-running on identity
    // changes would reload the transcript mid-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId]);

  useEffect(() => {
    if (draft) {
      setDraft("");
      void send(draft);
    }
  }, [draft, send, setDraft]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!busy && !historyOpen) inputRef.current?.focus();
  }, [busy, historyOpen, messages.length]);

  const submit = (text: string) => {
    const value = text.trim();
    if (!value) return;
    const hasPending = messages.some((m) => m.role === "assistant" && m.pending);
    if (hasPending && AMBIGUOUS.has(value.toLowerCase())) {
      setNudge(true);
      setInput("");
      return;
    }
    setNudge(false);
    setInput("");
    void send(value);
  };

  const startNew = async () => {
    const id = await newSession();
    if (id) void navigate({ to: "/assistant/$sessionId", params: { sessionId: id } });
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(routeSessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the id is still visible on screen */
    }
  };

  const loading = sessionId !== routeSessionId;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold text-foreground">Assistant</h1>
            <button
              onClick={() => void copyId()}
              title="Copy session ID"
              className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            >
              <span className="rounded bg-muted px-1.5 py-0.5">session {shortId(routeSessionId)}</span>
              <span className="text-[10px]">{copied ? "copied" : "tap to copy"}</span>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="Past chats"
              onClick={() => setHistoryOpen(true)}
              className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground"
            >
              <History className="size-4" />
            </button>
            <button
              aria-label="New chat"
              onClick={() => void startNew()}
              className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        {loading && <p className="text-[13px] text-muted-foreground">Opening this chat…</p>}

        {!loading && messages.length === 0 && (
          <div className="mt-6">
            <p className="text-[15px] font-medium text-foreground">What do you need today?</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Ask about leave, attendance or working from home — or start with one of these.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-left text-[14px] text-foreground shadow-card"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="bubble-in max-w-[86%] self-end rounded-2xl rounded-tr-md bg-primary-light px-4 py-3 text-[15px] leading-relaxed text-primary-dark"
            >
              {message.text}
            </div>
          ) : (
            <AssistantMessage key={message.id} turn={message} />
          ),
        )}

        {busy && streamingReply && (
          <div className="bubble-in max-w-[85%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 text-[15px] leading-relaxed shadow-card">
            {streamingReply}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
          </div>
        )}

        {busy && !streamingReply && (
          <div className="bubble-in flex items-center gap-2.5 self-start rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
            <span className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-pulse rounded-full bg-primary"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
            <span className="text-[13px] text-muted-foreground">{stage ?? "Working on it"}…</span>
          </div>
        )}

        {nudge && (
          <p className="self-start text-[13px] text-warning">
            I need a clear yes before I submit this — tap Confirm, or reply "yes".
          </p>
        )}
        {error && <p className="self-start text-[13px] text-destructive">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="sticky bottom-[72px] flex items-center gap-2 border-t border-border bg-card px-4 py-3"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about leave, attendance or WFH"
          className="h-11 flex-1 rounded-full border border-border bg-background px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          type="button"
          aria-label="Voice input"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
        >
          <Mic className="size-4" />
        </button>
        <button
          type="submit"
          aria-label="Send"
          disabled={busy || !input.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>

      {historyOpen && <HistorySheet onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
