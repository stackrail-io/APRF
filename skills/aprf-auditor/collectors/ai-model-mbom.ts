/**
 * ai-model-mbom — SCI-R2 / repo-ai-model-mbom.
 *
 * Discovers MBOM / ML-BOM / model-registry SBOM linkage signals.
 * Import coverage unlocks PASS (measuredAt ≤90d). Container-only SBOM ≠ PASS.
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
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-model-mbom";
const RELATED = ["SCI-R2"] as const;
const DETECTOR_ID = "repo-ai-model-mbom";
const IMPORT_MAX_AGE_DAYS = 90;

const MBOM_RE =
  /\b(mbom|ml[_-]?bom|model[_-]?bom|machine[_-]?learning[_-]?bill[_-]?of[_-]?materials|cyclonedx.{0,40}ml)\b/i;
const MODEL_REGISTRY_RE =
  /\b(model[_-]?registry|mlflow|sagemaker[_-]?model[_-]?package|vertex[_-]?model|huggingface[_-]?hub)\b/i;
const SBOM_RE =
  /\b(sbom|cyclonedx|spdx|syft|bom\.json)\b/i;

export interface AiModelMbomReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    mbom: { found: boolean; refs: string[] };
    modelRegistry: { found: boolean; refs: string[] };
    sbom: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionModelPinsPresent: boolean | null;
    pinsWithLinkedMbomPct: number | null;
    retentionDaysSatisfied: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    modelMetadataPresent: boolean;
    sciR2Satisfied: boolean | null;
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
): AiModelMbomReport["importedResults"] {
  const sources: string[] = [];
  let productionModelPinsPresent: boolean | null = null;
  let pinsWithLinkedMbomPct: number | null = null;
  let retentionDaysSatisfied: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-model-mbom-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionModelPinsPresent = mergeOrBool(
        productionModelPinsPresent,
        asBool(data.productionModelPinsPresent) ??
          asBool(data.production_model_pins_present),
      );
      pinsWithLinkedMbomPct = mergeMinNum(
        pinsWithLinkedMbomPct,
        asNum(data.pinsWithLinkedMbomPct) ??
          asNum(data.pins_with_linked_mbom_pct) ??
          asNum(data.mbomCoveragePct),
      );
      const retentionDays = asNum(data.mbomRetentionDays) ??
        asNum(data.mbom_retention_days);
      const retentionFlag =
        asBool(data.retentionDaysSatisfied) ??
        asBool(data.retention_days_satisfied) ??
        (retentionDays !== null ? retentionDays >= 90 : null);
      retentionDaysSatisfied = mergeAndBool(
        retentionDaysSatisfied,
        retentionFlag,
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionModelPinsPresent,
    pinsWithLinkedMbomPct,
    retentionDaysSatisfied,
    measuredAt,
    sources,
  };
}

export function buildAiModelMbomReport(opts: {
  assessedAt: string;
  mbom: { found: boolean; refs: string[] };
  modelRegistry: { found: boolean; refs: string[] };
  sbom: { found: boolean; refs: string[] };
  imported: AiModelMbomReport["importedResults"];
}): AiModelMbomReport {
  const notes: string[] = [];
  const modelMetadataPresent = opts.mbom.found || opts.modelRegistry.found;
  const gateSignalsPresent =
    modelMetadataPresent || opts.sbom.found;
  // Container SBOM alone does not prove model-pin surface for N/A override.
  const surfaceProvedForNaOverride = modelMetadataPresent;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No MBOM/model-registry signals — SCI-R2 remains not demonstrated until registry-linked MBOM coverage or productionModelPinsPresent=false is imported.",
    );
  }
  if (opts.mbom.found) {
    notes.push(`MBOM refs: ${opts.mbom.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.sbom.found && !opts.mbom.found) {
    notes.push(
      `SBOM refs: ${opts.sbom.refs.slice(0, 3).join(", ")}; container-only SBOM without model metadata ≠ PASS.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (pinsPresent=${opts.imported.productionModelPinsPresent}, linkedPct=${opts.imported.pinsWithLinkedMbomPct}, retentionOk=${opts.imported.retentionDaysSatisfied}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import pinsWithLinkedMbomPct=100 + retentionDaysSatisfied=true (measuredAt ≤90d) under imports/ai-model-mbom/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const inventoryPresent =
    modelMetadataPresent ||
    opts.imported.productionModelPinsPresent === true;
  const coverageOk = opts.imported.pinsWithLinkedMbomPct === 100;
  const retentionOk = opts.imported.retentionDaysSatisfied === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionModelPinsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.pinsWithLinkedMbomPct !== null &&
      opts.imported.pinsWithLinkedMbomPct < 100) ||
    opts.imported.retentionDaysSatisfied === false;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: AiModelMbomReport["summary"]["statusHint"];
  let sciR2Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    sciR2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete MBOM linkage or retention <90 days — SCI-R2 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    sciR2Satisfied = null;
    notes.push(
      "Imported productionModelPinsPresent=false — SCI-R2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionModelPinsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionModelPinsPresent=false ignored — in-repo MBOM/registry signals prove the surface exists.",
    );
    if (
      inventoryPresent &&
      coverageOk &&
      retentionOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sciR2Satisfied = true;
    } else {
      statusHint = "partial";
      sciR2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciR2Satisfied = null;
  } else if (
    inventoryPresent &&
    coverageOk &&
    retentionOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sciR2Satisfied = true;
  } else {
    statusHint = "partial";
    sciR2Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      mbom: opts.mbom,
      modelRegistry: opts.modelRegistry,
      sbom: opts.sbom,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      modelMetadataPresent,
      sciR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiModelMbomCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const mbomRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MBOM_RE.test(p) || MBOM_RE.test(t),
      10,
    );
    const regRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MODEL_REGISTRY_RE.test(p) || MODEL_REGISTRY_RE.test(t),
      10,
    );
    const sbomRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SBOM_RE.test(p) || SBOM_RE.test(t),
      10,
    );

    const report = buildAiModelMbomReport({
      assessedAt: ctx.assessedAt.toISOString(),
      mbom: { found: mbomRefs.length > 0, refs: mbomRefs },
      modelRegistry: { found: regRefs.length > 0, refs: regRefs },
      sbom: { found: sbomRefs.length > 0, refs: sbomRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-model-mbom-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-R2 status=${report.summary.statusHint} satisfied=${report.summary.sciR2Satisfied}; report=imports/${PLUGIN_ID}/ai-model-mbom-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/ai-model-mbom-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "sci-r2",
            DETECTOR_ID,
            "repo-sbom-config",
            ...(report.summary.sciR2Satisfied ? ["sci-r2-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
