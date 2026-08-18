import {
  normalizeCapabilities,
  lensIdsForCapabilities,
} from "./applicationCapabilities.js";
import { getLensById, unionProfileAndLenses } from "./lenses.js";
import {
  getProfileById,
  PROFILE_CORE,
  PROFILE_FRAMEWORK,
  PROFILE_ID_CORE,
  PROFILE_ID_FRAMEWORK,
  PROFILE_ID_REGULATED,
  PROFILE_REGULATED,
} from "./profiles.js";
import type { AprfProfile } from "./types.js";

export type AssessmentSystemType =
  | "ai-application"
  | "ai-framework"
  | "non-ai-platform"
  | "unknown";

export type AssessmentKind =
  | "aprf-core"
  | "aprf-regulated"
  | "aprf-framework"
  | "full-catalog"
  | "non-ai-platform-subset";

export type ClaimMetadata = {
  allowed: string[];
  forbidden: string[];
  reportBanner: string;
};

export type ResolveAssessmentTargetInput = {
  systemType: AssessmentSystemType;
  /** Optional profile override; validated against systemType. */
  profileId?: string;
  /** applicationCapabilities; ignored unless ai-application. */
  capabilities?: string[];
  /** Explicit CLI --lens ids (short or full). */
  explicitLensIds?: string[];
  /** Full catalog scoring; forbidden with ai-framework. */
  fullCatalog?: boolean;
};

export type ResolveAssessmentTargetResult = {
  profile: AprfProfile;
  mandatoryCheckIds: string[];
  lensIds: string[];
  effectiveCheckIds: string[];
  assessmentKind: AssessmentKind;
  claimMetadata: ClaimMetadata;
  /** Normalized capability ids recorded on scope (ai-application only). */
  applicationCapabilities: string[];
  systemType: AssessmentSystemType;
  warnings: string[];
};

const CORE_CLAIM: ClaimMetadata = {
  allowed: [
    "APRF Core production readiness",
    "APRF Core gate PASS/FAIL",
  ],
  forbidden: [],
  reportBanner: "",
};

const REGULATED_CLAIM: ClaimMetadata = {
  allowed: [
    "APRF Regulated production readiness",
    "APRF Regulated gate PASS/FAIL",
  ],
  forbidden: [],
  reportBanner: "",
};

const FRAMEWORK_CLAIM: ClaimMetadata = {
  allowed: ["APRF Framework / SDK primitive gate"],
  forbidden: [
    "APRF Core production readiness",
    "APRF Regulated gate",
    "AI Production Readiness PASS",
  ],
  reportBanner:
    "FRAMEWORK / SDK PRIMITIVE GATE — This is not an APRF Core or Regulated production-readiness assessment. The target was classified as an AI framework or SDK. Re-run with systemType=ai-application and aprf-profile-core (plus applicationCapabilities) against the product application to claim AI production readiness.",
};

const NON_AI_CLAIM: ClaimMetadata = {
  allowed: [
    "Non-AI platform subset gate (auditor scope)",
    "Platform hygiene against selected APRF Check IDs",
  ],
  forbidden: [
    "APRF Core production readiness",
    "APRF Regulated gate",
    "AI Production Readiness PASS",
  ],
  reportBanner:
    "NON-AI / PLATFORM SUBSET — This is not an APRF Core or Regulated production-readiness assessment. The target was classified as a non–GenAI system (platform, console, or tooling). Re-run with systemType=ai-application and aprf-profile-core against the AI product repo to claim AI production readiness.",
};

function normalizeProfileId(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw === "core") return PROFILE_ID_CORE;
  if (raw === "regulated") return PROFILE_ID_REGULATED;
  if (raw === "framework") return PROFILE_ID_FRAMEWORK;
  return raw;
}

