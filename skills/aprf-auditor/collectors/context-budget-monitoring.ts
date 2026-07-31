/**
 * context-budget-monitoring — CTX-R1 / repo-context-budget-monitoring.
 *
 * Discovers per-request context-budget metrics + saturation/truncate alerts.
 * Import emitCoveragePct≥99 + saturationAlertConfigured + alertNotifyProven
 * under imports/context-budget-monitoring/ to unlock PASS.
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

const PLUGIN_ID = "context-budget-monitoring";
const RELATED = ["CTX-R1"] as const;
const DETECTOR_ID = "repo-context-budget-monitoring";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_EMIT_COVERAGE_PCT = 99;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CTX_PATH_RE =
  /(context|prompt|rag|otel|metric|grafana|prometheus|datadog|helicone|langsmith)/i;

const METRIC_RE =
  /\b(context[\s_-]*(budget|token|usage|size)|prompt[\s_-]*tokens?[\s_-]*(used|in)|gen_ai\.|token[\s_-]*usage|context[\s_-]*window[\s_-]*used)/i;

const ALERT_RE =
  /\b([\w-]*(alert|alarm)|pager|pagerduty|opsgenie|notification|on[\s_-]*call|saturat|truncat[\s_-]*rate|budget[\s_-]*(saturat|threshold))/i;

const SATURATION_RE =
  /\b(saturat|near[\s_-]*limit|%[\s_-]*of[\s_-]*(max|budget|context)|hard[\s_-]*truncat|truncat[\s_-]*rate|context[\s_-]*budget[\s_-]*(alert|alarm|threshold))/i;

export interface ContextBudgetMonitoringReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    metrics: { found: boolean; refs: string[] };
    alerts: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    emitCoveragePct: number | null;
    saturationAlertConfigured: boolean | null;
    alertNotifyProven: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    contextSignalsPresent: boolean;
    metricOrAlertSignalsPresent: boolean;
    ctxR1Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
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

function detectContextSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CTX_PATH_RE.test(path) ||
        /\b(context[_-]?assembl|rag|retriev|prompt|llm)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextBudgetMonitoringReport["importedResults"] {
  const sources: string[] = [];
  let emitCoveragePct: number | null = null;
  let saturationAlertConfigured: boolean | null = null;
  let alertNotifyProven: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-budget-monitoring-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      emitCoveragePct =
        asNum(data.emitCoveragePct) ??
        asNum(data.emit_coverage_pct) ??
        asNum(data.requestEmitCoveragePct) ??
        emitCoveragePct;
      saturationAlertConfigured =
        asBool(data.saturationAlertConfigured) ??
        asBool(data.saturation_alert_configured) ??
        asBool(data.truncateRateAlertConfigured) ??
        saturationAlertConfigured;
      alertNotifyProven =
        asBool(data.alertNotifyProven) ??
        asBool(data.notifyProven) ??
        asBool(data.alert_notify_proven) ??
        alertNotifyProven;

      if (asBool(data.meetsEmitCoverage) === true && emitCoveragePct === null) {
        emitCoveragePct = MIN_EMIT_COVERAGE_PCT;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    emitCoveragePct,
    saturationAlertConfigured,
    alertNotifyProven,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextBudgetMonitoringReport(opts: {
  assessedAt: string;
  metrics: { found: boolean; refs: string[] };
  alerts: { found: boolean; refs: string[] };
  contextSignals: boolean;
  imported: ContextBudgetMonitoringReport["importedResults"];
}): ContextBudgetMonitoringReport {
  const notes: string[] = [];
  const metricOrAlertSignalsPresent = opts.metrics.found || opts.alerts.found;

  if (
    !opts.contextSignals &&
    !metricOrAlertSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No context-budget monitoring signals — CTX-R1 may be NOT_APPLICABLE if there are no production context builders.",
    );
  }
  if (opts.metrics.found) {
    notes.push(`Metric refs: ${opts.metrics.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No per-request context-budget metric signals found.");
  }
  if (opts.alerts.found) {
    notes.push(`Alert refs: ${opts.alerts.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No context saturation / truncate-rate alert signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (emit=${opts.imported.emitCoveragePct}, alert=${opts.imported.saturationAlertConfigured}, notify=${opts.imported.alertNotifyProven})`,
    );
  } else if (metricOrAlertSignalsPresent) {
    notes.push(
      "Metric/alert signals alone are PARTIAL — import emitCoveragePct≥99 + saturationAlertConfigured + alertNotifyProven (measuredAt ≤90d) under imports/context-budget-monitoring/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.emitCoveragePct !== null &&
    opts.imported.emitCoveragePct >= MIN_EMIT_COVERAGE_PCT;
  const alertOk = opts.imported.saturationAlertConfigured === true;
  const notifyOk = opts.imported.alertNotifyProven === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextBudgetMonitoringReport["summary"]["statusHint"] =
    "not_demonstrated";
  let ctxR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.emitCoveragePct !== null &&
      opts.imported.emitCoveragePct < MIN_EMIT_COVERAGE_PCT) ||
      opts.imported.saturationAlertConfigured === false ||
      opts.imported.alertNotifyProven === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.contextSignals &&
    !metricOrAlertSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    ctxR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxR1Satisfied = false;
    notes.push(
      "Imported evidence shows emit coverage <99%, missing saturation alert/notify, or evidence older than 90 days — CTX-R1 fail.",
    );
  } else if (
    (metricOrAlertSignalsPresent || opts.imported.found) &&
    coverageOk &&
    alertOk &&
    notifyOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxR1Satisfied = true;
  } else if (metricOrAlertSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    ctxR1Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show emitCoveragePct≥99.");
    }
    if (opts.imported.found && !alertOk) {
      notes.push("Import must show saturationAlertConfigured=true.");
    }
    if (opts.imported.found && !notifyOk) {
      notes.push("Import must show alertNotifyProven=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-R1 PASS.",
      );
    }
  } else if (opts.contextSignals) {
    statusHint = "not_demonstrated";
    ctxR1Satisfied = null;
    notes.push(
      "Context signals present but no budget metrics or saturation alert evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      metrics: opts.metrics,
      alerts: opts.alerts,
    },
    importedResults: opts.imported,
    summary: {
      contextSignalsPresent: opts.contextSignals,
      metricOrAlertSignalsPresent,
      ctxR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextBudgetMonitoringCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const contextSignals = detectContextSignals(ctx.targetPath, maxFiles);

    const metricRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!METRIC_RE.test(path) && !METRIC_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          METRIC_RE.test(path)
        );
      },
    );
    const alertRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        const hasAlert = ALERT_RE.test(path) || ALERT_RE.test(text);
        const hasSat = SATURATION_RE.test(path) || SATURATION_RE.test(text);
        if (!(hasAlert && hasSat) && !(METRIC_RE.test(text) && hasAlert)) {
          return false;
        }
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          METRIC_RE.test(text) ||
          SATURATION_RE.test(path)
        );
      },
    );

    const imported = loadImported(ctx);
    const report = buildContextBudgetMonitoringReport({
      assessedAt: ctx.assessedAt.toISOString(),
      metrics: { found: metricRefs.length > 0, refs: metricRefs },
      alerts: { found: alertRefs.length > 0, refs: alertRefs },
      contextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-budget-monitoring-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/context-budget-monitoring-report.json`,
        signals: [
          "context-budget-monitoring",
          "ctx-r1",
          DETECTOR_ID,
          ...(report.summary.ctxR1Satisfied ? ["ctx-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.metrics.refs,
        ...report.signals.alerts.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "runtime-config",
        ref: r,
        signals: ["context-budget-monitoring-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-R1 status=${report.summary.statusHint} signals=${report.summary.metricOrAlertSignalsPresent} satisfied=${report.summary.ctxR1Satisfied}; report=imports/${PLUGIN_ID}/context-budget-monitoring-report.json`,
      nodes,
    };
  },
};
