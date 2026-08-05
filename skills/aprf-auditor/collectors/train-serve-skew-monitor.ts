/**
 * train-serve-skew-monitor — DG-R2 / repo-train-serve-skew detector executor.
 *
 * Discovers train/serve skew monitors for embeddings/features.
 * Import recent job (≤7d) + threshold + breach ticket/page under
 * imports/train-serve-skew-monitor/ to unlock PASS.
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
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "train-serve-skew-monitor";
const RELATED = ["DG-R2"] as const;
const DETECTOR_ID = "repo-train-serve-skew";
const SAMPLE_MAX_AGE_DAYS = 7;

const PIPELINE_PATH_RE =
  /(embed|feature|skew|train[\s_-]*serve|serving|vector|rag|ml[\s_-]*pipeline)/i;

const SKEW_RE =
  /\b(train[\s_-]*serve[\s_-]*skew|serving[\s_-]*skew|feature[\s_-]*skew|embedding[\s_-]*skew|distribution[\s_-]*drift|psi|kl[\s_-]*divergence|population[\s_-]*stability)\b/i;

const THRESHOLD_RE =
  /\b(skew[\s_-]*threshold|drift[\s_-]*threshold|psi[\s_-]*threshold|alert[\s_-]*threshold|breach[\s_-]*threshold)\b/i;

const BREACH_RE =
  /\b(ticket|pager|page|pagerduty|opsgenie|on[\s_-]*call|create[\s_-]*issue|incident)\b/i;

export interface TrainServeSkewMonitorReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    skewMonitor: { found: boolean; refs: string[] };
    threshold: { found: boolean; refs: string[] };
    breachRouting: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    pipelineCount: number | null;
    coversAllProductionPipelines: boolean | null;
    skewJobWithin7Days: boolean | null;
    thresholdDocumented: boolean | null;
    breachCreatesTicketOrPage: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    pipelineSignalsPresent: boolean;
    skewSignalsPresent: boolean;
    dgR2Satisfied: boolean | null;
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
      ".toml",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectPipelineSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PIPELINE_PATH_RE.test(path) ||
        SKEW_RE.test(text) ||
        /\b(embedding|feature[\s_-]*store|vector)\b/i.test(text),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): TrainServeSkewMonitorReport["importedResults"] {
  const sources: string[] = [];
  let pipelineCount: number | null = null;
  let coversAllProductionPipelines: boolean | null = null;
  let skewJobWithin7Days: boolean | null = null;
  let thresholdDocumented: boolean | null = null;
  let breachCreatesTicketOrPage: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/train-serve-skew-monitor-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      pipelineCount =
        asNum(data.pipelineCount) ??
        asNum(data.productionPipelineCount) ??
        pipelineCount;
      coversAllProductionPipelines =
        asBool(data.coversAllProductionPipelines) ??
        asBool(data.coversAllPipelines) ??
        coversAllProductionPipelines;
      skewJobWithin7Days =
        asBool(data.skewJobWithin7Days) ??
        asBool(data.jobRanWithin7Days) ??
        asBool(data.recentSkewJobOk) ??
        skewJobWithin7Days;
      thresholdDocumented =
        asBool(data.thresholdDocumented) ??
        asBool(data.hasThreshold) ??
        thresholdDocumented;
      breachCreatesTicketOrPage =
        asBool(data.breachCreatesTicketOrPage) ??
        asBool(data.breachPages) ??
        asBool(data.ticketOrPageOnBreach) ??
        breachCreatesTicketOrPage;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const pipelines = Array.isArray(data.pipelines)
        ? (data.pipelines as Array<Record<string, unknown>>)
        : [];
      if (pipelines.length > 0) {
        pipelineCount = pipelines.length;
        let recent = 0;
        let thresh = 0;
        let breach = 0;
        for (const p of pipelines) {
          if (p.skewJobWithin7Days === true || p.jobRanWithin7Days === true) {
            recent += 1;
          }
          if (
            p.thresholdDocumented === true ||
            p.hasThreshold === true ||
            p.threshold != null
          ) {
            thresh += 1;
          }
          if (
            p.breachCreatesTicketOrPage === true ||
            p.breachPages === true
          ) {
            breach += 1;
          }
        }
        skewJobWithin7Days = recent === pipelines.length;
        thresholdDocumented = thresh >= 1;
        breachCreatesTicketOrPage = breach === pipelines.length;
        if (coversAllProductionPipelines == null) {
          coversAllProductionPipelines = true;
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    pipelineCount,
    coversAllProductionPipelines,
    skewJobWithin7Days,
    thresholdDocumented,
    breachCreatesTicketOrPage,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildTrainServeSkewMonitorReport(opts: {
  assessedAt: string;
  signals: TrainServeSkewMonitorReport["signals"];
  pipelineSignals: boolean;
  imported: TrainServeSkewMonitorReport["importedResults"];
}): TrainServeSkewMonitorReport {
  const notes: string[] = [];
  const skewSignalsPresent =
    opts.signals.skewMonitor.found || opts.signals.threshold.found;

  if (!opts.pipelineSignals && !skewSignalsPresent && !opts.imported.found) {
    notes.push(
      "No embedding/feature skew signals — DG-R2 may be NOT_APPLICABLE if there is no production embedding/feature pipeline.",
    );
  }
  if (opts.signals.skewMonitor.found) {
    notes.push(
      `Skew-monitor refs: ${opts.signals.skewMonitor.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.threshold.found) {
    notes.push(
      `Threshold refs: ${opts.signals.threshold.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.breachRouting.found) {
    notes.push(
      `Breach-routing refs: ${opts.signals.breachRouting.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (pipelines=${opts.imported.pipelineCount}, coversAll=${opts.imported.coversAllProductionPipelines}, job7d=${opts.imported.skewJobWithin7Days}, threshold=${opts.imported.thresholdDocumented}, breachRoute=${opts.imported.breachCreatesTicketOrPage}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (skewSignalsPresent) {
    notes.push(
      "Skew config alone is PARTIAL — import coversAllProductionPipelines + skewJobWithin7Days + threshold + breach ticket/page ≤7d under imports/train-serve-skew-monitor/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= SAMPLE_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    SAMPLE_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.coversAllProductionPipelines === true &&
    opts.imported.skewJobWithin7Days === true &&
    opts.imported.thresholdDocumented === true &&
    opts.imported.breachCreatesTicketOrPage === true &&
    ageOk &&
    importFresh;

  let statusHint: TrainServeSkewMonitorReport["summary"]["statusHint"];
  let dgR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllProductionPipelines === false ||
      opts.imported.skewJobWithin7Days === false ||
      opts.imported.thresholdDocumented === false ||
      opts.imported.breachCreatesTicketOrPage === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > SAMPLE_MAX_AGE_DAYS));

  if (
    !opts.pipelineSignals &&
    !opts.signals.skewMonitor.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgR2Satisfied = false;
    notes.push(
      "Imported results show missing coverage, stale/missing skew job, no threshold, no breach routing, or evidence older than 7 days — DG-R2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgR2Satisfied = true;
    if ((opts.imported.pipelineCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllProductionPipelines with zero pipelines — confirm no production embedding/feature surface.",
      );
    }
  } else if (
    opts.signals.skewMonitor.found ||
    opts.signals.threshold.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgR2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllProductionPipelines !== true) {
        notes.push("Import must show coversAllProductionPipelines=true.");
      }
      if (opts.imported.skewJobWithin7Days !== true) {
        notes.push("Import must show skewJobWithin7Days=true.");
      }
      if (opts.imported.thresholdDocumented !== true) {
        notes.push("Import must show thresholdDocumented=true.");
      }
      if (opts.imported.breachCreatesTicketOrPage !== true) {
        notes.push("Import must show breachCreatesTicketOrPage=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤7 days) — required to unlock DG-R2 PASS.",
        );
      }
    }
  } else if (opts.pipelineSignals) {
    statusHint = "not_demonstrated";
    dgR2Satisfied = null;
    notes.push(
      "Embedding/feature signals present but no train/serve skew monitor found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      pipelineSignalsPresent: opts.pipelineSignals,
      skewSignalsPresent,
      dgR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const trainServeSkewMonitorCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const pipelineSignals = detectPipelineSignals(ctx.targetPath, maxFiles);

    const inSkewContext = (path: string, text: string) =>
      PIPELINE_PATH_RE.test(path) ||
      SKEW_RE.test(path) ||
      SKEW_RE.test(text) ||
      PIPELINE_PATH_RE.test(text);

    const skewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SKEW_RE.test(path) || SKEW_RE.test(text)) &&
        inSkewContext(path, text),
    );
    const thresholdRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (THRESHOLD_RE.test(path) || THRESHOLD_RE.test(text)) &&
        inSkewContext(path, text),
      12,
    );
    const breachRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (BREACH_RE.test(path) || BREACH_RE.test(text)) &&
        inSkewContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildTrainServeSkewMonitorReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        skewMonitor: { found: skewRefs.length > 0, refs: skewRefs },
        threshold: {
          found: thresholdRefs.length > 0,
          refs: thresholdRefs,
        },
        breachRouting: { found: breachRefs.length > 0, refs: breachRefs },
      },
      pipelineSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "train-serve-skew-monitor-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/train-serve-skew-monitor-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "train-serve-skew-monitor",
          "dg-r2",
          DETECTOR_ID,
          ...(report.summary.skewSignalsPresent ? ["skew-monitor-signals"] : []),
          ...(report.summary.dgR2Satisfied ? ["dg-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...skewRefs.slice(0, 2),
        ...thresholdRefs.slice(0, 2),
        ...breachRefs.slice(0, 2),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["train-serve-skew-monitor-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-R2 status=${report.summary.statusHint} skew=${report.summary.skewSignalsPresent} satisfied=${report.summary.dgR2Satisfied}; report=imports/${PLUGIN_ID}/train-serve-skew-monitor-report.json`,
      nodes,
    };
  },
};
