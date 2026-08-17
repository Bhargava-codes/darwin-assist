import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useHr } from "@/lib/hr/store";

export const Route = createFileRoute("/assistant/")({
  head: () => ({
    meta: [
      { title: "Ask HR — Darwinbox HR Assistant" },
      {
        name: "description",
        content:
          "Open your latest HR chat, or start a new one. Every answer comes from your HR policy, with the clause attached.",
      },
      { property: "og:title", content: "Ask HR — Darwinbox HR Assistant" },
      {
        property: "og:description",
        content: "Open your latest HR chat, or start a new one.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantEntry,
});

/** Sends you into a real chat URL: the most recent one, or a fresh one. */
function AssistantEntry() {
  const { ready, sessions, newSession } = useHr();
  const navigate = useNavigate();
  const sent = useRef(false);

  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    (async () => {
      const latest = sessions[0]?.id ?? (await newSession());
      if (latest) void navigate({ to: "/assistant/$sessionId", params: { sessionId: latest } });
    })();
  }, [navigate, newSession, ready, sessions]);

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <p className="text-[13px] text-muted-foreground">Opening your chat…</p>
    </div>
  );
}
