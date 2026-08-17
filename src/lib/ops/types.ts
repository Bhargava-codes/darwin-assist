/** Shape of the /api/ops payload. Shared by the route handler and the console UI. */

export type AgentKeyT = "agent_1" | "agent_2" | "agent_3";

export type OpsStep = {
  turn_index: number;
  step_index: number;
  agent: AgentKeyT;
  role: string | null;
  model: string;
  tool: string | null;
  latency_ms: number;
  input: unknown;
  output: unknown;
};

export type OpsSession = {
  id: string;
  short_id: string;
  intent: string | null;
  latency_ms: number;
  per_agent: Record<AgentKeyT, number | null>;
  rag: number;
  tools: number;
  feedback: "up" | "down" | null;
  steps: OpsStep[];
};

export type OpsPayload = {
  value: {
    deflection_pct: number;
    resolved: number;
    total: number;
    feedback_pct: number;
    feedback_up: number;
    feedback_down: number;
    d7_pct: number;
    d7_maturing: boolean;
  };
  engagement: { conversations: number; aht_seconds: number };
  technical: {
    per_turn_p95_ms: number;
    turn1_p95_ms: number;
    turn2_p95_ms: number;
    session_p95_ms: number;
    avg_turns: number;
    agents: { agent: AgentKeyT; p95_ms: number; calls: number }[];
    tool_calls: number;
    rag_pulls: number;
  };
  cost: {
    per_session_usd: number;
    total_usd: number;
    sessions: number;
    agents: { agent: AgentKeyT; usd: number; share_pct: number }[];
  };
  sessions: OpsSession[];
  sessions_total: number;
};
