/**
 * multimodal-input-scan — SEC-R2 / repo-multimodal-input-scan.
 *
 * Discovers pre-ingest multimodal content-safety/malware scanning.
 * Import multimodalInputsAccepted + scannerRunsBeforeModelIngest +
 * imageFileTypesInUseCoveredInLastReport + unscannedProductionMultimodalPaths=0
 * under imports/multimodal-input-scan/ to unlock PASS (measuredAt ≤90d).
 * multimodalInputsAccepted=false → NOT_APPLICABLE.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "multimodal-input-scan";
const RELATED = ["SEC-R2"] as const;
const DETECTOR_ID = "repo-multimodal-input-scan";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MULTIMODAL_RE =
  /\b(multimodal|multi[_-]?modal|image[_-]?(upload|input)|file[_-]?(upload|ingest)|vision[_-]?(input|model)|document[_-]?upload|audio[_-]?(input|upload))\b/i;

const SCANNER_RE =
  /\b(malware[_-]?(scan|scanner)|content[_-]?safety[_-]?(scan|scanner)|avir|clamav|moderation[_-]?(image|vision|file)|safe[_-]?search|image[_-]?moderation)\b/i;

const PRE_INGEST_RE =
  /\b(before[_-]?(model[_-]?)?ingest|pre[_-]?(ingest|model)|scan[_-]?before[_-]?(infer|model)|gateway[_-]?scan)\b/i;

const COVERAGE_RE =
  /\b(unscanned|scan[_-]?coverage|file[_-]?type[_-]?cover|mime[_-]?type[_-]?(allow|cover)|media[_-]?type[_-]?inventor)\b/i;

export interface MultimodalInputScanReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    multimodal: { found: boolean; refs: string[] };
    scanner: { found: boolean; refs: string[] };
    preIngest: { found: boolean; refs: string[] };
    coverage: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    multimodalInputsAccepted: boolean | null;
    scannerRunsBeforeModelIngest: boolean | null;
    imageFileTypesInUseCoveredInLastReport: boolean | null;
    unscannedProductionMultimodalPaths: number | null;
    lastReportAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secR2Satisfied: boolean | null;
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

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".toml",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): MultimodalInputScanReport["importedResults"] {
  const sources: string[] = [];
  let multimodalInputsAccepted: boolean | null = null;
  let scannerRunsBeforeModelIngest: boolean | null = null;
  let imageFileTypesInUseCoveredInLastReport: boolean | null = null;
  let unscannedProductionMultimodalPaths: number | null = null;
  let lastReportAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/multimodal-input-scan-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastReportAgeDays =
        asNum(data.lastReportAgeDays) ??
        asNum(data.last_report_age_days) ??
        lastReportAgeDays;
      multimodalInputsAccepted =
        asBool(data.multimodalInputsAccepted) ??
        asBool(data.multimodal_inputs_accepted) ??
        asBool(data.acceptsMultimodalInputs) ??
        multimodalInputsAccepted;
      scannerRunsBeforeModelIngest =
        asBool(data.scannerRunsBeforeModelIngest) ??
        asBool(data.scanner_runs_before_model_ingest) ??
        asBool(data.preIngestScannerConfigured) ??
        scannerRunsBeforeModelIngest;
      imageFileTypesInUseCoveredInLastReport =
        asBool(data.imageFileTypesInUseCoveredInLastReport) ??
        asBool(data.image_file_types_in_use_covered_in_last_report) ??
        asBool(data.typesInUseCovered) ??
        imageFileTypesInUseCoveredInLastReport;
      unscannedProductionMultimodalPaths =
        asNum(data.unscannedProductionMultimodalPaths) ??
        asNum(data.unscanned_production_multimodal_paths) ??
        asNum(data.unscannedProductionPaths) ??
        unscannedProductionMultimodalPaths;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    multimodalInputsAccepted,
    scannerRunsBeforeModelIngest,
    imageFileTypesInUseCoveredInLastReport,
    unscannedProductionMultimodalPaths,
    lastReportAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMultimodalInputScanReport(opts: {
  assessedAt: string;
  multimodal: { found: boolean; refs: string[] };
  scanner: { found: boolean; refs: string[] };
  preIngest: { found: boolean; refs: string[] };
  coverage: { found: boolean; refs: string[] };
  imported: MultimodalInputScanReport["importedResults"];
}): MultimodalInputScanReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.multimodal.found ||
    opts.scanner.found ||
    opts.preIngest.found ||
    opts.coverage.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No multimodal input-scan signals — SEC-R2 may be NOT_APPLICABLE if multimodal inputs are not accepted.",
    );
  }
  if (opts.multimodal.found) {
    notes.push(
      `Multimodal refs: ${opts.multimodal.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.scanner.found) {
    notes.push(`Scanner refs: ${opts.scanner.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.preIngest.found) {
    notes.push(`Pre-ingest refs: ${opts.preIngest.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (accepted=${opts.imported.multimodalInputsAccepted}, preIngest=${opts.imported.scannerRunsBeforeModelIngest}, typesCovered=${opts.imported.imageFileTypesInUseCoveredInLastReport}, unscanned=${opts.imported.unscannedProductionMultimodalPaths}, lastReportAge=${opts.imported.lastReportAgeDays})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Scanner signals alone are PARTIAL — import multimodalInputsAccepted + scannerRunsBeforeModelIngest=true + imageFileTypesInUseCoveredInLastReport=true + unscannedProductionMultimodalPaths=0 (measuredAt ≤90d) under imports/multimodal-input-scan/ to PASS. Set multimodalInputsAccepted=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const reportFresh =
    opts.imported.lastReportAgeDays === null ||
    opts.imported.lastReportAgeDays <= IMPORT_MAX_AGE_DAYS;
  const acceptedFalse = opts.imported.multimodalInputsAccepted === false;
  const scannerOk = opts.imported.scannerRunsBeforeModelIngest === true;
  const typesOk = opts.imported.imageFileTypesInUseCoveredInLastReport === true;
  const unscannedOk = opts.imported.unscannedProductionMultimodalPaths === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: MultimodalInputScanReport["summary"]["statusHint"];
  let secR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    opts.imported.multimodalInputsAccepted !== false &&
    (opts.imported.scannerRunsBeforeModelIngest === false ||
      opts.imported.imageFileTypesInUseCoveredInLastReport === false ||
      (opts.imported.unscannedProductionMultimodalPaths !== null &&
        opts.imported.unscannedProductionMultimodalPaths > 0) ||
      (opts.imported.lastReportAgeDays !== null &&
        opts.imported.lastReportAgeDays > IMPORT_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && acceptedFalse) {
    statusHint = "not_applicable";
    secR2Satisfied = null;
    notes.push(
      "Imported multimodalInputsAccepted=false — SEC-R2 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    secR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing pre-ingest scanner, uncovered types, unscanned paths >0, stale report, or attest older than 90 days — SEC-R2 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    opts.imported.multimodalInputsAccepted === true &&
    scannerOk &&
    typesOk &&
    unscannedOk &&
    reportFresh &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secR2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secR2Satisfied = false;
    if (opts.imported.found && opts.imported.multimodalInputsAccepted !== true) {
      notes.push(
        "Import must show multimodalInputsAccepted=true (or false for N/A).",
      );
    }
    if (opts.imported.found && !scannerOk) {
      notes.push("Import must show scannerRunsBeforeModelIngest=true.");
    }
    if (opts.imported.found && !typesOk) {
      notes.push(
        "Import must show imageFileTypesInUseCoveredInLastReport=true.",
      );
    }
    if (opts.imported.found && !unscannedOk) {
      notes.push(
        "Import must show unscannedProductionMultimodalPaths=0.",
      );
    }
    if (opts.imported.found && !reportFresh) {
      notes.push("Import lastReportAgeDays must be ≤90.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      multimodal: opts.multimodal,
      scanner: opts.scanner,
      preIngest: opts.preIngest,
      coverage: opts.coverage,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const multimodalInputScanCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const multimodalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MULTIMODAL_RE.test(path) || MULTIMODAL_RE.test(text),
      10,
    );
    const scannerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCANNER_RE.test(path) || SCANNER_RE.test(text),
      10,
    );
    const preIngestRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PRE_INGEST_RE.test(path) || PRE_INGEST_RE.test(text),
      10,
    );
    const coverageRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => COVERAGE_RE.test(path) || COVERAGE_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildMultimodalInputScanReport({
      assessedAt: ctx.assessedAt.toISOString(),
      multimodal: { found: multimodalRefs.length > 0, refs: multimodalRefs },
      scanner: { found: scannerRefs.length > 0, refs: scannerRefs },
      preIngest: { found: preIngestRefs.length > 0, refs: preIngestRefs },
      coverage: { found: coverageRefs.length > 0, refs: coverageRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "multimodal-input-scan-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/multimodal-input-scan-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "multimodal-input-scan",
          "sec-r2",
          DETECTOR_ID,
          ...(report.summary.secR2Satisfied ? ["sec-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.multimodal.refs,
        ...report.signals.scanner.refs,
        ...report.signals.preIngest.refs,
        ...report.signals.coverage.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["multimodal-input-scan-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-R2 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secR2Satisfied}; report=imports/${PLUGIN_ID}/multimodal-input-scan-report.json`,
      nodes,
    };
  },
};
