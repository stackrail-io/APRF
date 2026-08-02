/**
 * ai-vuln-scan-gate — SCI-M3 / repo-ai-vuln-scan-gate.
 *
 * Discovers vuln-scan / promote-gate signals for AI deps, images, and
 * model-serving runtimes. Import coverage unlocks PASS (measuredAt ≤90d).
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
import { asNum, collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-vuln-scan-gate";
const RELATED = ["SCI-M3"] as const;
const DETECTOR_ID = "repo-ai-vuln-scan-gate";
const IMPORT_MAX_AGE_DAYS = 90;

const SCAN_RE =
  /\b(trivy|grype|snyk|aquasec|vulnerability[_-]?scan|vuln[_-]?scan|image[_-]?scan)\b/i;
const MODEL_SERVING_RE =
  /\b(vllm|tgi|text[_-]?generation[_-]?inference|triton[_-]?inference|ollama|llama\.cpp|tensorrt|cuda)\b/i;
const BLOCK_PROMOTE_RE =
  /\b(block[_-]?(promote|deploy|release)|fail[_-]?(on[_-]?)?(critical|high)|severity[_-]?gate|vuln[_-]?gate)\b/i;
const DEPS_RE =
  /\b(dependabot|renovate|npm[_-]?audit|pip[_-]?audit|osv[_-]?scanner)\b/i;

export interface AiVulnScanGateReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    vulnScan: { found: boolean; refs: string[] };
    modelServing: { found: boolean; refs: string[] };
    blockPromote: { found: boolean; refs: string[] };
    dependencyUpdate: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiArtifactsPresent: boolean | null;
    scanCoveragePct: number | null;
    criticalFindingsBlockPromotion: boolean | null;
    skippedScans: number | null;
    retainedResults: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    sciM3Satisfied: boolean | null;
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
): AiVulnScanGateReport["importedResults"] {
  const sources: string[] = [];
  let productionAiArtifactsPresent: boolean | null = null;
  let scanCoveragePct: number | null = null;
  let criticalFindingsBlockPromotion: boolean | null = null;
  let skippedScans: number | null = null;
  let retainedResults: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-vuln-scan-gate-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAiArtifactsPresent = mergeOrBool(
        productionAiArtifactsPresent,
        asBool(data.productionAiArtifactsPresent) ??
          asBool(data.production_ai_artifacts_present),
      );
      scanCoveragePct = mergeMinNum(
        scanCoveragePct,
        asNum(data.scanCoveragePct) ?? asNum(data.scan_coverage_pct),
      );
      criticalFindingsBlockPromotion = mergeAndBool(
        criticalFindingsBlockPromotion,
        asBool(data.criticalFindingsBlockPromotion) ??
          asBool(data.critical_findings_block_promotion),
      );
      skippedScans = mergeMaxNum(
        skippedScans,
        asNum(data.skippedScans) ?? asNum(data.skipped_scans),
      );
      retainedResults = mergeAndBool(
        retainedResults,
        asBool(data.retainedResults) ?? asBool(data.retained_results),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiArtifactsPresent,
    scanCoveragePct,
    criticalFindingsBlockPromotion,
    skippedScans,
    retainedResults,
    measuredAt,
    sources,
  };
}

export function buildAiVulnScanGateReport(opts: {
  assessedAt: string;
  vulnScan: { found: boolean; refs: string[] };
  modelServing: { found: boolean; refs: string[] };
  blockPromote: { found: boolean; refs: string[] };
  dependencyUpdate: { found: boolean; refs: string[] };
  imported: AiVulnScanGateReport["importedResults"];
}): AiVulnScanGateReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.vulnScan.found ||
    opts.modelServing.found ||
    opts.blockPromote.found ||
    opts.dependencyUpdate.found;
  const surfaceProvedForNaOverride =
    opts.vulnScan.found || opts.modelServing.found || opts.blockPromote.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI vuln-scan-gate signals — SCI-M3 remains not demonstrated until scan coverage + critical-block evidence or productionAiArtifactsPresent=false is imported.",
    );
  }
  if (opts.vulnScan.found) {
    notes.push(`Vuln-scan refs: ${opts.vulnScan.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.modelServing.found) {
    notes.push(
      `Model-serving refs: ${opts.modelServing.refs.slice(0, 3).join(", ")}; ensure these runtimes are in scan scope.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionAiArtifactsPresent}, coverage=${opts.imported.scanCoveragePct}, blockCritical=${opts.imported.criticalFindingsBlockPromotion}, skipped=${opts.imported.skippedScans}, retained=${opts.imported.retainedResults}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import scanCoveragePct=100 + criticalFindingsBlockPromotion=true + skippedScans=0 + retainedResults=true (measuredAt ≤90d) under imports/ai-vuln-scan-gate/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scanPresent =
    opts.vulnScan.found ||
    opts.imported.productionAiArtifactsPresent === true ||
    opts.imported.scanCoveragePct !== null;
  const coverageOk = opts.imported.scanCoveragePct === 100;
  const blockOk = opts.imported.criticalFindingsBlockPromotion === true;
  const skippedOk = opts.imported.skippedScans === 0;
  const retainedOk = opts.imported.retainedResults === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionAiArtifactsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.scanCoveragePct !== null &&
      opts.imported.scanCoveragePct < 100) ||
    opts.imported.criticalFindingsBlockPromotion === false ||
    (opts.imported.skippedScans !== null && opts.imported.skippedScans > 0) ||
    opts.imported.retainedResults === false;
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: AiVulnScanGateReport["summary"]["statusHint"];
  let sciM3Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    sciM3Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete scan coverage, missing critical block, skipped scans, or missing retention — SCI-M3 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    sciM3Satisfied = null;
    notes.push(
      "Imported productionAiArtifactsPresent=false — SCI-M3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAiArtifactsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAiArtifactsPresent=false ignored — in-repo scan/model-serving/block signals prove the surface exists.",
    );
    if (
      scanPresent &&
      coverageOk &&
      blockOk &&
      skippedOk &&
      retainedOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sciM3Satisfied = true;
    } else {
      statusHint = "partial";
      sciM3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciM3Satisfied = null;
  } else if (
    scanPresent &&
    coverageOk &&
    blockOk &&
    skippedOk &&
    retainedOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sciM3Satisfied = true;
  } else {
    statusHint = "partial";
    sciM3Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      vulnScan: opts.vulnScan,
      modelServing: opts.modelServing,
      blockPromote: opts.blockPromote,
      dependencyUpdate: opts.dependencyUpdate,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      sciM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiVulnScanGateCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const scanRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SCAN_RE.test(p) || SCAN_RE.test(t),
      10,
    );
    const servingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MODEL_SERVING_RE.test(p) || MODEL_SERVING_RE.test(t),
      10,
    );
    const blockRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => BLOCK_PROMOTE_RE.test(p) || BLOCK_PROMOTE_RE.test(t),
      10,
    );
    const depsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DEPS_RE.test(p) || DEPS_RE.test(t),
      10,
    );

    const report = buildAiVulnScanGateReport({
      assessedAt: ctx.assessedAt.toISOString(),
      vulnScan: { found: scanRefs.length > 0, refs: scanRefs },
      modelServing: { found: servingRefs.length > 0, refs: servingRefs },
      blockPromote: { found: blockRefs.length > 0, refs: blockRefs },
      dependencyUpdate: { found: depsRefs.length > 0, refs: depsRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-vuln-scan-gate-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-M3 status=${report.summary.statusHint} satisfied=${report.summary.sciM3Satisfied}; report=imports/${PLUGIN_ID}/ai-vuln-scan-gate-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/ai-vuln-scan-gate-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "sci-m3",
            DETECTOR_ID,
            "repo-vuln-scan-config",
            ...(report.summary.sciM3Satisfied ? ["sci-m3-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
