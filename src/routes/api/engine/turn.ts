import { createFileRoute } from "@tanstack/react-router";
import { GatewayError } from "@/lib/ai/gateway.server";
import { runEngineTurn } from "@/lib/engine/orchestrator.server";
import {
  closeTurn,
  costSplit,
  listEmployees,
  loadEmployee,
  loadMessages,
  openSession,
  saveMessage,
  saveTrace,
} from "@/lib/engine/session.server";
import type { EngineTurnResponse, PendingAction } from "@/lib/engine/types";

/**
 * One engine turn, end to end:
 * open session → persist the employee's message → run the orchestrator →
 * persist the reply, the trace and any held action → return the session view.
 *
 * action "load" rehydrates a session without spending a token.
 */
export const Route = createFileRoute("/api/engine/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "AI is not configured for this app." }, { status: 500 });
        }

        let body: {
          action?: "turn" | "load";
          session_id?: string | null;
          employee_code?: string;
          message?: string;
          baseline_mode?: boolean;
          /** Benchmark-only: run the baseline without the 12-read prefetch. */
          baseline_prefetch?: boolean;
          stream?: boolean;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin;

        const employees = await listEmployees(db);
        if (employees.length === 0) {
          return Response.json({ error: "No demo employees seeded." }, { status: 500 });
        }
        const code = body.employee_code ?? employees[0]!.employee_code;
        const employee = await loadEmployee(db, code);
        if (!employee) return Response.json({ error: `Unknown employee ${code}.` }, { status: 404 });

        const baselineMode = body.baseline_mode === true;

        // NDJSON progress stream: {"type":"stage"} frames, then one
        // {"type":"done"} or {"type":"error"} frame. Same work, narrated.
        const wantsStream = body.stream === true && body.action !== "load";
        let emitStage: (line: string) => void = () => {};
        let emitReply: (text: string) => void = () => {};

        const run = async () => {
          const session = await openSession(db, employee, body.session_id ?? null, baselineMode);

          if (body.action === "load") {
            const split = await costSplit(db, session.id);
            const payload: EngineTurnResponse = {
              session_id: session.id,
              messages: session.messages,
              trace: {
                turn_index: session.turn_count,
                events: [],
                cost_usd: 0,
                latency_ms: 0,
                baseline_mode: baselineMode,
              },
              session_cost_usd: split.total,
              agentic_cost_usd: split.agentic,
              baseline_cost_usd: split.baseline,
              pending: session.pending,
            };
            return {
              status: 200,
              payload: {
                ...payload,
                employee,
                employees: employees.map((e) => ({
                  employee_code: e.employee_code,
                  full_name: e.full_name,
                })),
              },
            };
          }

          const message = (body.message ?? "").trim();
          if (!message) return { status: 400, payload: { error: "message is required." } };

          const turnIndex = session.turn_count + 1;
          const userId = await saveMessage(db, session.id, turnIndex, {
            role: "user",
            content: message,
            chips: [],
            citations: [],
            verdict: null,
            receipt: null,
          });

          const result = await runEngineTurn({
            apiKey,
            db,
            employee,
            sessionId: session.id,
            turnIndex,
            baselineMode,
            baselinePrefetch: body.baseline_prefetch !== false,
            transcript: session.messages.map((m) => ({ role: m.role, content: m.content })),
            userMessage: message,
            pending: session.pending,
            onStage: (line) => emitStage(line),
            onReplyDelta: (text) => emitReply(text),
          });

          const assistantId = await saveMessage(db, session.id, turnIndex, {
            role: "assistant",
            ...result.assistant,
          });
          await saveTrace(db, session.id, turnIndex, result.events);

          const before = await costSplit(db, session.id);
          await closeTurn(db, session.id, turnIndex, result.pending, 0, before.total);

          const messages = await loadMessages(db, session.id);
          const payload: EngineTurnResponse = {
            session_id: session.id,
            messages,
            trace: {
              turn_index: turnIndex,
              events: result.events,
              cost_usd: result.cost_usd,
              latency_ms: result.latency_ms,
              baseline_mode: baselineMode,
            },
            session_cost_usd: before.total,
            agentic_cost_usd: before.agentic,
            baseline_cost_usd: before.baseline,
            pending: result.pending,
          };
          return {
            status: 200,
            payload: {
              ...payload,
              employee,
              ids: { user: userId, assistant: assistantId },
              employees: employees.map((e) => ({
                employee_code: e.employee_code,
                full_name: e.full_name,
              })),
            },
          };
        };

        const finish = async (): Promise<{ status: number; payload: Record<string, unknown> }> => {
          try {
            return await run();
          } catch (error) {
            const status = error instanceof GatewayError ? error.status : 500;
            if (status === 429) {
              return {
                status: 429,
                payload: { error: "The assistant is busy right now. Try that again in a moment." },
              };
            }
            if (status === 402) {
              return {
                status: 402,
                payload: { error: "AI credits are exhausted for this workspace." },
              };
            }
            console.error("engine turn failed", error instanceof Error ? error.message : error);
            return {
              status: 500,
              payload: { error: "I couldn't finish that. Try sending it again." },
            };
          }
        };

        if (!wantsStream) {
          const out = await finish();
          return Response.json(out.payload, { status: out.status });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const write = (frame: unknown) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
            };
            emitStage = (line) => write({ type: "stage", stage: line });
            emitReply = (text) => write({ type: "reply_delta", text });
            void (async () => {
              const out = await finish();
              write(
                out.status === 200
                  ? { type: "done", ...out.payload }
                  : { type: "error", status: out.status, ...out.payload },
              );
              controller.close();
            })();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});

export type { PendingAction };
