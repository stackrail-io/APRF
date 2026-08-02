/**
 * ai-verify-on-deploy — SCI-R1 / repo-ai-verify-on-deploy.
 *
 * Discovers verify-on-deploy / promote-path signature checks.
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

const PLUGIN_ID = "ai-verify-on-deploy";
const RELATED = ["SCI-R1"] as const;
const DETECTOR_ID = "repo-ai-verify-on-deploy";
const IMPORT_MAX_AGE_DAYS = 90;

const VERIFY_DEPLOY_RE =
  /\b(verify[_-]?on[_-]?deploy|cosign[_-]?verify|notation[_-]?verify|attest(ation)?[_-]?verify|slsa[_-]?verifier)\b/i;
const UNSIGNED_REJECT_RE =
  /\b(reject[_-]?unsigned|block[_-]?unsigned|unsigned[_-]?(fail|deny|reject)|fail[_-]?if[_-]?unsigned)\b/i;
const PROMOTE_GATE_RE =
  /\b(promote[_-]?gate|deploy[_-]?gate|release[_-]?gate).{0,40}(sign|attest|cosign|notation)\b|\b(sign|attest|cosign|notation).{0,40}(promote[_-]?gate|deploy[_-]?gate)\b/i;

export interface AiVerifyOnDeployReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    verifyDeploy: { found: boolean; refs: string[] };
    unsignedReject: { found: boolean; refs: string[] };
    promoteGate: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionModelOrContainerArtifactsDeployed: boolean | null;
    lastDeployVerified: boolean | null;
    unsignedRejectedInTestOrCanary: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    sciR1Satisfied: boolean | null;
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
): AiVerifyOnDeployReport["importedResults"] {
  const sources: string[] = [];
  let productionModelOrContainerArtifactsDeployed: boolean | null = null;
  let lastDeployVerified: boolean | null = null;
  let unsignedRejectedInTestOrCanary: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-verify-on-deploy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionModelOrContainerArtifactsDeployed = mergeOrBool(
        productionModelOrContainerArtifactsDeployed,
        asBool(data.productionModelOrContainerArtifactsDeployed) ??
          asBool(data.production_model_or_container_artifacts_deployed),
      );
      lastDeployVerified = mergeAndBool(
        lastDeployVerified,
        asBool(data.lastDeployVerified) ?? asBool(data.last_deploy_verified),
      );
      unsignedRejectedInTestOrCanary = mergeAndBool(
        unsignedRejectedInTestOrCanary,
        asBool(data.unsignedRejectedInTestOrCanary) ??
          asBool(data.unsigned_rejected_in_test_or_canary),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionModelOrContainerArtifactsDeployed,
    lastDeployVerified,
    unsignedRejectedInTestOrCanary,
    measuredAt,
    sources,
  };
}

export function buildAiVerifyOnDeployReport(opts: {
  assessedAt: string;
  verifyDeploy: { found: boolean; refs: string[] };
  unsignedReject: { found: boolean; refs: string[] };
  promoteGate: { found: boolean; refs: string[] };
  imported: AiVerifyOnDeployReport["importedResults"];
}): AiVerifyOnDeployReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.verifyDeploy.found ||
    opts.unsignedReject.found ||
    opts.promoteGate.found;
  const surfaceProvedForNaOverride =
    opts.verifyDeploy.found || opts.promoteGate.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No verify-on-deploy signals — SCI-R1 remains not demonstrated until last-deploy verify + unsigned-reject evidence or productionModelOrContainerArtifactsDeployed=false is imported.",
    );
  }
  if (opts.verifyDeploy.found) {
    notes.push(
      `Verify-on-deploy refs: ${opts.verifyDeploy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (deployed=${opts.imported.productionModelOrContainerArtifactsDeployed}, lastVerified=${opts.imported.lastDeployVerified}, unsignedRejected=${opts.imported.unsignedRejectedInTestOrCanary}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import lastDeployVerified=true + unsignedRejectedInTestOrCanary=true (measuredAt ≤90d) under imports/ai-verify-on-deploy/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const gatePresent =
    surfaceProvedForNaOverride ||
    opts.imported.lastDeployVerified === true ||
    opts.imported.productionModelOrContainerArtifactsDeployed === true;
  const verifiedOk = opts.imported.lastDeployVerified === true;
  const rejectOk = opts.imported.unsignedRejectedInTestOrCanary === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionModelOrContainerArtifactsDeployed === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    opts.imported.lastDeployVerified === false ||
    opts.imported.unsignedRejectedInTestOrCanary === false;
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: AiVerifyOnDeployReport["summary"]["statusHint"];
  let sciR1Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    sciR1Satisfied = false;
    notes.push(
      "Imported evidence shows last deploy not verified or unsigned reject missing — SCI-R1 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    sciR1Satisfied = null;
    notes.push(
      "Imported productionModelOrContainerArtifactsDeployed=false — SCI-R1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionModelOrContainerArtifactsDeployed === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionModelOrContainerArtifactsDeployed=false ignored — in-repo verify-on-deploy signals prove the surface exists.",
    );
    if (
      gatePresent &&
      verifiedOk &&
      rejectOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sciR1Satisfied = true;
    } else {
      statusHint = "partial";
      sciR1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciR1Satisfied = null;
  } else if (
    gatePresent &&
    verifiedOk &&
    rejectOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sciR1Satisfied = true;
  } else {
    statusHint = "partial";
    sciR1Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      verifyDeploy: opts.verifyDeploy,
      unsignedReject: opts.unsignedReject,
      promoteGate: opts.promoteGate,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      sciR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiVerifyOnDeployCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const verifyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => VERIFY_DEPLOY_RE.test(p) || VERIFY_DEPLOY_RE.test(t),
      10,
    );
    const rejectRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => UNSIGNED_REJECT_RE.test(p) || UNSIGNED_REJECT_RE.test(t),
      10,
    );
    const promoteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => PROMOTE_GATE_RE.test(p) || PROMOTE_GATE_RE.test(t),
      10,
    );

    const report = buildAiVerifyOnDeployReport({
      assessedAt: ctx.assessedAt.toISOString(),
      verifyDeploy: { found: verifyRefs.length > 0, refs: verifyRefs },
      unsignedReject: { found: rejectRefs.length > 0, refs: rejectRefs },
      promoteGate: { found: promoteRefs.length > 0, refs: promoteRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-verify-on-deploy-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-R1 status=${report.summary.statusHint} satisfied=${report.summary.sciR1Satisfied}; report=imports/${PLUGIN_ID}/ai-verify-on-deploy-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/ai-verify-on-deploy-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "sci-r1",
            DETECTOR_ID,
            "cosign-verification",
            ...(report.summary.sciR1Satisfied ? ["sci-r1-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
