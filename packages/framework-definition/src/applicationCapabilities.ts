import {
  LENS_ID_AGENTS,
  LENS_ID_CODING,
  LENS_ID_RAG,
  LENS_ID_VOICE,
} from "./lenses.js";

/**
 * Orthogonal application capability flags for systemType=ai-application.
 * Not a subtype hierarchy — several may coexist (e.g. rag + agents + voice).
 * Named applicationCapabilities to avoid collision with maturity Capability Levels.
 */
export const APPLICATION_CAPABILITY_IDS = [
  "chatbot",
  "rag",
  "agents",
  "multi-agent-a2a",
  "mcp-server",
  "voice",
  "coding-agent",
  "other",
] as const;

export type ApplicationCapabilityId =
  (typeof APPLICATION_CAPABILITY_IDS)[number];

export type ApplicationCapabilityDef = {
  id: ApplicationCapabilityId;
  /** Lenses added when this capability is selected (additive onto the profile). */
  defaultLensIds: string[];
  summary: string;
};

export const APPLICATION_CAPABILITIES: Record<
  ApplicationCapabilityId,
  ApplicationCapabilityDef
> = {
  chatbot: {
    id: "chatbot",
    defaultLensIds: [],
    summary: "Conversational product surface; Core only unless other capabilities apply.",
  },
  rag: {
    id: "rag",
    defaultLensIds: [LENS_ID_RAG],
    summary: "Retrieval-augmented generation / corpus grounding.",
  },
  agents: {
    id: "agents",
    defaultLensIds: [LENS_ID_AGENTS],
    summary: "Autonomous or tool-using production agents.",
  },
  "multi-agent-a2a": {
    id: "multi-agent-a2a",
    defaultLensIds: [LENS_ID_AGENTS],
    summary: "Multi-agent / A2A handoffs (Agents lens; AGN-M4 in-scope).",
  },
  "mcp-server": {
    id: "mcp-server",
    defaultLensIds: [LENS_ID_AGENTS],
    summary: "MCP server or tool-host surface (Agents lens).",
  },
  voice: {
    id: "voice",
    defaultLensIds: [LENS_ID_VOICE],
    summary: "Voice / telephony AI.",
  },
  "coding-agent": {
    id: "coding-agent",
    defaultLensIds: [LENS_ID_CODING],
    summary: "IDE / repo-connected coding agents.",
  },
  other: {
    id: "other",
    defaultLensIds: [],
    summary: "Explicit escape hatch; Core only plus surface attestation.",
  },
};

/** Deduped lens IDs for the given capability set. Unknown IDs throw. */
export function lensIdsForCapabilities(capabilities: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const valid = new Set<string>(APPLICATION_CAPABILITY_IDS);
  for (const raw of capabilities) {
    const id = raw.trim();
    if (!id) continue;
    if (!valid.has(id)) {
      throw new Error(
        `Unknown applicationCapability "${id}". Valid: ${APPLICATION_CAPABILITY_IDS.join(", ")}`,
      );
    }
    const def = APPLICATION_CAPABILITIES[id as ApplicationCapabilityId];
    for (const lensId of def.defaultLensIds) {
      if (!seen.has(lensId)) {
        seen.add(lensId);
        out.push(lensId);
      }
    }
  }
  return out;
}

/** Dedupe capability IDs preserving first-seen order; validate. */
export function normalizeCapabilities(capabilities: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const valid = new Set<string>(APPLICATION_CAPABILITY_IDS);
  for (const raw of capabilities) {
    const id = raw.trim();
    if (!id) continue;
    if (!valid.has(id)) {
      throw new Error(
        `Unknown applicationCapability "${id}". Valid: ${APPLICATION_CAPABILITY_IDS.join(", ")}`,
      );
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
