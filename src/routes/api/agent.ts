import { createFileRoute } from "@tanstack/react-router";
import { runTurn } from "@/lib/ai/agents.server";
import {
  appendMessage,
  openConversation,
  recordTrace,
  resolveCaller,
  saveSlots,
} from "@/lib/ai/conversation.server";
import { loadHrState } from "@/lib/hr/db.server";
import type { PendingAction } from "@/lib/ai/agent-types";

/**
 * One assistant turn, end to end:
 * resolve caller → load state + memory → persist user message → run agents
 * → persist assistant message, slots and the audit trace → return the fresh state.
 */
export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "AI is not configured for this app." }, { status: 500 });
        }

        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "Not signed in." }, { status: 401 });

        let body: { message?: unknown; confirm?: PendingAction | null };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const message = typeof body.message === "string" ? body.message.trim() : "";
        const confirm = body.confirm ?? null;
        if (!message && !confirm) {
          return Response.json({ error: "message is required." }, { status: 400 });
        }

        try {
          const [state, conversation] = await Promise.all([
            loadHrState(caller.user, caller.employee.id),
            openConversation(caller),
          ]);
          const turnIndex = conversation.turn_index + 1;
          const userText = confirm ? "[Confirm]" : message;

          await appendMessage(caller, conversation.id, turnIndex, {
            id: "pending",
            role: "user",
            text: userText,
          });

          const history = conversation.messages.slice(-8).map((m) => ({
            role: m.role,
            text: m.text,
          }));

          const result = await runTurn(
            apiKey,
            {
              message: message || "Confirm",
              history,
              slots: conversation.slots,
              state,
              confirm,
            },
            { admin: caller.admin, employee: caller.employee },
          );

          const assistantId = await appendMessage(
            caller,
            conversation.id,
            turnIndex,
            result.turn,
          );
          await Promise.all([
            saveSlots(caller, conversation.id, result.slots, result.trace.intent),
            recordTrace(
              caller,
              conversation.id,
              turnIndex,
              { ...result.trace, turn: turnIndex, user_message: userText },
            ),
          ]);

          // Re-read after writes so the UI always reflects committed rows.
          const fresh = await loadHrState(caller.user, caller.employee.id);

          return Response.json({
            turn: { ...result.turn, id: assistantId, turn_index: turnIndex, feedback: null },
            slots: result.slots,
            state: fresh,
            trace: { ...result.trace, turn: turnIndex, user_message: userText },
          });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "Unknown error";
          const status = (error as { status?: number })?.status ?? 500;
          if (status === 429) {
            return Response.json(
              { error: "The assistant is rate limited. Try again in a moment." },
              { status: 429 },
            );
          }
          if (status === 402) {
            return Response.json(
              { error: "AI credits are exhausted for this workspace." },
              { status: 402 },
            );
          }
          console.error("agent turn failed", messageText);
          return Response.json(
            { error: "The assistant could not complete that turn." },
            { status: 500 },
          );
        }
      },
    },
  },
});
