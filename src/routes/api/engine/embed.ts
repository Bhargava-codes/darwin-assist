import { createFileRoute } from "@tanstack/react-router";
import { embedSmall } from "@/lib/engine/embed.server";
import { buildEngineChunks } from "@/lib/engine/policy-chunks";

/**
 * Idempotent corpus build for the engine's RAG index. Upserts every derived
 * chunk, then embeds only the rows still missing a vector.
 */
export const Route = createFileRoute("/api/engine/embed")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "AI is not configured." }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const chunks = buildEngineChunks();

        const { error: upsertError } = await supabaseAdmin.from("policy_chunks_small").upsert(
          chunks.map((c) => ({
            chunk_id: c.chunk_id,
            section: c.section,
            heading: c.heading,
            content: c.content,
            object_tags: c.object_tags,
          })),
          { onConflict: "chunk_id" },
        );
        if (upsertError) {
          return Response.json({ error: upsertError.message }, { status: 500 });
        }

        const { data: pending } = await supabaseAdmin
          .from("policy_chunks_small")
          .select("chunk_id, heading, content")
          .is("embedding", null);

        const rows = pending ?? [];
        if (rows.length === 0) {
          return Response.json({ chunks: chunks.length, embedded: 0, status: "up_to_date" });
        }

        const embedded = await embedSmall(
          apiKey,
          rows.map((r) => `${r.heading}\n${r.content}`),
        );

        for (let i = 0; i < rows.length; i++) {
          const vector = embedded.vectors[i];
          if (!vector) continue;
          const { error } = await supabaseAdmin
            .from("policy_chunks_small")
            .update({ embedding: JSON.stringify(vector) })
            .eq("chunk_id", rows[i]!.chunk_id);
          if (error) return Response.json({ error: error.message }, { status: 500 });
        }

        return Response.json({
          chunks: chunks.length,
          embedded: rows.length,
          input_tokens: embedded.input_tokens,
          latency_ms: embedded.latency_ms,
        });
      },
    },
  },
});
