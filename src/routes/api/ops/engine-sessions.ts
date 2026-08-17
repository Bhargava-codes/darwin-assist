import { createFileRoute } from "@tanstack/react-router";

type SessionRow = {
  id: string;
  employee_code: string;
  employee_name: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
  cost_usd: number;
  /** Average model latency per turn (total step latency / turn_count). */
  latency_ms: number;
  /** Wall-clock session length from first to last activity. */
  duration_ms: number;
  baseline_mode: boolean;
  title: string;
  events: number;
  per_agent: { agent_1: number | null; agent_2: number | null; agent_3: number | null };
  rag: number;
  tools: number;
  feedback: "up" | "down" | null;
};

type EventRow = {
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

/**
 * Engine session log for the Ops console: every conversation by session_id,
 * plus the step-level trace + transcript for one session when session_id is passed.
 */
export const Route = createFileRoute("/api/ops/engine-sessions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const url = new URL(request.url);
        const sessionId = url.searchParams.get("session_id");

        if (sessionId) {
          const { data: session, error: sessionError } = await db
            .from("engine_sessions")
            .select(
              "id, employee_id, created_at, last_active_at, turn_count, baseline_mode, total_cost_usd",
            )
            .eq("id", sessionId)
            .maybeSingle();
          if (sessionError) return Response.json({ error: sessionError.message }, { status: 500 });
          if (!session) return Response.json({ error: "Session not found" }, { status: 404 });

          const [{ data, error }, { data: messages }, { data: employee }] = await Promise.all([
            db
              .from("trace_events")
              .select(
                "turn_index, step_index, actor, action, model, mode, status, latency_ms, cost_usd, tokens_in, tokens_out, payload, result, created_at",
              )
              .eq("session_id", sessionId)
              .order("turn_index", { ascending: true })
              .order("step_index", { ascending: true }),
            db
              .from("engine_messages")
              .select("turn_index, role, actor, content, chips, citations, verdict, created_at")
              .eq("session_id", sessionId)
              .order("turn_index", { ascending: true })
              .order("created_at", { ascending: true }),
            db
              .from("employees")
              .select("employee_code, full_name")
              .eq("id", session.employee_id as string)
              .maybeSingle(),
          ]);
          if (error) return Response.json({ error: error.message }, { status: 500 });

          const events = (data ?? []) as EventRow[];
          const totalLatencyMs = events.reduce((sum, e) => sum + Number(e.latency_ms ?? 0), 0);
          const turnCount = (session.turn_count as number) ?? 0;
          const durationMs =
            new Date(session.last_active_at as string).getTime() -
            new Date(session.created_at as string).getTime();
          return Response.json({
            session_id: sessionId,
            session: {
              id: session.id as string,
              employee_code: employee?.employee_code ?? "—",
              employee_name: employee?.full_name ?? "—",
              created_at: session.created_at as string,
              last_active_at: session.last_active_at as string,
              turn_count: turnCount,
              baseline_mode: Boolean(session.baseline_mode),
              cost_usd: events.reduce((sum, e) => sum + Number(e.cost_usd ?? 0), 0),
              latency_ms: totalLatencyMs / Math.max(1, turnCount),
              duration_ms: durationMs,
            },
            events,
            messages: messages ?? [],
          });
        }

        const { data: sessions, error } = await db
          .from("engine_sessions")
          .select("id, employee_id, created_at, last_active_at, turn_count, baseline_mode")
          .order("last_active_at", { ascending: false })
          .limit(60);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const ids = (sessions ?? []).map((s) => s.id as string);
        const employeeIds = [...new Set((sessions ?? []).map((s) => s.employee_id as string))];

        const [{ data: employees }, { data: events }, { data: firsts }] = await Promise.all([
          db.from("employees").select("id, employee_code, full_name").in("id", employeeIds),
          ids.length
            ? db
                .from("trace_events")
                .select("session_id, cost_usd, latency_ms, actor")
                .in("session_id", ids)
            : Promise.resolve({
                data: [] as { session_id: string; cost_usd: number; latency_ms: number; actor: string }[],
              }),
          ids.length
            ? db
                .from("engine_messages")
                .select("session_id, content, role, created_at")
                .in("session_id", ids)
                .eq("role", "user")
                .order("created_at", { ascending: true })
            : Promise.resolve({ data: [] as { session_id: string; content: string }[] }),
        ]);

        const employee = new Map(
          (employees ?? []).map((e) => [
            e.id as string,
            { code: e.employee_code as string, name: e.full_name as string },
          ]),
        );

        type Agg = {
          cost: number;
          latency: number;
          steps: number;
          a1: number;
          a2: number;
          a3: number;
          rag: number;
          tools: number;
        };
        const agg = new Map<string, Agg>();
        const blank = (): Agg => ({
          cost: 0,
          latency: 0,
          steps: 0,
          a1: 0,
          a2: 0,
          a3: 0,
          rag: 0,
          tools: 0,
        });
        for (const row of (events ?? []) as {
          session_id: string;
          cost_usd: number;
          latency_ms: number;
          actor: string;
        }[]) {
          const key = row.session_id;
          const current = agg.get(key) ?? blank();
          current.cost += Number(row.cost_usd ?? 0);
          current.latency += Number(row.latency_ms ?? 0);
          current.steps += 1;
          const actor = (row.actor ?? "").toLowerCase();
          if (actor === "a1") current.a1 += 1;
          else if (actor === "a2") current.a2 += 1;
          else if (actor === "a3") current.a3 += 1;
          if (actor === "rag") current.rag += 1;
          if (actor === "hrms") current.tools += 1;
          agg.set(key, current);
        }

        const titles = new Map<string, string>();
        for (const row of (firsts ?? []) as { session_id: string; content: string }[]) {
          if (!titles.has(row.session_id)) titles.set(row.session_id, row.content);
        }

        const rows: SessionRow[] = (sessions ?? []).map((s) => {
          const id = s.id as string;
          const emp = employee.get(s.employee_id as string);
          const a = agg.get(id) ?? blank();
          const turnCount = (s.turn_count as number) ?? 0;
          const durationMs =
            new Date(s.last_active_at as string).getTime() -
            new Date(s.created_at as string).getTime();
          return {
            id,
            employee_code: emp?.code ?? "—",
            employee_name: emp?.name ?? "—",
            created_at: s.created_at as string,
            last_active_at: s.last_active_at as string,
            turn_count: turnCount,
            cost_usd: a.cost,
            latency_ms: a.latency / Math.max(1, turnCount),
            duration_ms: durationMs,
            baseline_mode: Boolean(s.baseline_mode),
            title: titles.get(id) ?? "—",
            events: a.steps,
            per_agent: {
              agent_1: a.a1 || null,
              agent_2: a.a2 || null,
              agent_3: a.a3 || null,
            },
            rag: a.rag,
            tools: a.tools,
            feedback: null,
          };
        });

        return Response.json({ sessions: rows });
      },
    },
  },
});
