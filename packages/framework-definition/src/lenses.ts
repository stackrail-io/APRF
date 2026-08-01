import type { AprfLens } from "./types.js";

/**
 * Built-in APRF lenses — additional mandatory Check IDs for system types.
 * Union with a profile’s mandatory set when claiming a lens in an assessment.
 */
export const LENS_ID_RAG = "aprf-lens-rag";
export const LENS_ID_AGENTS = "aprf-lens-agents";
export const LENS_ID_VOICE = "aprf-lens-voice";
export const LENS_ID_CODING = "aprf-lens-coding";

export const LENS_RAG: AprfLens = {
  id: LENS_ID_RAG,
  name: "RAG",
  summary:
    "Retrieval-augmented generation: corpus ownership, context labeling, memory isolation, and retrieval-quality gates.",
  appliesTo: ["RAG", "Chatbots", "AI Agents"],
  recommendedBaseProfileId: "aprf-profile-core",
  targetCapability: 3,
  additionalMandatoryCheckIds: [
    "DG-M1",
    "DG-M2",
    "DG-M3",
    "CTX-M1",
    "CTX-M2",
    "CTX-M3",
    "MEM-M1",
    "MEM-M2",
    "MEM-M3",
    "PRI-M1",
    "EVL-M1",
    "EVL-M2",
    "SEC-M1",
    "OBS-M1",
  ],
  rationale: [
    "Retrieval corpora need owners, versioning, and promotion controls (DG).",
    "Retrieved content must be sized, labeled, and access-controlled in context (CTX).",
    "Vector/memory stores inherit tenant isolation and retention (MEM).",
    "Eval gates must cover retrieval quality and grounding regressions (EVL).",
  ],
};

export const LENS_AGENTS: AprfLens = {
  id: LENS_ID_AGENTS,
  name: "Agents",
  summary:
    "Autonomous and tool-using agents: charters, step budgets, tool mediation, human gates, and kill switches.",
  appliesTo: [
    "AI Agents",
    "Multi-agent systems",
    "MCP Servers",
    "A2A Systems",
    "Coding Agents",
    "Autonomous systems",
  ],
  recommendedBaseProfileId: "aprf-profile-core",
  targetCapability: 3,
  additionalMandatoryCheckIds: [
    "AGN-M1",
    "AGN-M2",
    "AGN-M3",
    "AGN-M4",
    "TOL-M1",
    "TOL-M2",
    "TOL-M3",
    "TOL-M4",
    "HUM-M1",
    "HUM-M2",
    "HUM-M3",
    "AUTHZ-M1",
    "AUTHZ-M2",
    "AUTHN-M2",
    "COST-M3",
    "OBS-M1",
    "REL-M1",
    "REL-M3",
  ],
  rationale: [
    "Every production agent needs a charter and hard step/time limits (AGN).",
    "Tools fail closed with allowlists and schema validation (TOL).",
    "High-impact actions require non-bypassable human approval (HUM).",
    "Agent identities stay least-privilege; loops cannot burn unbounded spend (AUTHZ/COST).",
  ],
};

export const LENS_VOICE: AprfLens = {
  id: LENS_ID_VOICE,
  name: "Voice",
  summary:
    "Voice and telephony AI: session identity, privacy of recordings, latency SLOs, safety, and escalation paths.",
  appliesTo: ["Voice AI", "Chatbots"],
  recommendedBaseProfileId: "aprf-profile-core",
  targetCapability: 3,
  additionalMandatoryCheckIds: [
    "AUTHN-M1",
    "AUTHN-M2",
    "PRI-M1",
    "PRI-M2",
    "OBS-M1",
    "OBS-M2",
    "PERF-M1",
    "PERF-M2",
    "REL-M1",
    "REL-M2",
    "SAF-M1",
    "SAF-M2",
    "HUM-M1",
    "INC-M1",
    "COST-M1",
    "TOL-M1",
  ],
  rationale: [
    "Telephony sessions must authenticate before privileged tools (AUTHN).",
    "Call audio and transcripts are sensitive personal data (PRI).",
    "Latency and degraded mode matter more under real-time constraints (PERF/REL).",
    "Safety refusals and human escalation must work on voice channels (SAF/HUM).",
  ],
};

export const LENS_CODING: AprfLens = {
  id: LENS_ID_CODING,
  name: "Coding agents",
  summary:
    "IDE and repo-connected coding agents: sandboxing, secret hygiene, tool allowlists, supply chain, and human gates for destructive changes.",
  appliesTo: ["Coding Agents", "AI Agents", "MCP Servers"],
  recommendedBaseProfileId: "aprf-profile-core",
  targetCapability: 3,
  additionalMandatoryCheckIds: [
    "AGN-M1",
    "AGN-M3",
    "AGN-M4",
    "TOL-M4",
    "HUM-M2",
    "SEC-M2",
    "SEC-M4",
    "SCI-M1",
    "SCI-M3",
    "PRM-M3",
    "AUTHZ-M3",
    "DX-M1",
    "DX-M2",
    "INF-M2",
  ],
  rationale: [
    "Coding agents need explicit charters, kill switches, and peer auth for multi-agent hops (AGN).",
    "Shell/file tools require schema validation and fail-closed allowlists (TOL).",
    "Repo and cloud credentials must stay out of prompts; model path stays bounded (SEC).",
    "Dependency and model supply chain plus platform sandboxes reduce blast radius (SCI/DX/INF).",
  ],
};

export const APRF_LENSES: AprfLens[] = [
  LENS_RAG,
  LENS_AGENTS,
  LENS_VOICE,
  LENS_CODING,
];

export function getLensById(id: string): AprfLens | undefined {
  return APRF_LENSES.find((l) => l.id === id);
}

/** Profile mandatory IDs ∪ lens additional IDs (deduped, profile order then lens order). */
export function unionProfileAndLenses(
  profileMandatoryCheckIds: string[],
  lensIds: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of profileMandatoryCheckIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const lensId of lensIds) {
    const lens = getLensById(lensId);
    if (!lens) continue;
    for (const id of lens.additionalMandatoryCheckIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}
