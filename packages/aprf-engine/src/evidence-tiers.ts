/**
 * Evidence Assurance Tiers (APRF-RFC-0011).
 *
 * Orthogonal to retention tiers (ephemeral / digest / attested) and to
 * confidence scores. A Check may PASS only when achievedTier >= minimumTier
 * and collector/passCondition metrics also hold.
 */
import type {
  DetectionCapability,
  EvidenceTier,
  RuleEvidencePolicy,
} from "./types.js";
import { EVIDENCE_TIERS } from "./types.js";

export type EvidenceVerification =
  | "NONE"
  | "UNVERIFIED"
  | "VERIFIED"
  | "NOT_APPLICABLE";

export type EvidenceClassLike =
  | "runtime"
  | "ci"
  | "iac"
  | "runtime-config"
  | "policy"
  | "code"
  | "docs"
  | "user"
  | string;

const TIER_RANK: Record<EvidenceTier, number> = {
  E0: 0,
  E1: 1,
  E2: 2,
  E3: 3,
  E4: 4,
  E5: 5,
};

/** Map evidence-graph node class → default assurance tier. */
export const CLASS_TO_TIER: Record<string, EvidenceTier> = {
  user: "E1",
  docs: "E2",
  code: "E2",
  iac: "E3",
  policy: "E3",
  "runtime-config": "E3",
  ci: "E3",
  runtime: "E4",
};

/**
 * Evidence classes → candidate type IDs from spec/evidence-types.yaml.
 * Used to populate matched[] from observed graph classes (not invented).
 */
export const CLASS_TO_EVIDENCE_TYPES: Record<string, readonly string[]> = {
  user: ["self_attestation"],
  docs: ["repo_signal"],
  code: ["repo_signal"],
  iac: [
    "iac_module",
    "network_policy",
    "cloud_egress_policy",
    "runtime_network_config",
    "cis_policy_scan",
  ],
  policy: ["cis_policy_scan", "network_policy"],
  "runtime-config": ["runtime_network_config"],
  ci: ["cis_policy_scan", "repo_signal"],
  runtime: [
    "reachability_probe",
    "cspm_scan",
    "policy_scan_report",
    "patching_sla_report",
    "connectivity_deny_probe",
    "accelerator_isolation_test",
  ],
};

/** Default minimumTier when Check omits evidencePolicy.minimumTier. */
export function defaultMinimumTier(
  capability: DetectionCapability | undefined,
): EvidenceTier {
  switch (capability) {
    case "automated":
      return "E4";
    case "hybrid":
      return "E3";
    case "manual":
    case "none":
    default:
      return "E1";
  }
}

export function resolveMinimumTier(
  policy: RuleEvidencePolicy | undefined,
  capability: DetectionCapability | undefined,
): EvidenceTier {
  const raw = policy?.minimumTier;
  if (raw && (EVIDENCE_TIERS as readonly string[]).includes(raw)) {
    return raw;
  }
  return defaultMinimumTier(capability);
}

export function parseEvidenceTier(raw: unknown): EvidenceTier | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return (EVIDENCE_TIERS as readonly string[]).includes(t)
    ? (t as EvidenceTier)
    : null;
}

export function tierRank(tier: EvidenceTier): number {
  return TIER_RANK[tier] ?? 0;
}

export function maxTier(a: EvidenceTier, b: EvidenceTier): EvidenceTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function tierMeetsFloor(
  achieved: EvidenceTier,
  minimum: EvidenceTier,
): boolean {
  return tierRank(achieved) >= tierRank(minimum);
}

export function tierFromEvidenceClass(
  cls: EvidenceClassLike | undefined,
): EvidenceTier {
  if (!cls) return "E0";
  return CLASS_TO_TIER[cls] ?? "E2";
}

/**
 * Classify achieved tier from related evidence nodes + measured/import context.
 * Do not derive measuredImportPresent from statusHint=pass — that launders the floor.
 */
