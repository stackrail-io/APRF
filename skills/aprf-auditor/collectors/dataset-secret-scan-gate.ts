/**
 * dataset-secret-scan-gate — SEC2-R3 / repo-dataset-secret-scan-gate.
 *
 * Discovers secret/PII scan gates before fine-tune/eval corpus publish.
 * Import coverage under imports/dataset-secret-scan-gate/ unlocks PASS
 * (measuredAt ≤90d). Dataset cards / code secret-scan alone ≠ PASS.
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
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "dataset-secret-scan-gate";
const RELATED = ["SEC2-R3"] as const;
const DETECTOR_ID = "repo-dataset-secret-scan-gate";
const IMPORT_MAX_AGE_DAYS = 90;

const CORPUS_PUBLISH_RE =
  /\b(fine[_-]?tun(e|ing)|eval[_-]?(corpus|dataset|set)|training[_-]?(corpus|dataset)|corpus[_-]?publish|publish[_-]?(corpus|dataset)|dataset[_-]?publish)\b/i;

const DATASET_SCAN_GATE_RE =
  /\b(dataset[_-]?(secret|pii|scan)|corpus[_-]?(secret|pii|scan)|secret[_-]?scan[_-]?(dataset|corpus)|pii[_-]?scan[_-]?(dataset|corpus)|scan[_-]?(before[_-]?)?(publish|fine[_-]?tune)|dataset[_-]?dlp)\b/i;

const BLOCKING_RE =
  /\b(block[_-]?(publish|promotion|release)|fail[_-]?(the[_-]?build|closed|on[_-]?critical)|critical[_-]?(finding|issue).{0,40}(block|fail)|cannot[_-]?publish|publish[_-]?blocked)\b/i;

const SCAN_REPORT_RE =
  /\b(scan[_-]?report|linked[_-]?scan|dataset[_-]?scan[_-]?result|corpus[_-]?scan[_-]?(report|result)|gitleaks[_-]?report|trufflehog[_-]?report)\b/i;

export interface DatasetSecretScanGateReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    corpusPublish: { found: boolean; refs: string[] };
    scanGate: { found: boolean; refs: string[] };
    blocking: { found: boolean; refs: string[] };
    scanReport: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    fineTuneOrEvalCorpusPublishPresent: boolean | null;
    datasetSecretPiiScanGateConfigured: boolean | null;
    publishBlockedWhenCriticalFindingsOpen: boolean | null;
    fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct:
      | number
      | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    scanGatePresent: boolean;
    sec2R3Satisfied: boolean | null;
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

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 12,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".toml",
      ".sh",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): DatasetSecretScanGateReport["importedResults"] {
  const sources: string[] = [];
  let fineTuneOrEvalCorpusPublishPresent: boolean | null = null;
  let datasetSecretPiiScanGateConfigured: boolean | null = null;
  let publishBlockedWhenCriticalFindingsOpen: boolean | null = null;
  let fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct:
    | number
    | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/dataset-secret-scan-gate-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      fineTuneOrEvalCorpusPublishPresent = mergeOrBool(
        fineTuneOrEvalCorpusPublishPresent,
        asBool(data.fineTuneOrEvalCorpusPublishPresent) ??
          asBool(data.fine_tune_or_eval_corpus_publish_present) ??
          asBool(data.corpusPublishPresent),
      );
      datasetSecretPiiScanGateConfigured = mergeAndBool(
        datasetSecretPiiScanGateConfigured,
        asBool(data.datasetSecretPiiScanGateConfigured) ??
          asBool(data.dataset_secret_pii_scan_gate_configured) ??
          asBool(data.scanGateConfigured),
      );
      publishBlockedWhenCriticalFindingsOpen = mergeAndBool(
        publishBlockedWhenCriticalFindingsOpen,
        asBool(data.publishBlockedWhenCriticalFindingsOpen) ??
          asBool(data.publish_blocked_when_critical_findings_open) ??
          asBool(data.blockingOnCritical),
      );
      fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct =
        mergeMinNum(
          fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct,
          asNum(
            data.fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct,
          ) ??
            asNum(
              data.fine_tune_or_eval_corpora_published_in_last_90_days_with_linked_scan_report_pct,
            ) ??
            asNum(data.linkedScanReportPct),
        );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    fineTuneOrEvalCorpusPublishPresent,
    datasetSecretPiiScanGateConfigured,
    publishBlockedWhenCriticalFindingsOpen,
    fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct,
    measuredAt,
    sources,
  };
}

export function buildDatasetSecretScanGateReport(opts: {
  assessedAt: string;
  corpusPublish: { found: boolean; refs: string[] };
  scanGate: { found: boolean; refs: string[] };
  blocking: { found: boolean; refs: string[] };
  scanReport: { found: boolean; refs: string[] };
  imported: DatasetSecretScanGateReport["importedResults"];
}): DatasetSecretScanGateReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.corpusPublish.found ||
    opts.scanGate.found ||
    opts.blocking.found ||
    opts.scanReport.found;
  // Corpus-publish / scan-gate prove the surface; generic blocking/CI report wording alone does not.
  const surfaceProvedForNaOverride =
    opts.corpusPublish.found || opts.scanGate.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No dataset-secret-scan-gate signals — SEC2-R3 remains not demonstrated until scan-gate + linked-report coverage or an explicit N/A attest (fineTuneOrEvalCorpusPublishPresent=false) is imported.",
    );
  }
  if (opts.corpusPublish.found) {
    notes.push(
      `Corpus-publish refs: ${opts.corpusPublish.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.scanGate.found) {
    notes.push(
      `Dataset scan-gate refs: ${opts.scanGate.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.blocking.found) {
    notes.push(
      `Blocking refs: ${opts.blocking.refs.slice(0, 3).join(", ")}; blocking wording alone ≠ PASS without import.`,
    );
  }
  if (opts.scanReport.found) {
    notes.push(
      `Scan-report refs: ${opts.scanReport.refs.slice(0, 3).join(", ")}; sample reports alone do not prove 100% coverage — import pct.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (publishPresent=${opts.imported.fineTuneOrEvalCorpusPublishPresent}, gate=${opts.imported.datasetSecretPiiScanGateConfigured}, blocked=${opts.imported.publishBlockedWhenCriticalFindingsOpen}, linkedPct=${opts.imported.fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import scan gate (or present via in-repo signals) plus publishBlockedWhenCriticalFindingsOpen=true + fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct=100 (measuredAt ≤90d) under imports/dataset-secret-scan-gate/ to PASS. Set fineTuneOrEvalCorpusPublishPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scanGatePresent =
    opts.scanGate.found ||
    opts.imported.datasetSecretPiiScanGateConfigured === true;
  const blockingOk =
    opts.imported.publishBlockedWhenCriticalFindingsOpen === true;
  const coverageOk =
    opts.imported
      .fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct ===
    100;

  let statusHint: DatasetSecretScanGateReport["summary"]["statusHint"];
  let sec2R3Satisfied: boolean | null = null;

  const naCandidate =
    opts.imported.found &&
    opts.imported.fineTuneOrEvalCorpusPublishPresent === false &&
    !surfaceProvedForNaOverride;
  const linkedPct =
    opts.imported
      .fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct;
  const contradictingFail = linkedPct !== null && linkedPct < 100;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    ((opts.imported.datasetSecretPiiScanGateConfigured === false &&
      !opts.scanGate.found) ||
      opts.imported.publishBlockedWhenCriticalFindingsOpen === false ||
      (linkedPct !== null && linkedPct < 100));

  const naOverrideNote =
    "Imported fineTuneOrEvalCorpusPublishPresent=false ignored — in-repo corpus-publish or scan-gate signals prove the surface exists.";

  if (explicitFail) {
    statusHint = "fail";
    sec2R3Satisfied = false;
    if (
      opts.imported.fineTuneOrEvalCorpusPublishPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(naOverrideNote);
    }
    notes.push(
      "Imported evidence shows missing scan gate, non-blocking publish, or incomplete linked-scan coverage — SEC2-R3 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.fineTuneOrEvalCorpusPublishPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2R3Satisfied = null;
    notes.push(
      "Imported fineTuneOrEvalCorpusPublishPresent=false — SEC2-R3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.fineTuneOrEvalCorpusPublishPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(naOverrideNote);
    if (
      scanGatePresent &&
      blockingOk &&
      coverageOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2R3Satisfied = true;
    } else {
      statusHint = "partial";
      sec2R3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2R3Satisfied = null;
  } else if (
    scanGatePresent &&
    blockingOk &&
    coverageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sec2R3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2R3Satisfied = false;
    if (opts.imported.found && !scanGatePresent) {
      notes.push(
        "PASS requires dataset secret/PII scan gate (in-repo or datasetSecretPiiScanGateConfigured=true).",
      );
    }
    if (opts.imported.found && !blockingOk) {
      notes.push(
        "Import must show publishBlockedWhenCriticalFindingsOpen=true.",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC2-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2R3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      corpusPublish: opts.corpusPublish,
      scanGate: opts.scanGate,
      blocking: opts.blocking,
      scanReport: opts.scanReport,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      scanGatePresent,
      sec2R3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const datasetSecretScanGateCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const corpusRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CORPUS_PUBLISH_RE.test(path) || CORPUS_PUBLISH_RE.test(text),
      10,
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        DATASET_SCAN_GATE_RE.test(path) || DATASET_SCAN_GATE_RE.test(text),
      10,
    );
    const blockRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BLOCKING_RE.test(path) || BLOCKING_RE.test(text),
      10,
    );
    const reportRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCAN_REPORT_RE.test(path) || SCAN_REPORT_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildDatasetSecretScanGateReport({
      assessedAt: ctx.assessedAt.toISOString(),
      corpusPublish: { found: corpusRefs.length > 0, refs: corpusRefs },
      scanGate: { found: gateRefs.length > 0, refs: gateRefs },
      blocking: { found: blockRefs.length > 0, refs: blockRefs },
      scanReport: { found: reportRefs.length > 0, refs: reportRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "dataset-secret-scan-gate-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/dataset-secret-scan-gate-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "dataset-secret-scan-gate",
          "sec2-r3",
          DETECTOR_ID,
          ...(report.summary.sec2R3Satisfied ? ["sec2-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-R3 status=${report.summary.statusHint} gate=${report.summary.scanGatePresent} satisfied=${report.summary.sec2R3Satisfied}; report=imports/${PLUGIN_ID}/dataset-secret-scan-gate-report.json`,
      nodes,
    };
  },
};
