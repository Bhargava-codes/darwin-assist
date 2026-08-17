import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_leave_requests",
  title: "List leave requests",
  description:
    "List the signed-in employee's leave requests, newest first, optionally filtered by status.",
  inputSchema: {
    status: z
      .enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])
      .optional()
      .describe("Only return requests in this status."),
    limit: z.number().int().optional().describe("Maximum rows to return. Defaults to 20."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const capped = Math.min(Math.max(limit ?? 20, 1), 100);
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("leave_requests")
      .select("id, leave_code, start_date, end_date, working_days, half_day, reason, status, created_at")
      .order("created_at", { ascending: false })
      .limit(capped);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [
        {
          type: "text",
          text: rows.length ? JSON.stringify(rows, null, 2) : "No leave requests found.",
        },
      ],
      structuredContent: { requests: rows },
    };
  },
});