export function classifyAchievedTier(opts: {
  evidenceClasses: EvidenceClassLike[];
  /** True when a fresh measured import / runtime pack is present (not from pass hint). */
  measuredImportPresent?: boolean;
  /** Evidence node or plugin declared independent verification. */
  independentVerification?: boolean;
  /** Self-attestation without higher-class artifacts. */
  selfAttestationOnly?: boolean;
  /** Repo/collector signals present (found refs) without measured import. */
  repoSignalsPresent?: boolean;
  /**
   * Optional plugin-declared emit tier (emitsEvidenceTier). When the graph has
   * no classed nodes but the plugin reported signals, label those signals at
   * most E2 (repo) — never boost to meet an E3+ floor without measured import.
   */
  pluginEmitsTier?: EvidenceTier | null;
}): EvidenceTier {
  if (opts.independentVerification) return "E5";
  if (opts.measuredImportPresent) return "E4";

  let best: EvidenceTier = "E0";
  for (const cls of opts.evidenceClasses) {
    best = maxTier(best, tierFromEvidenceClass(cls));
  }
  if (best === "E0" && opts.repoSignalsPresent) best = "E2";
  if (best === "E0" && opts.selfAttestationOnly) best = "E1";

  if (
    opts.pluginEmitsTier &&
    opts.repoSignalsPresent &&
    !opts.measuredImportPresent &&
    opts.evidenceClasses.length === 0
  ) {
    // Wire emitsEvidenceTier without laundering E3+ floors from Git alone.
    const labeled =
      tierRank(opts.pluginEmitsTier) <= 2 ? opts.pluginEmitsTier : "E2";
    best = maxTier(best, labeled);
  }
  return best;
}

/**
 * UNVERIFIED means achieved < minimum (with substance). Floor-met PARTIAL
 * (metrics incomplete) is NONE — not "below floor".
 */
export function verificationFor(opts: {
  status:
    | "PASS"
    | "FAIL"
    | "PARTIAL"
    | "NOT_DEMONSTRATED"
    | "NOT_APPLICABLE";
  achieved: EvidenceTier;
  minimum: EvidenceTier;
}): EvidenceVerification {
  if (opts.status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (opts.status === "NOT_DEMONSTRATED" || opts.achieved === "E0") {
    return "NONE";
  }
  if (!tierMeetsFloor(opts.achieved, opts.minimum)) {
    return "UNVERIFIED";
  }
  if (opts.status === "PASS") return "VERIFIED";
  return "NONE";
}

/**
 * Observed evidence type IDs, optionally intersected with acceptableEvidence.
 * Never invents IDs that were not implied by classes / measured / independent flags.
 */
export function matchedEvidenceTypes(opts: {
  evidenceClasses: EvidenceClassLike[];
  acceptable: string[];
  measuredImportPresent?: boolean;
  independentVerification?: boolean;
  repoSignalsPresent?: boolean;
}): string[] {
  const candidates = new Set<string>();
  if (opts.independentVerification) {
    candidates.add("independent_assessment");
  }
  if (opts.measuredImportPresent) {
    for (const t of CLASS_TO_EVIDENCE_TYPES.runtime ?? []) {
      candidates.add(t);
    }
  }
  for (const cls of opts.evidenceClasses) {
    const types = CLASS_TO_EVIDENCE_TYPES[cls];
    if (types) {
      for (const t of types) candidates.add(t);
    } else if (cls) {
      candidates.add("repo_signal");
    }
  }
  if (opts.repoSignalsPresent && candidates.size === 0) {
    candidates.add("repo_signal");
  }

  const list = [...candidates];
  if (!opts.acceptable.length) return list.slice(0, 8);
  return list.filter((id) => opts.acceptable.includes(id));
}

export interface ControlEvidenceTier {
  minimum: EvidenceTier;
  achieved: EvidenceTier;
  acceptable: string[];
  matched: string[];
  verification: EvidenceVerification;
}
