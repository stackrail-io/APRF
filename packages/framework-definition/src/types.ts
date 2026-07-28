/**
 * APRF Framework Definition types — Profiles, Policy overlays, Check applicability.
 *
 * Policy may customize Checks only — never Requirements.
 * Normative architecture: see ARCHITECTURE.md at the repository root.
 */

/** Criticality tier (1–3) as used across APRF profiles. */
export type CriticalityTier = 1 | 2 | 3;

/** Capability maturity floor implied by a profile. */
export type CapabilityLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Profile narrows the full Check catalog for adopters.
 * Core = Tier-2 production minimum; Regulated = Core ∪ Tier-3 mandatories.
 */
export interface AprfProfile {
  id: string;
  name: string;
  summary: string;
  targetCriticality: CriticalityTier;
  targetCapability: CapabilityLevel;
  /** Mandatory check IDs that form the gate for this profile. */
  mandatoryCheckIds: string[];
  rationale: string[];
}

/**
 * Lens adds mandatory Check IDs for a system type (RAG, Agents, Voice, Coding).
 * Assessment gate = profile.mandatoryCheckIds ∪ lens.additionalMandatoryCheckIds.
 */
export interface AprfLens {
  id: string;
  name: string;
  summary: string;
  appliesTo: string[];
  recommendedBaseProfileId: string;
  targetCapability: CapabilityLevel;
  additionalMandatoryCheckIds: string[];
  rationale: string[];
}

/** How a Check applies under a Policy overlay. */
export type CheckApplicability =
  | "mandatory"
  | "recommended"
  | "informational"
  | "not_applicable";

/**
 * Per-Check Policy overlay. Never mutates Requirements — only Check gate behavior.
 */
export interface CheckPolicyOverlay {
  checkId: string;
  applicability?: CheckApplicability;
  /** Optional severity bump/downgrade for Assessment (not Detection truth). */
  severityOverride?: "critical" | "high" | "medium" | "low" | "info";
  /** Org rationale when marking N/A — required for attestation integrity. */
  naJustification?: string;
  /** Owner / steward for this overlay. */
  steward?: string;
}

/**
 * Organization Policy — Check overlays only.
 * Attestations should record `policyDigest` so local overlays remain visible.
 */
export interface AprfPolicy {
  id: string;
  name: string;
  orgId?: string;
  /** Framework SemVer this policy was authored against. */
  aprfVersion: string;
  /** Profile ids this policy assumes (e.g. aprf-profile-core). */
  profileIds: string[];
  checkOverlays: CheckPolicyOverlay[];
  /** Content digest of overlays (sha256 hex) — set by buildPolicyDigest helpers. */
  policyDigest?: string;
  updatedAt?: string;
}

/** Resolve effective applicability for a check given profile + policy. */
export function resolveCheckApplicability(
  checkId: string,
  profile: AprfProfile,
  policy?: AprfPolicy | null,
): CheckApplicability {
  const overlay = policy?.checkOverlays.find((o) => o.checkId === checkId);
  if (overlay?.applicability) return overlay.applicability;
  if (profile.mandatoryCheckIds.includes(checkId)) return "mandatory";
  return "recommended";
}

/** True when policy attempts to change Requirements (forbidden — detect by convention). */
export function policyTouchesRequirements(policy: AprfPolicy): boolean {
  return policy.checkOverlays.some(
    (o) =>
      "requirementId" in (o as object) ||
      "requirementOverride" in (o as object),
  );
}

export function listOverlayCheckIds(policy: AprfPolicy): string[] {
  return policy.checkOverlays.map((o) => o.checkId);
}
