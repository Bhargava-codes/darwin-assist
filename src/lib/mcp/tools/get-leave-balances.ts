import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_leave_balances",
  title: "Get leave balances",
  description:
    "Read the signed-in employee's leave balances per leave code (CL, SL, EL, ML, PL, BL, UL) for a cycle year.",
  inputSchema: {
    cycle_year: z
      .number()
      .int()
      .optional()
      .describe("Leave cycle year. Defaults to the current calendar year."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ cycle_year }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const year = cycle_year ?? new Date().getUTCFullYear();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("leave_balances")
      .select("leave_code, cycle_year, entitled, used, available")
      .eq("cycle_year", year)
      .order("leave_code");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [
        {
          type: "text",
          text: rows.length
            ? JSON.stringify(rows, null, 2)
            : `No leave balances are visible for cycle year ${year}.`,
        },
      ],
      structuredContent: { cycle_year: year, balances: rows },
    };
  },
});
