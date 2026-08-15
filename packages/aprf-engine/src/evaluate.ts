import type {
  AprfRule,
  CriticalityTier,
  CapabilityLevel,
  Technology,
} from "./types.js";
import type { DetectorRegistry } from "./detectors/types.js";

export type RuleOutcomeStatus =
  | "passed"
  | "failed"
  | "notApplicable"
  | "error"
  | "skipped";

export interface AttestedOutcome {
  ruleId: string;
  passed: boolean;
  notApplicable?: boolean;
  naReason?: string;
  evidenceRef?: string;
}

export interface EvaluationContext {
  criticality: CriticalityTier;
  /** Highest capability level the org claims; used with requiredFromLevel. */
  capabilityLevel?: CapabilityLevel;
  technologies?: Technology[];
  profileId?: string;
  lensIds?: string[];
  /** When set, only these rule IDs form the selection gate (profile ∪ lenses style). */
  gateRuleIds?: string[];
}

export interface RuleFinding {
  ruleId: string;
  status: RuleOutcomeStatus;
  summary: string;
  evidenceRef?: string;
  naReason?: string;
  detectorIds?: string[];
}

export function selectApplicableRules(
  rules: AprfRule[],
  ctx: EvaluationContext,
): AprfRule[] {
  const techSet =
    ctx.technologies && ctx.technologies.length > 0
      ? new Set(ctx.technologies)
      : null;

  return rules.filter((rule) => {
    if (rule.status === "draft" || rule.status === "deprecated") return false;
    if (rule.deprecated === true) return false;

    if (rule.applicability.minCriticality > ctx.criticality) return false;

    if (
      ctx.capabilityLevel != null &&
      rule.applicability.requiredFromLevel > ctx.capabilityLevel
    ) {
      return false;
    }

    if (ctx.gateRuleIds && ctx.gateRuleIds.length > 0) {
      if (!ctx.gateRuleIds.includes(rule.id)) return false;
    }

    if (techSet) {
      const ruleTechs = rule.applicability.technologies ?? [];
      if (ruleTechs.length > 0 && !ruleTechs.some((t) => techSet.has(t))) {
        return false;
      }
    }

    if (ctx.profileId && rule.applicability.profiles?.length) {
      if (!rule.applicability.profiles.includes(ctx.profileId)) return false;
    }

    if (ctx.lensIds?.length && rule.applicability.lenses?.length) {
      if (!rule.applicability.lenses.some((l) => ctx.lensIds!.includes(l))) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Evaluate rules in attestation-first mode.
 *
 * Default: attestation-only (`runDetectors: false`). Product engines that supply
 * a real `DetectorRegistry` may set `runDetectors: true`.
 *
 * When scoring detectors, `manual-attest` is skipped only if at least one
 * non-manual detector is configured (it is an attestation fallback via
 * `attested`, not an auto-scored detector alongside real ones). If it is the
 * sole configured detector, it still runs and cannot auto-PASS. Remaining
 * detectors are AND-ed.
 */
export async function evaluateRules(
  rules: AprfRule[],
  ctx: EvaluationContext,
  options: {
    attested?: AttestedOutcome[];
    registry?: DetectorRegistry;
    /**
     * When true, run detectors from `registry` for unattested rules.
     * Default false — this normative package does not ship working detectors.
     */
    runDetectors?: boolean;
  } = {},
): Promise<RuleFinding[]> {
  const applicable = selectApplicableRules(rules, ctx);
  const attestedById = new Map(
    (options.attested ?? []).map((a) => [a.ruleId, a]),
  );
  const runDetectors = options.runDetectors === true;
  const registry = options.registry;

  if (runDetectors && !registry) {
    throw new Error(
      "evaluateRules: runDetectors requires a product DetectorRegistry (this package ships attestation-only)",
    );
  }

  const findings: RuleFinding[] = [];

  for (const rule of applicable) {
    const attested = attestedById.get(rule.id);
    if (attested) {
      if (attested.notApplicable) {
        findings.push({
          ruleId: rule.id,
          status: "notApplicable",
          summary: attested.naReason ?? "Not applicable",
          naReason: attested.naReason,
          evidenceRef: attested.evidenceRef,
        });
        continue;
      }
      findings.push({
        ruleId: rule.id,
        status: attested.passed ? "passed" : "failed",
        summary: attested.passed ? "Attested pass" : "Attested fail",
        evidenceRef: attested.evidenceRef,
      });
      continue;
    }

    const detectors = rule.detection.detectors ?? [];
    if (
      !runDetectors ||
      !registry ||
      detectors.length === 0 ||
      rule.detection.capability === "manual" ||
      rule.detection.capability === "none"
    ) {
      findings.push({
        ruleId: rule.id,
        status: "failed",
        summary: "No attestation provided",
      });
      continue;
    }

    // Skip manual-attest when other detectors exist (attestation via `attested`).
    // If it is the only configured detector, it still runs and cannot auto-PASS.
    const scoredDetectors = detectors.filter((d) => d.id !== "manual-attest");
    const refsToRun =
      scoredDetectors.length > 0 ? scoredDetectors : detectors;

    let allPassed = true;
    const summaries: string[] = [];
    const detectorIds: string[] = [];
    let evidenceRef: string | undefined;
    let errored = false;

    for (const ref of refsToRun) {
      const detector = registry.get(ref.id);
      detectorIds.push(ref.id);
      if (!detector) {
        allPassed = false;
        errored = true;
        summaries.push(`Unknown detector: ${ref.id}`);
        continue;
      }
      try {
        const result = await detector.run(
          { technologies: ctx.technologies },
          ref.params ?? {},
        );
        if (!result.passed) allPassed = false;
        if (result.error) errored = true;
        summaries.push(result.summary);
        if (result.evidenceRef) evidenceRef = result.evidenceRef;
      } catch (err) {
        allPassed = false;
        errored = true;
        summaries.push(
          err instanceof Error ? err.message : `Detector ${ref.id} threw`,
        );
      }
    }

    findings.push({
      ruleId: rule.id,
      status: errored ? "error" : allPassed ? "passed" : "failed",
      summary: summaries.join("; "),
      evidenceRef,
      detectorIds,
    });
  }

  return findings;
}

/**
 * Map findings to attestation-shaped outcomes.
 * N/A is never treated as a pass — callers must honor `notApplicable`.
 * Detector failures set `error: true` and `status: "error"` (never silent pass).
 */
export function findingsToCheckOutcomes(findings: RuleFinding[]): Array<{
  checkId: string;
  passed: boolean;
  status: RuleOutcomeStatus;
  notApplicable?: boolean;
  naReason?: string;
  evidenceRef?: string;
  error?: boolean;
  summary?: string;
}> {
  return findings.map((f) => ({
    checkId: f.ruleId,
    passed: f.status === "passed",
    status: f.status,
    ...(f.status === "notApplicable"
      ? { notApplicable: true, naReason: f.naReason }
      : {}),
    ...(f.status === "error" ? { error: true } : {}),
    ...(f.evidenceRef ? { evidenceRef: f.evidenceRef } : {}),
    ...(f.summary ? { summary: f.summary } : {}),
  }));
}
