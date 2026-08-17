import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ToolName, ToolParams } from "./tools";
import type { HrState } from "./types";
import {
  emptySlots,
  type AssistantTurn,
  type ChatMessage,
  type PendingAction,
  type Slots,
} from "@/lib/ai/agent-types";
import type {
  EngineMessage,
  EngineTurnResponse,
  PendingAction as EnginePendingAction,
} from "@/lib/engine/types";

/**
 * All HR state lives in Lovable Cloud. This store is a thin client: it signs the
 * demo employee in, loads the persisted conversation and HR projection, and
 * replaces its snapshot with whatever the server returns after each turn.
 */

/** Keeps the engine conversation alive across reloads. */
const SESSION_KEY = "darwinbox.engine.session";

const DEMO_EMAIL = "bhargava@darwinbox.demo";
const DEMO_PASSWORD = "darwinbox-demo-4471";

export type EmployeeProfile = {
  employee_id: string;
  name: string;
  employment_type: string;
  tenure_months: number;
  manager_name: string;
  geo: string;
  is_hr_ops: boolean;
};

export type SessionSummary = {
  id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
};

type Store = {
  ready: boolean;
  employee: EmployeeProfile | null;
  state: HrState | null;
  messages: ChatMessage[];
  slots: Slots;
  busy: boolean;
  /** What the assistant is doing right now, in plain words. */
  stage: string | null;
  /** A1's reply as it is being written. Cleared the moment the turn lands. */
  streamingReply: string | null;
  error: string | null;
  draft: string;
  /** The chat the screen is showing, and every chat this employee has had. */
  sessionId: string | null;
  sessions: SessionSummary[];
  /** Load an existing chat by id (used by the /assistant/:sessionId route). */
  openSession: (id: string) => Promise<void>;
  /** Start a fresh chat and return its id. */
  newSession: () => Promise<string | null>;
  refreshSessions: () => Promise<void>;
  setDraft: (value: string) => void;
  send: (text: string) => Promise<void>;
  confirm: (action: PendingAction) => Promise<void>;
  cancelPending: (turnId: string) => void;
  act: (tool: ToolName, params: ToolParams) => Promise<{ ok: boolean; message: string }>;
  rate: (turnId: string, turnIndex: number, rating: "up" | "down") => Promise<void>;
  toggleClock: () => void;
};


const StoreContext = createContext<Store | null>(null);

