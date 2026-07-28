import type { AprfProfile } from "./types.js";

/**
 * Built-in APRF profiles — source of truth for mandatory Check ID gates.
 * Marketing site and product console must consume these (not redefine lists).
 */
export const PROFILE_ID_CORE = "aprf-profile-core";
export const PROFILE_ID_REGULATED = "aprf-profile-regulated";

/**
 * Tier-2 Core Profile — minimum mandatory gates for customer-facing AI.
 */
export const PROFILE_CORE: AprfProfile = {
  id: PROFILE_ID_CORE,
  name: "Core (Tier 2 Production)",
  summary:
    "Minimum mandatory gates for customer- or partner-facing AI. Pass this gate before claiming production readiness. Tier 3 and regulated systems must still assess the Regulated profile or full catalog.",
  targetCriticality: 2,
  targetCapability: 3,
  mandatoryCheckIds: [
    "AUTHN-M1",
    "AUTHN-M2",
    "AUTHZ-M1",
    "AUTHZ-M2",
    "SEC2-M1",
    "SEC2-M2",
    "SEC-M1",
    "SEC-M3",
    "TOL-M1",
    "TOL-M2",
    "TOL-M3",
    "SCI-M2",
    "INF-M1",
    "SAF-M1",
    "SAF-M2",
    "SAF-M3",
    "PRI-M1",
    "PRI-M3",
    "MEM-M1",
    "PRM-M1",
    "PRM-M2",
    "MOD-M1",
    "EVL-M1",
    "EVL-M2",
    "AGN-M2",
    "HUM-M1",
    "HUM-M3",
    "OBS-M1",
    "OBS-M2",
    "PERF-M1",
    "REL-M1",
    "REL-M2",
    "DEP-M1",
    "CHG-M1",
    "CHG-M3",
    "INC-M1",
    "INC-M2",
    "COST-M1",
    "COST-M3",
    "ORG-M2",
  ],
  rationale: [
    "Identity and authorization before any customer traffic (AUTHN/AUTHZ).",
    "Secrets and injection/tool mediation to prevent common AI incidents (SEC/TOL).",
    "Safety policy + eval gates so quality/harm regressions cannot silently ship (SAF/EVL).",
    "Pinned prompts/models with promotion evidence (PRM/MOD).",
    "Observability, timeouts, degraded mode, and tested rollback (OBS/REL/CHG).",
    "Spend ceilings to prevent denial-of-wallet (COST).",
    "Named owners so gates have stewards (ORG-M2).",
  ],
};

/**
 * Tier-3 Regulated Profile — Core plus mission-critical / regulated mandatories.
 */
export const PROFILE_REGULATED: AprfProfile = {
  id: PROFILE_ID_REGULATED,
  name: "Regulated (Tier 3)",
  summary:
    "Core Profile plus Tier-3-only mandatories for mission-critical or regulated AI (residency/DPIA, fairness, dual control, signed supply chain, chaos/continuity, independent assessment). Target capability Level 5.",
  targetCriticality: 3,
  targetCapability: 5,
  mandatoryCheckIds: [
    ...PROFILE_CORE.mandatoryCheckIds,
    "REL-M6",
    "ORG-M3",
    "CMP-M2",
    "SEC-M5",
    "AUTHN-M4",
    "AUTHZ-M4",
    "TOL-M5",
    "SCI-M4",
    "INF-M4",
    "SAF-M4",
    "EXP-M4",
    "PRI-M4",
    "PRI-M5",
    "MEM-M4",
    "EVL-M4",
    "HUM-M4",
    "REL-M7",
    "REL-M8",
    "CHG-M4",
    "INC-M4",
    "ORG-M4",
  ],
  rationale: [
    "Includes every Core gate — regulated systems must still clear production minimums.",
    "Adds residency/DPIA, fairness, dual control, and signed admission for regulated blast radius.",
    "Requires chaos/continuity drills, independent assessment sampling, and automated quality rollback triggers.",
    "Target capability Level 5 — Tier 3 is not Core with a different label.",
  ],
};

/** Built-in profiles list. */
export const APRF_PROFILES: AprfProfile[] = [PROFILE_CORE, PROFILE_REGULATED];

export function getProfileById(id: string): AprfProfile | undefined {
  return APRF_PROFILES.find((p) => p.id === id);
}

/** Tier-3-only mandatory IDs (in Regulated, not in Core). */
export function getTier3OnlyMandatoryIds(): string[] {
  const core = new Set(PROFILE_CORE.mandatoryCheckIds);
  return PROFILE_REGULATED.mandatoryCheckIds.filter((id) => !core.has(id));
}
