import { createFileRoute } from "@tanstack/react-router";
import { openConversation, resolveCaller } from "@/lib/ai/conversation.server";

/**
 * Thumbs up / down on one assistant reply. Written with the caller's own client,
 * so RLS proves the conversation belongs to them. One rating per turn — a second
 * submission replaces the first.
 */
export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await resolveCaller(request);
        if (!caller) return Response.json({ error: "Not signed in." }, { status: 401 });

        let body: { turn_index?: unknown; rating?: unknown; note?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }

        const turnIndex = Number(body.turn_index);
        const rating = body.rating;
        const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
        if (!Number.isInteger(turnIndex) || turnIndex < 0) {
          return Response.json({ error: "turn_index is required." }, { status: 400 });
        }
        if (rating !== "up" && rating !== "down") {
          return Response.json({ error: "rating must be up or down." }, { status: 400 });
        }

        const conversation = await openConversation(caller);
        const { error } = await caller.user.from("feedback").upsert(
          {
            conversation_id: conversation.id,
            turn_index: turnIndex,
            rating,
            note,
          },
          { onConflict: "conversation_id,turn_index" },
        );
        if (error) {
          console.error("feedback upsert failed", error.message);
          return Response.json({ error: "Could not save that." }, { status: 500 });
        }

        return Response.json({ ok: true, rating });
      },
    },
  },
});
