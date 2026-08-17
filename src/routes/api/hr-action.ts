import { createFileRoute } from "@tanstack/react-router";
import { resolveCaller } from "@/lib/ai/conversation.server";
import { applyToolWrite, loadHrState, MUTATING_TOOLS } from "@/lib/hr/db.server";
import { runTool, TOOL_RISK, type ToolName, type ToolParams } from "@/lib/hr/tools";

/**
 * Tap-first CRUD from the Requests tab. Same tool layer as the assistant, so the
 * eligibility rules and error codes are identical no matter which surface asks.
 */
export const Route = createFileRoute("/api/hr-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "Not signed in." }, { status: 401 });

        let body: { tool?: unknown; params?: ToolParams };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const tool = String(body.tool ?? "") as ToolName;
        if (!(tool in TOOL_RISK)) {
          return Response.json({ error: "Unknown action." }, { status: 400 });
        }
        const params = body.params ?? {};

        const state = await loadHrState(caller.user, caller.employee.id);
        const record = runTool(tool, params, state, { confirmation_token: true });

        if (!record.outcome.ok) {
          const fresh = await loadHrState(caller.user, caller.employee.id);
          return Response.json({
            ok: false,
            message:
              record.outcome.message ?? record.outcome.error_code ?? "That could not be completed.",
            error_code: record.outcome.error_code ?? null,
            state: fresh,
          });
        }

        if (MUTATING_TOOLS.includes(tool)) {
          await applyToolWrite(caller.admin, caller.employee.id, tool, params, state);
        }

        const fresh = await loadHrState(caller.user, caller.employee.id);
        return Response.json({ ok: true, message: "Sent", state: fresh });
      },
    },
  },
});
