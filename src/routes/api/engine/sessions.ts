import { createFileRoute } from "@tanstack/react-router";
import { listEmployees, loadEmployee } from "@/lib/engine/session.server";

/**
 * Chat history for the employee app: list past sessions, or start a fresh one.
 * A session's title is its first message, so the list reads like a real inbox.
 */
export const Route = createFileRoute("/api/engine/sessions")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const employees = await listEmployees(db);
        if (employees.length === 0) return Response.json({ sessions: [] });
        const employee = employees[0]!;

        const { data: sessions, error } = await db
          .from("engine_sessions")
          .select("id, created_at, last_active_at, turn_count, total_cost_usd")
          .eq("employee_id", employee.id)
          .order("last_active_at", { ascending: false })
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const ids = (sessions ?? []).map((s) => s.id as string);
        const titles = new Map<string, string>();
        if (ids.length > 0) {
          const { data: firsts } = await db
            .from("engine_messages")
            .select("session_id, content, created_at, role")
            .in("session_id", ids)
            .eq("role", "user")
            .order("created_at", { ascending: true });
          for (const row of firsts ?? []) {
            const key = row.session_id as string;
            if (!titles.has(key)) titles.set(key, row.content as string);
          }
        }

        return Response.json({
          sessions: (sessions ?? []).map((s) => ({
            id: s.id as string,
            title: titles.get(s.id as string) ?? "New chat",
            created_at: s.created_at as string,
            last_active_at: s.last_active_at as string,
            turn_count: (s.turn_count as number) ?? 0,
          })),
        });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        let body: { employee_code?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        const employees = await listEmployees(db);
        if (employees.length === 0) {
          return Response.json({ error: "No demo employees seeded." }, { status: 500 });
        }
        const code = body.employee_code ?? employees[0]!.employee_code;
        const employee = await loadEmployee(db, code);
        if (!employee) return Response.json({ error: `Unknown employee ${code}.` }, { status: 404 });

        const { data, error } = await db
          .from("engine_sessions")
          .insert({ employee_id: employee.id, baseline_mode: false })
          .select("id, created_at, last_active_at, turn_count")
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({
          session: {
            id: data.id as string,
            title: "New chat",
            created_at: data.created_at as string,
            last_active_at: data.last_active_at as string,
            turn_count: 0,
          },
        });
      },
    },
  },
});
