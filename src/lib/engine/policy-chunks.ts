import { POLICY_CORPUS, type PolicyChunk, type PolicySubject } from "@/data/policy-corpus";

/**
 * Engine RAG corpus. One chunk per numbered clause, so a citation is auditable
 * against the source manual. Clause 1.1 (the leave-entitlement table) is split
 * one chunk per leave type plus the contract-employee note, because a single
 * table row is the unit a rule check needs — retrieving all seven types to
 * answer one question is what makes the naive pipeline expensive.
 *
 * Text is copied from src/data/policy-corpus.ts verbatim. Never paraphrase here.
 */

export type EngineChunk = {
  chunk_id: string;
  section: string;
  heading: string;
  content: string;
  object_tags: string[];
};

const SECTION_BY_PREFIX: Record<string, string> = {
  LEAVE: "Leave",
  ATTENDANCE: "Attendance",
  WFH: "Work From Home",
  GENERAL: "General",
};

function tagsFor(subject: PolicySubject): string[] {
  const [area, leaf] = subject.split(".") as [string, string];
  if (area === "LEAVE") {
    return leaf === "GENERAL" ? ["leave", "general_leave"] : ["leave", leaf];
  }
  if (area === "ATTENDANCE") return ["attendance", leaf.toLowerCase()];
  if (area === "WFH") return ["wfh", leaf.toLowerCase()];
  return ["general"];
}

function sectionFor(subject: PolicySubject): string {
  const prefix = subject.split(".")[0] ?? "GENERAL";
  return SECTION_BY_PREFIX[prefix] ?? "General";
}

/** "Casual Leave (CL) — 12 days/year — …" → code CL. */
const LEAVE_CODE = /\(([A-Z]{2})\)/;

function splitEntitlementTable(chunk: PolicyChunk): EngineChunk[] {
  const lines = chunk.text.split("\n");
  const header = lines[0] ?? chunk.heading;
  const out: EngineChunk[] = [];

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Note on Contract Employees")) {
      out.push({
        chunk_id: "1.1-CONTRACT",
        section: "Leave",
        heading: `${chunk.heading} — Contract employees and interns`,
        content: `${header}\n\n${trimmed}`,
        object_tags: ["leave", "general_leave", "contract"],
      });
      continue;
    }
    const code = LEAVE_CODE.exec(trimmed)?.[1];
    if (!code) continue;
    out.push({
      chunk_id: `1.1-${code}`,
      section: "Leave",
      heading: `${chunk.heading} — ${trimmed.split(" — ")[0] ?? code}`,
      content: `${header}\n\n${trimmed}`,
      object_tags: ["leave", code, "entitlement"],
    });
  }

  return out;
}

export function buildEngineChunks(): EngineChunk[] {
  const chunks: EngineChunk[] = [];
  for (const chunk of POLICY_CORPUS) {
    if (chunk.clause_id === "1.1") {
      chunks.push(...splitEntitlementTable(chunk));
      continue;
    }
    chunks.push({
      chunk_id: chunk.clause_id,
      section: sectionFor(chunk.subject),
      heading: chunk.heading,
      content: chunk.text,
      object_tags: tagsFor(chunk.subject),
    });
  }
  return chunks;
}

/** Full policy text, in clause order — used only by baseline (one-shot) mode. */
export function fullPolicyText(): string {
  return POLICY_CORPUS.map((c) => c.text).join("\n\n---\n\n");
}
