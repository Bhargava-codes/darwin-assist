import { createFileRoute } from "@tanstack/react-router";
import { resolveCaller } from "@/lib/ai/conversation.server";
import type { AgentKeyT, OpsPayload, OpsSession, OpsStep } from "@/lib/ops/types";

/**
 * HR Ops observability feed. Audit rows are Ops-only, so the caller must carry
 * is_hr_ops; the reads then run with the service-role client.
 *
 * Every figure in the console is derived here from the raw session log:
 * conversations, turn_traces, agent_steps, retrieval_logs, tool_calls, feedback.
 */
export const Route = createFileRoute("/api/ops")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "Not signed in." }, { status: 401 });
        if (!caller.employee.is_hr_ops) {
          return Response.json({ error: "HR Ops access only." }, { status: 403 });
        }
        const admin = caller.admin;

        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

        const [convs, allConvs, traces, feedback] = await Promise.all([
          admin
            .from("conversations")
            .select("id, employee_id, started_at, last_active_at, outcome, turn_count")
            .gte("started_at", since)
            .order("started_at", { ascending: false }),
          admin.from("conversations").select("employee_id, started_at").limit(5000),
          admin
            .from("turn_traces")
            .select(
              "id, conversation_id, turn_index, intent, verdict, total_latency_ms, cost_optimized_usd, created_at",
            )
            .gte("created_at", since)
            .order("turn_index", { ascending: true }),
          admin.from("feedback").select("conversation_id, turn_index, rating").gte("created_at", since),
        ]);

        const conversations = convs.data ?? [];
        const traceRows = traces.data ?? [];
        const traceIds = traceRows.map((t) => t.id as string);

        const [steps, retrieval, tools] = await Promise.all([
          chunkedIn(admin, "agent_steps", "trace_id, step_index, agent, role, model, latency_ms, cost_usd", traceIds),
          chunkedIn(admin, "retrieval_logs", "trace_id", traceIds),
          chunkedIn(admin, "tool_calls", "trace_id, tool_name", traceIds),
        ]);

        /* ------------------------------------------------------------ value */
        const total = conversations.length;
        const resolved = conversations.filter((c) => c.outcome === "RESOLVED").length;
        const fbRows = feedback.data ?? [];
        const fbSessions = new Set(fbRows.map((f) => f.conversation_id as string));
        const rated = conversations.filter((c) => fbSessions.has(c.id as string)).length;
        const up = fbRows.filter((f) => f.rating === "up").length;
        const down = fbRows.filter((f) => f.rating === "down").length;

        // D7: employees whose first conversation is at least 7 days old and who
        // came back 7+ days after that first session.
        const firstSeen = new Map<string, number>();
        const laterVisit = new Map<string, number[]>();
        for (const row of allConvs.data ?? []) {
          const emp = row.employee_id as string;
          const at = new Date(row.started_at as string).getTime();
          firstSeen.set(emp, Math.min(firstSeen.get(emp) ?? at, at));
          laterVisit.set(emp, [...(laterVisit.get(emp) ?? []), at]);
        }
        const week = 7 * 24 * 3600 * 1000;
        const cohort = [...firstSeen.entries()].filter(([, at]) => Date.now() - at >= week);
        const returned = cohort.filter(([emp, at]) =>
          (laterVisit.get(emp) ?? []).some((v) => v - at >= week),
        ).length;

        /* ------------------------------------------------------- engagement */
        const handled = conversations.filter((c) => c.outcome === "RESOLVED");
        const ahtSeconds = handled.length
          ? handled.reduce(
              (sum, c) =>
                sum +
                (new Date(c.last_active_at as string).getTime() -
                  new Date(c.started_at as string).getTime()) /
                  1000,
              0,
            ) / handled.length
          : 0;

        /* -------------------------------------------------------- technical */
        const sessionLatency = new Map<string, number>();
        const sessionTurns = new Map<string, number>();
        const sessionCost = new Map<string, number>();
        for (const t of traceRows) {
          const id = t.conversation_id as string;
          sessionLatency.set(id, (sessionLatency.get(id) ?? 0) + Number(t.total_latency_ms ?? 0));
          sessionTurns.set(id, (sessionTurns.get(id) ?? 0) + 1);
          sessionCost.set(id, (sessionCost.get(id) ?? 0) + Number(t.cost_optimized_usd ?? 0));
        }

        const turnLatency = (index: number) =>
          p95(
            traceRows
              .filter((t) => Number(t.turn_index) === index)
              .map((t) => Number(t.total_latency_ms ?? 0)),
          );

        const perTurn = [...sessionLatency.entries()].map(
          ([id, ms]) => ms / Math.max(1, sessionTurns.get(id) ?? 1),
        );
        const avgTurns = sessionTurns.size
          ? [...sessionTurns.values()].reduce((a, b) => a + b, 0) / sessionTurns.size
          : 0;

        const stepRows = steps as {
          trace_id: string;
          step_index: number;
          agent: AgentKeyT;
          role: string | null;
          model: string;
          latency_ms: number | null;
          cost_usd: number | null;
        }[];

        const agentKeys: AgentKeyT[] = ["agent_1", "agent_2", "agent_3"];
        const agentLatency = agentKeys.map((agent) => {
          const rows = stepRows.filter((s) => s.agent === agent);
          return { agent, p95_ms: p95(rows.map((r) => Number(r.latency_ms ?? 0))), calls: rows.length };
        });

        /* ------------------------------------------------------------- cost */
        const totalCost = [...sessionCost.values()].reduce((a, b) => a + b, 0);
        const agentCostRaw = agentKeys.map((agent) => ({
          agent,
          usd: stepRows
            .filter((s) => s.agent === agent)
            .reduce((sum, s) => sum + Number(s.cost_usd ?? 0), 0),
        }));
        const agentCostTotal = agentCostRaw.reduce((a, b) => a + b.usd, 0);

        /* ---------------------------------------------------------- sessions */
        const ragByTrace = countBy((retrieval as { trace_id: string }[]).map((r) => r.trace_id));
        const toolsByTrace = countBy((tools as { trace_id: string }[]).map((r) => r.trace_id));
        const toolByTraceStep = new Map<string, string>();
        for (const row of tools as { trace_id: string; tool_name: string }[]) {
          if (!toolByTraceStep.has(row.trace_id)) toolByTraceStep.set(row.trace_id, row.tool_name);
        }

        // Raw log: most recent sessions, deep enough to scan a week without paging.
        const visible = conversations.slice(0, 25);
        const visibleTraceIds = traceRows
          .filter((t) => visible.some((c) => c.id === t.conversation_id))
          .map((t) => t.id as string);

        const detailSteps = (await chunkedIn(
          admin,
          "agent_steps",
          "trace_id, step_index, agent, role, model, latency_ms, raw_input, raw_output, input_summary, output_summary",
          visibleTraceIds,
        )) as {
          trace_id: string;
          step_index: number;
          agent: AgentKeyT;
          role: string | null;
          model: string;
          latency_ms: number | null;
          raw_input: unknown;
          raw_output: unknown;
          input_summary: string | null;
          output_summary: string | null;
        }[];

        const sessions: OpsSession[] = visible.map((c) => {
          const id = c.id as string;
          const own = traceRows.filter((t) => t.conversation_id === id);
          const ownIds = own.map((t) => t.id as string);
          const ownSteps = stepRows.filter((s) => ownIds.includes(s.trace_id));
          const perAgent = Object.fromEntries(
            agentKeys.map((agent) => {
              const rows = ownSteps.filter((s) => s.agent === agent);
              return [
                agent,
                rows.length
                  ? Math.round(
                      rows.reduce((sum, s) => sum + Number(s.latency_ms ?? 0), 0) / rows.length,
                    )
                  : null,
              ];
            }),
          ) as Record<AgentKeyT, number | null>;

          const turnOf = new Map(own.map((t) => [t.id as string, Number(t.turn_index)]));
          const stepsOut: OpsStep[] = detailSteps
            .filter((s) => ownIds.includes(s.trace_id))
            .map((s) => ({
              turn_index: turnOf.get(s.trace_id) ?? 0,
              step_index: s.step_index,
              agent: s.agent,
              role: s.role,
              model: s.model,
              tool: s.agent === "agent_3" ? (toolByTraceStep.get(s.trace_id) ?? null) : null,
              latency_ms: Number(s.latency_ms ?? 0),
              input: s.raw_input ?? s.input_summary,
              output: s.raw_output ?? s.output_summary,
            }))
            .sort((a, b) => a.turn_index - b.turn_index || a.step_index - b.step_index);

          const fb = fbRows.find((f) => f.conversation_id === id);

          return {
            id,
            short_id: id.slice(0, 8),
            intent: (own[own.length - 1]?.intent as string | null) ?? null,
            latency_ms: sessionLatency.get(id) ?? 0,
            per_agent: perAgent,
            rag: ownIds.reduce((sum, t) => sum + (ragByTrace.get(t) ?? 0), 0),
            tools: ownIds.reduce((sum, t) => sum + (toolsByTrace.get(t) ?? 0), 0),
            feedback: (fb?.rating as "up" | "down" | undefined) ?? null,
            steps: stepsOut,
          };
        });

        const payload: OpsPayload = {
          value: {
            deflection_pct: total ? Math.round((resolved / total) * 100) : 0,
            resolved,
            total,
            feedback_pct: total ? Math.round((rated / total) * 100) : 0,
            feedback_up: up,
            feedback_down: down,
            d7_pct: cohort.length ? Math.round((returned / cohort.length) * 100) : 0,
            d7_maturing: cohort.length < 5,
          },
          engagement: { conversations: total, aht_seconds: Math.round(ahtSeconds) },
          technical: {
            per_turn_p95_ms: Math.round(p95(perTurn)),
            turn1_p95_ms: Math.round(turnLatency(1)),
            turn2_p95_ms: Math.round(turnLatency(2)),
            session_p95_ms: Math.round(p95([...sessionLatency.values()])),
            avg_turns: Number(avgTurns.toFixed(1)),
            agents: agentLatency.map((a) => ({ ...a, p95_ms: Math.round(a.p95_ms) })),
            tool_calls: (tools as unknown[]).length,
            rag_pulls: (retrieval as unknown[]).length,
          },
          cost: {
            per_session_usd: total ? totalCost / total : 0,
            total_usd: totalCost,
            sessions: total,
            agents: agentCostRaw.map((a) => ({
              ...a,
              share_pct: agentCostTotal ? Math.round((a.usd / agentCostTotal) * 100) : 0,
            })),
          },
          sessions,
          sessions_total: total,
        };

        return Response.json(payload);
      },
    },
  },
});

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function countBy(keys: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

/** PostgREST caps URL length, so `in` filters are batched. */
async function chunkedIn(
  admin: { from: (table: string) => any },
  table: string,
  columns: string,
  ids: string[],
): Promise<unknown[]> {
  if (ids.length === 0) return [];
  const size = 200;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  const results = await Promise.all(
    batches.map((batch) => admin.from(table).select(columns).in("trace_id", batch)),
  );
  return results.flatMap((r) => (r.data ?? []) as unknown[]);
}