function normalizeExplicitLensIds(raw: string[] | undefined): string[] {
  if (!raw?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const id = r.startsWith("aprf-lens-")
      ? r
      : `aprf-lens-${r.replace(/^lens-/, "")}`;
    if (!getLensById(id)) {
      throw new Error(`Unknown lens id: ${r}`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function resolveAppProfile(profileId: string | undefined): AprfProfile {
  const id = normalizeProfileId(profileId) ?? PROFILE_ID_CORE;
  if (id === PROFILE_ID_FRAMEWORK) {
    throw new Error(
      "profileId aprf-profile-framework is incompatible with systemType=ai-application. Use systemType=ai-framework or a Core/Regulated profile.",
    );
  }
  if (id === PROFILE_ID_REGULATED) return PROFILE_REGULATED;
  if (id === PROFILE_ID_CORE) return PROFILE_CORE;
  const p = getProfileById(id);
  if (!p) {
    throw new Error(`Unknown APRF profile: ${profileId}`);
  }
  if (p.id === PROFILE_ID_FRAMEWORK) {
    throw new Error(
      "profileId aprf-profile-framework is incompatible with systemType=ai-application.",
    );
  }
  return p;
}

const NON_AI_PLACEHOLDER_PROFILE: AprfProfile = {
  id: "aprf-scope-non-ai-platform",
  name: "Non-AI platform (legacy auditor scope)",
  summary:
    "Placeholder profile object for systemType=non-ai-platform. Check IDs come from skills/aprf-auditor/scopes/non-ai-platform.yaml — not from this profile. Do not claim Core or Regulated readiness.",
  targetCriticality: 2,
  targetCapability: 3,
  mandatoryCheckIds: [],
  rationale: [
    "v1 keeps non-AI Check lists in the auditor scope YAML to avoid forking SoT into profiles.ts.",
  ],
};

/**
 * Canonical assessment target resolution (RFC-0013 precedence).
 * Consumers (CLI, skill via `aprf resolve-target`, tests, UI) must call this
 * instead of hand-assembling profile ∪ lenses.
 */
export function resolveAssessmentTarget(
  input: ResolveAssessmentTargetInput,
): ResolveAssessmentTargetResult {
  const warnings: string[] = [];
  const systemType = input.systemType;

  if (systemType === "unknown") {
    throw new Error(
      'systemType "unknown" cannot resolve an assessment target. Classify as ai-application, ai-framework, or non-ai-platform first.',
    );
  }

  if (systemType === "non-ai-platform") {
    if (input.fullCatalog) {
      throw new Error(
        "fullCatalog is not supported with systemType=non-ai-platform.",
      );
    }
    warnings.push(
      "use-legacy-non-ai-scope: load skills/aprf-auditor/scopes/non-ai-platform.yaml for Check IDs until a non-ai profile exists. profile.id=aprf-scope-non-ai-platform is a placeholder — do not claim Core from this result.",
    );
    return {
      profile: NON_AI_PLACEHOLDER_PROFILE,
      mandatoryCheckIds: [],
      lensIds: [],
      effectiveCheckIds: [],
      assessmentKind: "non-ai-platform-subset",
      claimMetadata: NON_AI_CLAIM,
      applicationCapabilities: [],
      systemType,
      warnings,
    };
  }

  if (systemType === "ai-framework") {
    const requested = normalizeProfileId(input.profileId);
    if (
      requested &&
      requested !== PROFILE_ID_FRAMEWORK
    ) {
      throw new Error(
        `systemType=ai-framework requires profile aprf-profile-framework (got ${requested}). Do not use Core/Regulated for framework/SDK targets.`,
      );
    }
    if (input.fullCatalog) {
      throw new Error(
        "fullCatalog is forbidden with systemType=ai-framework (would imply a Core-style catalog claim).",
      );
    }
    if (input.explicitLensIds?.length) {
      warnings.push(
        "Product lenses ignored for systemType=ai-framework; Framework profile is the full gate.",
      );
    }
    if (input.capabilities?.length) {
      warnings.push(
        "applicationCapabilities ignored for systemType=ai-framework.",
      );
    }
    const profile = PROFILE_FRAMEWORK;
    const mandatoryCheckIds = [...profile.mandatoryCheckIds];
    return {
      profile,
      mandatoryCheckIds,
      lensIds: [],
      effectiveCheckIds: [...mandatoryCheckIds],
      assessmentKind: "aprf-framework",
      claimMetadata: FRAMEWORK_CLAIM,
      applicationCapabilities: [],
      systemType,
      warnings,
    };
  }

  // ai-application
  if (input.fullCatalog) {
    const profile = resolveAppProfile(input.profileId);
    const caps = normalizeCapabilities(input.capabilities ?? []);
    if (caps.length === 0) {
      warnings.push(
        "No applicationCapabilities provided; scoring Core/Regulated mandatories only. Skill should prompt for capabilities.",
      );
    }
    const capLenses = lensIdsForCapabilities(caps);
    const explicit = normalizeExplicitLensIds(input.explicitLensIds);
    const lensIds = unionLensIds(capLenses, explicit);
    return {
      profile,
      mandatoryCheckIds: [...profile.mandatoryCheckIds],
      lensIds,
      // full catalog scored by assess; effective gate mandatories still profile∪lenses
      effectiveCheckIds: unionProfileAndLenses(
        profile.mandatoryCheckIds,
        lensIds,
      ),
      assessmentKind: "full-catalog",
      claimMetadata:
        profile.id === PROFILE_ID_REGULATED ? REGULATED_CLAIM : CORE_CLAIM,
      applicationCapabilities: caps,
      systemType,
      warnings,
    };
  }

  const profile = resolveAppProfile(input.profileId);
  const caps = normalizeCapabilities(input.capabilities ?? []);
  if (caps.length === 0) {
    warnings.push(
      "No applicationCapabilities provided; scoring Core/Regulated mandatories only. Skill should prompt for capabilities.",
    );
  }
  const capLenses = lensIdsForCapabilities(caps);
  const explicit = normalizeExplicitLensIds(input.explicitLensIds);
  const lensIds = unionLensIds(capLenses, explicit);
  const effectiveCheckIds = unionProfileAndLenses(
    profile.mandatoryCheckIds,
    lensIds,
  );

  return {
    profile,
    mandatoryCheckIds: [...profile.mandatoryCheckIds],
    lensIds,
    effectiveCheckIds,
    assessmentKind:
      profile.id === PROFILE_ID_REGULATED ? "aprf-regulated" : "aprf-core",
    claimMetadata:
      profile.id === PROFILE_ID_REGULATED ? REGULATED_CLAIM : CORE_CLAIM,
    applicationCapabilities: caps,
    systemType,
    warnings,
  };
}

function unionLensIds(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...a, ...b]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
