import { createFileRoute } from "@tanstack/react-router";
import { resolveCaller, openConversation } from "@/lib/ai/conversation.server";
import { loadHrState } from "@/lib/hr/db.server";

/**
 * Session bootstrap. Links the signed-in auth user to their employee row on first
 * call, then returns everything the app needs to render: the employee, the live HR
 * projection, and the persisted conversation.
 */
export const Route = createFileRoute("/api/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const header = request.headers.get("Authorization") ?? "";
        const token = header.replace(/^Bearer\s+/i, "").trim();
        if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });

        const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !auth.user) {
          return Response.json({ error: "Not signed in." }, { status: 401 });
        }

        // First sign-in claims the unlinked demo employee row.
        const { data: linked } = await supabaseAdmin
          .from("employees")
          .select("id")
          .eq("auth_user_id", auth.user.id)
          .maybeSingle();
        if (!linked) {
          const { data: unclaimed } = await supabaseAdmin
            .from("employees")
            .select("id")
            .is("auth_user_id", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!unclaimed) {
            return Response.json({ error: "No employee record available." }, { status: 403 });
          }
          await supabaseAdmin
            .from("employees")
            .update({ auth_user_id: auth.user.id })
            .eq("id", unclaimed.id);
        }

        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "No employee record." }, { status: 403 });

        const [state, conversation] = await Promise.all([
          loadHrState(caller.user, caller.employee.id),
          openConversation(caller),
        ]);

        return Response.json({
          employee: caller.employee,
          state,
          conversation: {
            id: conversation.id,
            turn_index: conversation.turn_index,
            slots: conversation.slots,
            messages: conversation.messages,
          },
        });
      },
    },
  },
});