async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;

  const signIn = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signIn.data.session) return signIn.data.session.access_token;

  const signUp = await supabase.auth.signUp({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signUp.data.session) return signUp.data.session.access_token;

  const retry = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (retry.data.session) return retry.data.session.access_token;
  throw new Error(retry.error?.message ?? "Could not start your session.");
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await ensureSession();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Engine held action → the confirmation card the screen renders. */
function toUiPending(pending: EnginePendingAction | null): PendingAction | null {
  if (!pending) return null;
  return {
    tool: pending.tool as unknown as ToolName,
    params: pending.args as ToolParams,
    title: pending.summary,
    rows: pending.rows,
  };
}

/** Engine reply → the shape the chat screen renders. */
function toChatMessage(m: EngineMessage, pending: PendingAction | null): ChatMessage {
  if (m.role === "user") return { id: m.id, role: "user", text: m.content };
  const turn: AssistantTurn = {
    id: m.id,
    role: "assistant",
    text: m.content,
    chips: pending ? [] : m.chips,
    citations: m.citations.map((c) => ({ clause_id: c.chunk_id, text: c.heading })),
    verdict: m.verdict,
    pending,
    abstain: m.verdict === "UNKNOWN" && m.citations.length === 0,
    turn_index: m.turn_index,
  };
  return turn;
}

function toChatMessages(
  messages: EngineMessage[],
  pending: EnginePendingAction | null,
): ChatMessage[] {
  const held = toUiPending(pending);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return messages.map((m) => toChatMessage(m, held && m.id === lastAssistant?.id ? held : null));
}

export function HrProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [state, setState] = useState<HrState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [slots, setSlots] = useState<Slots>(emptySlots);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [clockedInAt, setClockedInAt] = useState<string | null>(null);
  const booted = useRef(false);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/engine/sessions");
      if (!response.ok) return;
      const body = (await response.json()) as { sessions: SessionSummary[] };
      setSessions(body.sessions ?? []);
    } catch {
      /* the list is a convenience; a failed refresh must not break the chat */
    }
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      if (sessionId.current === id && messages.length > 0) return;
      sessionId.current = id;
      setActiveSessionId(id);
      setMessages([]);
      if (typeof window !== "undefined") window.localStorage.setItem(SESSION_KEY, id);
      try {
        const response = await fetch("/api/engine/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "load", session_id: id }),
        });
        if (!response.ok) return;
        const loaded = (await response.json()) as EngineTurnResponse;
        if (sessionId.current !== loaded.session_id) return;
        setMessages(toChatMessages(loaded.messages, loaded.pending));
      } catch {
        setError("Could not open that chat. Try again.");
      }
    },
    [messages.length],
  );

  const newSession = useCallback(async () => {
    try {
      const response = await fetch("/api/engine/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { session: SessionSummary };
      sessionId.current = body.session.id;
      setActiveSessionId(body.session.id);
      setMessages([]);
      if (typeof window !== "undefined")
        window.localStorage.setItem(SESSION_KEY, body.session.id);
      setSessions((prev) => [body.session, ...prev]);
      return body.session.id;
    } catch {
      setError("Could not start a new chat. Try again.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const response = await authedFetch("/api/session", { method: "POST" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not load your HR data.");
        }
        const data = (await response.json()) as {
          employee: EmployeeProfile;
          state: HrState;
          conversation: { slots: Slots; messages: ChatMessage[] };
        };
        setEmployee(data.employee);
        setState(data.state);
        setSlots(data.conversation.slots);
        await refreshSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your HR data.");
      } finally {

        setReady(true);
      }
    })();
  }, []);

  /**
   * One engine turn. The endpoint streams NDJSON progress frames, so the screen
   * can say what it is actually doing instead of showing a blank spinner.
   */
  const runTurn = useCallback(async (message: string) => {
    setError(null);
    setBusy(true);
    setStage("Reading your message");
    setStreamingReply(null);
    try {
      const response = await fetch("/api/engine/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "turn", session_id: sessionId.current, message, stream: true }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The assistant is unavailable right now.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done: (EngineTurnResponse & { type: string }) | null = null;
      let failure: string | null = null;

      const handle = (line: string) => {
        if (!line.trim()) return;
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame['type'] === "stage") setStage(String(frame['stage'] ?? ""));
        else if (frame['type'] === "reply_delta") setStreamingReply(String(frame['text'] ?? ""));
        else if (frame['type'] === "error") failure = String(frame['error'] ?? "That didn't go through.");
        else if (frame['type'] === "done") done = frame as unknown as EngineTurnResponse & { type: string };
      };

      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
      }
      if (buffer) handle(buffer);

      if (failure) throw new Error(failure);
      if (!done) throw new Error("The assistant stopped early. Try that again.");

      const result = done as EngineTurnResponse;
      sessionId.current = result.session_id;
      setActiveSessionId(result.session_id);
      window.localStorage.setItem(SESSION_KEY, result.session_id);
      setMessages(toChatMessages(result.messages, result.pending));
      setStreamingReply(null);
      // The reply is on screen now — the refresh below must not hold the typing
      // indicator open behind it.
      setStage(null);
      setBusy(false);

      // A write may have changed balances or requests — refresh the projection.
      const refreshed = await authedFetch("/api/session", { method: "POST" });
      if (refreshed.ok) {
        const data = (await refreshed.json()) as { state: HrState };
        setState(data.state);
      }
      // The chat list shows titles and turn counts — keep it honest.
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try sending that again.");
    } finally {
      setStage(null);
      setStreamingReply(null);
      setBusy(false);
    }
  }, [refreshSessions]);


  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).slice(2, 10), role: "user", text: trimmed },
      ]);
      await runTurn(trimmed);
    },
    [busy, runTurn],
  );

  const confirm = useCallback(
    async (_action: PendingAction) => {
      if (busy) return;
      setMessages((prev) =>
        prev.map((m) => (m.role === "assistant" && m.pending ? { ...m, pending: null } : m)),
      );
      await runTurn("Confirm");
    },
    [busy, runTurn],
  );

  const cancelPending = useCallback((turnId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, pending: null } : m)));
  }, []);

  const act = useCallback(async (tool: ToolName, params: ToolParams) => {
    try {
      const response = await authedFetch("/api/hr-action", {
        method: "POST",
        body: JSON.stringify({ tool, params }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        message?: string;
        state?: HrState;
        error?: string;
      };
      if (!response.ok) return { ok: false, message: body.error ?? "That could not be completed." };
      if (body.state) setState(body.state);
      return { ok: Boolean(body.ok), message: body.message ?? "Sent" };
    } catch {
      return { ok: false, message: "You appear to be offline. Try again." };
    }
  }, []);

  const rate = useCallback(async (turnId: string, turnIndex: number, rating: "up" | "down") => {
    // Optimistic: the control is a one-tap signal, so it must feel instant.
    setMessages((prev) =>
      prev.map((m) => (m.id === turnId && m.role === "assistant" ? { ...m, feedback: rating } : m)),
    );
    try {
      const response = await authedFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ turn_index: turnIndex, rating }),
      });
      if (!response.ok) throw new Error("feedback rejected");
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === turnId && m.role === "assistant" ? { ...m, feedback: null } : m)),
      );
    }
  }, []);

  const toggleClock = useCallback(() => {
    setClockedInAt((prev) => (prev ? null : new Date().toISOString()));
  }, []);

  const value = useMemo<Store>(
    () => ({
      ready,
      employee,
      state: state ? { ...state, clocked_in_at: clockedInAt } : null,
      messages,
      slots,
      busy,
      stage,
      streamingReply,
      error,
      draft,
      sessionId: activeSessionId,
      sessions,
      openSession,
      newSession,
      refreshSessions,
      setDraft,
      send,
      confirm,
      cancelPending,
      act,
      rate,
      toggleClock,
    }),
    [
      activeSessionId,
      newSession,
      openSession,
      refreshSessions,
      sessions,

      act,
      busy,
      cancelPending,
      clockedInAt,
      confirm,
      draft,
      employee,
      error,
      messages,
      rate,
      ready,
      send,
      slots,
      stage,
      streamingReply,
      state,
      toggleClock,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useHr() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useHr must be used inside HrProvider");
  return store;
}
