import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_hr_policy",
  title: "Search HR policy",
  description:
    "Keyword-search the company HR policy manual (leave, attendance, work-from-home) and return matching clauses with their clause ids so answers can cite them.",
  inputSchema: {
    query: z.string().describe("Words to search for, e.g. 'casual leave notice period'."),
    limit: z.number().int().optional().describe("Maximum clauses to return. Defaults to 6."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const terms = query.trim();
    if (!terms) {
      return { content: [{ type: "text", text: "Search query is empty." }], isError: true };
    }
    const capped = Math.min(Math.max(limit ?? 6, 1), 20);
    const escaped = terms.replace(/[%_,]/g, " ").trim();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("policy_chunks_small")
      .select("chunk_id, section, heading, content, object_tags")
      .or(`content.ilike.%${escaped}%,heading.ilike.%${escaped}%,section.ilike.%${escaped}%`)
      .limit(capped);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [
        {
          type: "text",
          text: rows.length
            ? JSON.stringify(rows, null, 2)
            : `No policy clauses matched "${terms}".`,
        },
      ],
      structuredContent: { query: terms, clauses: rows },
    };
  },
});
