/**
 * ai-ops-metrics — PERF-M2 / repo-ai-ops-metrics.
 *
 * Discovers latency + error + AI quality/task-success metrics for ops.
 * Import latencyMetricsCollected + errorRateMetricsCollected +
 * aiQualityOrTaskSuccessMetricCollected + metricsAvailableForOperationalMonitoring
 * under imports/ai-ops-metrics/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-ops-metrics";
const RELATED = ["PERF-M2"] as const;
const DETECTOR_ID = "repo-ai-ops-metrics";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const LATENCY_RE =
  /\b(latency[\s_-]*(metric|histogram|p95|p99)|request[\s_-]*duration|ttft|time[\s_-]*to[\s_-]*first[\s_-]*token|gen[\s_-]*ai\.client\.operation\.duration)\b/i;

const ERROR_RE =
  /\b(error[\s_-]*rate|error[\s_-]*metric|failed[\s_-]*request|http[\s_-]*5xx|llm[\s_-]*error|model[\s_-]*error)\b/i;

const QUALITY_RE =
  /\b(task[\s_-]*success|quality[\s_-]*metric|eval[\s_-]*score|refusal[\s_-]*rate|thumbs[\s_-]*(up|down)|user[\s_-]*satisfaction|ai[\s_-]*quality)\b/i;

const METRICS_EXPORT_RE =
  /\b(prometheus|otel[\s_-]*metric|metrics[\s_-]*exporter|cloudwatch[\s_-]*metric|datadog[\s_-]*metric|statsd)\b/i;

export interface AiOpsMetricsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    latency: { found: boolean; refs: string[] };
    errorRate: { found: boolean; refs: string[] };
    quality: { found: boolean; refs: string[] };
    exporter: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    latencyMetricsCollected: boolean | null;
    errorRateMetricsCollected: boolean | null;
    aiQualityOrTaskSuccessMetricCollected: boolean | null;
    metricsAvailableForOperationalMonitoring: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    metricsSignalsPresent: boolean;
    perfM2Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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
): AiOpsMetricsReport["importedResults"] {
  const sources: string[] = [];
  let latencyMetricsCollected: boolean | null = null;
  let errorRateMetricsCollected: boolean | null = null;
  let aiQualityOrTaskSuccessMetricCollected: boolean | null = null;
  let metricsAvailableForOperationalMonitoring: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-ops-metrics-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      latencyMetricsCollected =
        asBool(data.latencyMetricsCollected) ??
        asBool(data.latency_metrics_collected) ??
        latencyMetricsCollected;
      errorRateMetricsCollected =
        asBool(data.errorRateMetricsCollected) ??
        asBool(data.error_rate_metrics_collected) ??
        errorRateMetricsCollected;
      aiQualityOrTaskSuccessMetricCollected =
        asBool(data.aiQualityOrTaskSuccessMetricCollected) ??
        asBool(data.ai_quality_or_task_success_metric_collected) ??
        asBool(data.qualityMetricCollected) ??
        aiQualityOrTaskSuccessMetricCollected;
      metricsAvailableForOperationalMonitoring =
        asBool(data.metricsAvailableForOperationalMonitoring) ??
        asBool(data.metrics_available_for_operational_monitoring) ??
        asBool(data.metricsAvailable) ??
        metricsAvailableForOperationalMonitoring;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    latencyMetricsCollected,
    errorRateMetricsCollected,
    aiQualityOrTaskSuccessMetricCollected,
    metricsAvailableForOperationalMonitoring,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiOpsMetricsReport(opts: {
  assessedAt: string;
  latency: { found: boolean; refs: string[] };
  errorRate: { found: boolean; refs: string[] };
  quality: { found: boolean; refs: string[] };
  exporter: { found: boolean; refs: string[] };
  imported: AiOpsMetricsReport["importedResults"];
}): AiOpsMetricsReport {
  const notes: string[] = [];
  const metricsSignalsPresent =
    opts.latency.found ||
    opts.errorRate.found ||
    opts.quality.found ||
    opts.exporter.found;

  if (!metricsSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI ops-metrics signals — PERF-M2 may be NOT_APPLICABLE if no production AI services are in scope.",
    );
  }
  if (opts.latency.found) {
    notes.push(`Latency refs: ${opts.latency.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (latency=${opts.imported.latencyMetricsCollected}, error=${opts.imported.errorRateMetricsCollected}, quality=${opts.imported.aiQualityOrTaskSuccessMetricCollected}, available=${opts.imported.metricsAvailableForOperationalMonitoring})`,
    );
  } else if (metricsSignalsPresent) {
    notes.push(
      "Metric signals alone are PARTIAL — import latencyMetricsCollected=true + errorRateMetricsCollected=true + aiQualityOrTaskSuccessMetricCollected=true + metricsAvailableForOperationalMonitoring=true (measuredAt ≤90d) under imports/ai-ops-metrics/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const latencyOk = opts.imported.latencyMetricsCollected === true;
  const errorOk = opts.imported.errorRateMetricsCollected === true;
  const qualityOk = opts.imported.aiQualityOrTaskSuccessMetricCollected === true;
  const availableOk =
    opts.imported.metricsAvailableForOperationalMonitoring === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiOpsMetricsReport["summary"]["statusHint"];
  let perfM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.latencyMetricsCollected === false ||
      opts.imported.errorRateMetricsCollected === false ||
      opts.imported.aiQualityOrTaskSuccessMetricCollected === false ||
      opts.imported.metricsAvailableForOperationalMonitoring === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!metricsSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing latency/error/quality metrics, metrics not available for ops monitoring, or evidence older than 90 days — PERF-M2 fail.",
    );
  } else if (
    (metricsSignalsPresent || opts.imported.found) &&
    latencyOk &&
    errorOk &&
    qualityOk &&
    availableOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfM2Satisfied = true;
  } else if (metricsSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfM2Satisfied = false;
    if (opts.imported.found && !latencyOk) {
      notes.push("Import must show latencyMetricsCollected=true.");
    }
    if (opts.imported.found && !errorOk) {
      notes.push("Import must show errorRateMetricsCollected=true.");
    }
    if (opts.imported.found && !qualityOk) {
      notes.push("Import must show aiQualityOrTaskSuccessMetricCollected=true.");
    }
    if (opts.imported.found && !availableOk) {
      notes.push(
        "Import must show metricsAvailableForOperationalMonitoring=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      latency: opts.latency,
      errorRate: opts.errorRate,
      quality: opts.quality,
      exporter: opts.exporter,
    },
    importedResults: opts.imported,
    summary: {
      metricsSignalsPresent,
      perfM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiOpsMetricsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const latency = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => LATENCY_RE.test(path) || LATENCY_RE.test(text),
      10,
    );
    const errorRate = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ERROR_RE.test(path) || ERROR_RE.test(text),
      8,
    );
    const quality = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => QUALITY_RE.test(path) || QUALITY_RE.test(text),
      8,
    );
    const exporter = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        METRICS_EXPORT_RE.test(path) || METRICS_EXPORT_RE.test(text),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiOpsMetricsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      latency: { found: latency.length > 0, refs: latency },
      errorRate: { found: errorRate.length > 0, refs: errorRate },
      quality: { found: quality.length > 0, refs: quality },
      exporter: { found: exporter.length > 0, refs: exporter },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-ops-metrics-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-ops-metrics-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-ops-metrics",
          "perf-m2",
          DETECTOR_ID,
          ...(report.summary.perfM2Satisfied ? ["perf-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.latency.refs,
        ...report.signals.errorRate.refs,
        ...report.signals.quality.refs,
        ...report.signals.exporter.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-ops-metrics-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-M2 status=${report.summary.statusHint} signals=${report.summary.metricsSignalsPresent} satisfied=${report.summary.perfM2Satisfied}; report=imports/${PLUGIN_ID}/ai-ops-metrics-report.json`,
      nodes,
    };
  },
};
