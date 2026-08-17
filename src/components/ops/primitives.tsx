import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the HR Ops console.
 * House rules: zero radius, 1px borders, no shadows, mono + tabular-nums on
 * every number, hairline gaps made with `gap-px` over a line-coloured grid.
 */

export type AgentKey = "agent_1" | "agent_2" | "agent_3";

export const AGENT_META: Record<AgentKey, { label: string; text: string; bg: string; soft: string }> =
  {
    agent_1: {
      label: "A1",
      text: "text-ops-violet",
      bg: "bg-ops-violet",
      soft: "bg-ops-violet-soft",
    },
    agent_2: {
      label: "A2",
      text: "text-ops-teal",
      bg: "bg-ops-teal",
      soft: "bg-ops-teal-soft",
    },
    agent_3: {
      label: "A3",
      text: "text-ops-amber",
      bg: "bg-ops-amber",
      soft: "bg-ops-amber-soft",
    },
  };

export function AgentDot({ agent, className }: { agent: AgentKey; className?: string }) {
  return <span className={cn("h-2 w-2 shrink-0", AGENT_META[agent].bg, className)} />;
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        className="inline-flex text-ops-faint transition-colors hover:text-ops-muted focus:outline-none focus-visible:text-ops-ink"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-5 z-30 w-64 -translate-x-1/2 border border-ops-shell-line bg-ops-shell p-2.5 text-[11px] leading-relaxed text-ops-shell-text opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function SectionHead({
  index,
  title,
  hint,
}: {
  index: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[13px] tabular-nums text-ops-faint">{index}</span>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ops-strong">
        {title}
      </h2>
      <span className="text-[12px] text-ops-muted">{hint}</span>
    </div>
  );
}

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-ops-surface p-5", className)}>{children}</div>;
}

export function HairlineGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-px border border-ops-line bg-ops-line", className)}>
      {children}
    </div>
  );
}

export function Metric({
  label,
  value,
  sub,
  tip,
  size = "normal",
  tone,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tip?: string;
  size?: "big" | "normal";
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <Cell>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-ops-muted">{label}</span>
        {tip && <Tip text={tip} />}
      </div>
      <p
        className={cn(
          "mt-2 font-mono tabular-nums leading-none",
          size === "big" ? "text-[30px]" : "text-[20px]",
          tone ?? "text-ops-ink",
        )}
      >
        {value}
      </p>
      {children}
      {sub && <p className="mt-2 text-[12px] text-ops-muted">{sub}</p>}
    </Cell>
  );
}

export function Panel({
  title,
  tip,
  children,
}: {
  title: string;
  tip?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-ops-line bg-ops-surface p-5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-ops-muted">{title}</span>
        {tip && <Tip text={tip} />}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

export function AgentBar({
  agent,
  fraction,
  value,
  meta,
}: {
  agent: AgentKey;
  /** 0–1 share of the bar track. */
  fraction: number;
  value: string;
  meta: string;
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="flex items-center gap-3">
      <AgentDot agent={agent} />
      <span className={cn("w-6 font-mono text-[11px]", AGENT_META[agent].text)}>
        {AGENT_META[agent].label}
      </span>
      <div className="h-2 flex-1 bg-ops-hairline">
        <div className={cn("h-2", AGENT_META[agent].bg)} style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 text-right font-mono text-[12px] tabular-nums text-ops-ink">
        {value}
      </span>
      <span className="w-20 text-right font-mono text-[11px] tabular-nums text-ops-faint">
        {meta}
      </span>
    </div>
  );
}
