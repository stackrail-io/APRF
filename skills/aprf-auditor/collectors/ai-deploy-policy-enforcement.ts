/**
 * ai-deploy-policy-enforcement — SCI-M4 / repo-ai-deploy-policy-enforcement.
 *
 * Discovers deploy-path policy (admission, pipeline, cloud, registry, platform).
 * Import coverage unlocks PASS (measuredAt ≤90d). CI signing alone ≠ PASS.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import { ensureDir, listImportFiles, readText, redact } from "./lib/fs.ts";
import { collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-deploy-policy-enforcement";
const RELATED = ["SCI-M4"] as const;
const DETECTOR_ID = "repo-ai-deploy-policy-enforcement";
const IMPORT_MAX_AGE_DAYS = 90;

const ADMISSION_RE =
  /\b(gatekeeper|kyverno|policy[_-]?controller|ratify|connaisseur|clusterimagepolicy|validating[_-]?admission|opa[_-]?gatekeeper)\b/i;
const DEPLOY_POLICY_RE =
  /\b(deploy[_-]?policy|promote[_-]?gate|registry[_-]?admission|image[_-]?policy|unsigned[_-]?(block|reject)|verify[_-]?on[_-]?deploy)\b/i;
const CLOUD_GATE_RE =
  /\b(cloud[_-]?run[_-]?policy|ecs[_-]?task[_-]?definition|lambda[_-]?deploy|vertex[_-]?ai|sagemaker|azure[_-]?ai[_-]?foundry)\b/i;

export interface AiDeployPolicyEnforcementReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    admission: { found: boolean; refs: string[] };
    deployPolicy: { found: boolean; refs: string[] };
    cloudGate: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiArtifactsDeployed: boolean | null;
    deploymentPolicyEnforced: boolean | null;
    unsignedBlocked: boolean | null;
    unapprovedBlocked: boolean | null;
    revokedOrUntrustedRejected: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    sciM4Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function loadImported(
  ctx: CollectorContext,
): AiDeployPolicyEnforcementReport["importedResults"] {
  const sources: string[] = [];
  let productionAiArtifactsDeployed: boolean | null = null;
  let deploymentPolicyEnforced: boolean | null = null;
  let unsignedBlocked: boolean | null = null;
  let unapprovedBlocked: boolean | null = null;
  let revokedOrUntrustedRejected: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-deploy-policy-enforcement-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAiArtifactsDeployed = mergeOrBool(
        productionAiArtifactsDeployed,
        asBool(data.productionAiArtifactsDeployed) ??
          asBool(data.production_ai_artifacts_deployed),
      );
      deploymentPolicyEnforced = mergeAndBool(
        deploymentPolicyEnforced,
        asBool(data.deploymentPolicyEnforced) ??
          asBool(data.deployment_policy_enforced),
      );
      unsignedBlocked = mergeAndBool(
        unsignedBlocked,
        asBool(data.unsignedBlocked) ?? asBool(data.unsigned_blocked),
      );
      unapprovedBlocked = mergeAndBool(
        unapprovedBlocked,
        asBool(data.unapprovedBlocked) ?? asBool(data.unapproved_blocked),
      );
      revokedOrUntrustedRejected = mergeAndBool(
        revokedOrUntrustedRejected,
        asBool(data.revokedOrUntrustedRejected) ??
          asBool(data.revoked_or_untrusted_rejected),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiArtifactsDeployed,
    deploymentPolicyEnforced,
    unsignedBlocked,
    unapprovedBlocked,
    revokedOrUntrustedRejected,
    measuredAt,
    sources,
  };
}

export function buildAiDeployPolicyEnforcementReport(opts: {
  assessedAt: string;
  admission: { found: boolean; refs: string[] };
  deployPolicy: { found: boolean; refs: string[] };
  cloudGate: { found: boolean; refs: string[] };
  imported: AiDeployPolicyEnforcementReport["importedResults"];
}): AiDeployPolicyEnforcementReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.admission.found || opts.deployPolicy.found || opts.cloudGate.found;
  const surfaceProvedForNaOverride = gateSignalsPresent;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI deploy-policy signals — SCI-M4 remains not demonstrated until deploy-path enforcement evidence or productionAiArtifactsDeployed=false is imported. Level-5 / regulated advanced mandatory.",
    );
  }
  if (opts.admission.found) {
    notes.push(
      `Admission refs: ${opts.admission.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.deployPolicy.found) {
    notes.push(
      `Deploy-policy refs: ${opts.deployPolicy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (deployed=${opts.imported.productionAiArtifactsDeployed}, enforced=${opts.imported.deploymentPolicyEnforced}, unsigned=${opts.imported.unsignedBlocked}, unapproved=${opts.imported.unapprovedBlocked}, revoked=${opts.imported.revokedOrUntrustedRejected}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import deploymentPolicyEnforced + unsignedBlocked + unapprovedBlocked + revokedOrUntrustedRejected (measuredAt ≤90d) under imports/ai-deploy-policy-enforcement/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const policyPresent =
    gateSignalsPresent || opts.imported.deploymentPolicyEnforced === true;
  const allBlocks =
    opts.imported.unsignedBlocked === true &&
    opts.imported.unapprovedBlocked === true &&
    opts.imported.revokedOrUntrustedRejected === true &&
    opts.imported.deploymentPolicyEnforced === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionAiArtifactsDeployed === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    opts.imported.deploymentPolicyEnforced === false ||
    opts.imported.unsignedBlocked === false ||
    opts.imported.unapprovedBlocked === false ||
    opts.imported.revokedOrUntrustedRejected === false;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: AiDeployPolicyEnforcementReport["summary"]["statusHint"];
  let sciM4Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    sciM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing deploy policy or incomplete unsigned/unapproved/revoked blocks — SCI-M4 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    sciM4Satisfied = null;
    notes.push(
      "Imported productionAiArtifactsDeployed=false — SCI-M4 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAiArtifactsDeployed === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAiArtifactsDeployed=false ignored — in-repo deploy-policy signals prove the surface exists.",
    );
    if (policyPresent && allBlocks && importFresh && opts.imported.found) {
      statusHint = "pass";
      sciM4Satisfied = true;
    } else {
      statusHint = "partial";
      sciM4Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciM4Satisfied = null;
  } else if (policyPresent && allBlocks && importFresh && opts.imported.found) {
    statusHint = "pass";
    sciM4Satisfied = true;
  } else {
    statusHint = "partial";
    sciM4Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      admission: opts.admission,
      deployPolicy: opts.deployPolicy,
      cloudGate: opts.cloudGate,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      sciM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDeployPolicyEnforcementCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const admissionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ADMISSION_RE.test(p) || ADMISSION_RE.test(t),
      10,
    );
    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DEPLOY_POLICY_RE.test(p) || DEPLOY_POLICY_RE.test(t),
      10,
    );
    const cloudRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => CLOUD_GATE_RE.test(p) || CLOUD_GATE_RE.test(t),
      10,
    );

    const report = buildAiDeployPolicyEnforcementReport({
      assessedAt: ctx.assessedAt.toISOString(),
      admission: { found: admissionRefs.length > 0, refs: admissionRefs },
      deployPolicy: { found: policyRefs.length > 0, refs: policyRefs },
      cloudGate: { found: cloudRefs.length > 0, refs: cloudRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-deploy-policy-enforcement-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-M4 status=${report.summary.statusHint} satisfied=${report.summary.sciM4Satisfied}; report=imports/${PLUGIN_ID}/ai-deploy-policy-enforcement-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/ai-deploy-policy-enforcement-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "sci-m4",
            DETECTOR_ID,
            ...(report.summary.sciM4Satisfied ? ["sci-m4-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
