import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_my_hr_profile",
  title: "Get my HR profile",
  description:
    "Read the signed-in employee's HR profile: employee code, name, employment type, joining date, manager, location and grade band.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("employees")
      .select(
        "employee_code, full_name, employment_type, date_of_joining, manager_name, geo, grade_band, work_location",
      )
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: "No employee record is linked to your account yet, so there is no HR profile to show.",
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { profile: data },
    };
  },
});
