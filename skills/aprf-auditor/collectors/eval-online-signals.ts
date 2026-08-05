/**
 * eval-online-signals — EVL-M3 / repo-eval-online-signals.
 *
 * Discovers live task-success/failure + safety-refusal metrics.
 * Import both metric classes + cadence + dashboardFreshnessHours≤24 under
 * imports/eval-online-signals/ to unlock PASS.
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

const PLUGIN_ID = "eval-online-signals";
const RELATED = ["EVL-M3"] as const;
const DETECTOR_ID = "repo-eval-online-signals";
const IMPORT_MAX_AGE_DAYS = 90;
const MAX_DASHBOARD_FRESHNESS_HOURS = 24;

const METRIC_PATH_RE =
  /(metric|grafana|prometheus|datadog|otel|dashboard|monitor|langsmith|helicone|phoenix)/i;

const TASK_SUCCESS_RE =
  /\b(task[\s_-]*(success|failure|fail|complete|outcome)|success[\s_-]*rate|failure[\s_-]*rate|completion[\s_-]*rate)\b/i;

const REFUSAL_RE =
  /\b(safety[\s_-]*refusal|refusal[\s_-]*rate|policy[\s_-]*(block|refus)|blocked[\s_-]*(prompt|request)|unsafe[\s_-]*block)\b/i;

const CADENCE_RE =
  /\b(alert|alarm|pager|on[\s_-]*call|review[\s_-]*cadence|daily[\s_-]*review|weekly[\s_-]*review|slo)\b/i;

export interface EvalOnlineSignalsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    taskSuccessFailure: { found: boolean; refs: string[] };
    safetyRefusals: { found: boolean; refs: string[] };
    cadence: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    taskSuccessFailureMetricPresent: boolean | null;
    safetyRefusalMetricPresent: boolean | null;
    alertOrReviewCadenceDefined: boolean | null;
    dashboardFreshnessHours: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    onlineSignalsPresent: boolean;
    evlM3Satisfied: boolean | null;
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
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        /\b(openai|anthropic|llm|agent|rag|ChatCompletion|prompt)\b/i.test(
          path + " " + text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalOnlineSignalsReport["importedResults"] {
  const sources: string[] = [];
  let taskSuccessFailureMetricPresent: boolean | null = null;
  let safetyRefusalMetricPresent: boolean | null = null;
  let alertOrReviewCadenceDefined: boolean | null = null;
  let dashboardFreshnessHours: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-online-signals-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      taskSuccessFailureMetricPresent =
        asBool(data.taskSuccessFailureMetricPresent) ??
        asBool(data.task_success_failure_metric_present) ??
        taskSuccessFailureMetricPresent;
      safetyRefusalMetricPresent =
        asBool(data.safetyRefusalMetricPresent) ??
        asBool(data.safety_refusal_metric_present) ??
        safetyRefusalMetricPresent;
      alertOrReviewCadenceDefined =
        asBool(data.alertOrReviewCadenceDefined) ??
        asBool(data.alert_or_review_cadence_defined) ??
        asBool(data.cadenceDefined) ??
        alertOrReviewCadenceDefined;
      dashboardFreshnessHours =
        asNum(data.dashboardFreshnessHours) ??
        asNum(data.dashboard_freshness_hours) ??
        dashboardFreshnessHours;

      if (asBool(data.bothMetricClassesPresent) === true) {
        taskSuccessFailureMetricPresent = true;
        safetyRefusalMetricPresent = true;
      }
      if (asBool(data.dashboardFresh) === true && dashboardFreshnessHours === null) {
        dashboardFreshnessHours = MAX_DASHBOARD_FRESHNESS_HOURS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    taskSuccessFailureMetricPresent,
    safetyRefusalMetricPresent,
    alertOrReviewCadenceDefined,
    dashboardFreshnessHours,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalOnlineSignalsReport(opts: {
  assessedAt: string;
  taskSuccessFailure: { found: boolean; refs: string[] };
  safetyRefusals: { found: boolean; refs: string[] };
  cadence: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: EvalOnlineSignalsReport["importedResults"];
}): EvalOnlineSignalsReport {
  const notes: string[] = [];
  const onlineSignalsPresent =
    opts.taskSuccessFailure.found ||
    opts.safetyRefusals.found ||
    opts.cadence.found;

  if (!opts.aiSignals && !onlineSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI/online-signal evidence — EVL-M3 may be NOT_APPLICABLE if there are no production AI workloads.",
    );
  }
  if (opts.taskSuccessFailure.found) {
    notes.push(
      `Task success/failure refs: ${opts.taskSuccessFailure.refs.slice(0, 4).join(", ")}`,
    );
  } else {
    notes.push("No task success/failure metric signals found.");
  }
  if (opts.safetyRefusals.found) {
    notes.push(
      `Safety-refusal refs: ${opts.safetyRefusals.refs.slice(0, 4).join(", ")}`,
    );
  } else {
    notes.push("No safety-refusal metric signals found.");
  }
  if (opts.cadence.found) {
    notes.push(`Cadence/alert refs: ${opts.cadence.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (task=${opts.imported.taskSuccessFailureMetricPresent}, refusal=${opts.imported.safetyRefusalMetricPresent}, cadence=${opts.imported.alertOrReviewCadenceDefined}, freshnessH=${opts.imported.dashboardFreshnessHours})`,
    );
  } else if (onlineSignalsPresent) {
    notes.push(
      "Metric/cadence signals alone are PARTIAL — import both metric classes + alertOrReviewCadenceDefined + dashboardFreshnessHours≤24 (measuredAt ≤90d) under imports/eval-online-signals/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const taskOk = opts.imported.taskSuccessFailureMetricPresent === true;
  const refusalOk = opts.imported.safetyRefusalMetricPresent === true;
  const cadenceOk = opts.imported.alertOrReviewCadenceDefined === true;
  const freshnessOk =
    opts.imported.dashboardFreshnessHours !== null &&
    opts.imported.dashboardFreshnessHours <= MAX_DASHBOARD_FRESHNESS_HOURS;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalOnlineSignalsReport["summary"]["statusHint"];
  let evlM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.taskSuccessFailureMetricPresent === false ||
      opts.imported.safetyRefusalMetricPresent === false ||
      opts.imported.alertOrReviewCadenceDefined === false ||
      (opts.imported.dashboardFreshnessHours !== null &&
        opts.imported.dashboardFreshnessHours > MAX_DASHBOARD_FRESHNESS_HOURS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !onlineSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    evlM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    evlM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing metrics/cadence, stale dashboard (>24h), or attestation older than 90 days — EVL-M3 fail.",
    );
  } else if (
    (onlineSignalsPresent || opts.imported.found) &&
    taskOk &&
    refusalOk &&
    cadenceOk &&
    freshnessOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlM3Satisfied = true;
  } else if (onlineSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    evlM3Satisfied = false;
    if (opts.imported.found && !taskOk) {
      notes.push("Import must show taskSuccessFailureMetricPresent=true.");
    }
    if (opts.imported.found && !refusalOk) {
      notes.push("Import must show safetyRefusalMetricPresent=true.");
    }
    if (opts.imported.found && !cadenceOk) {
      notes.push("Import must show alertOrReviewCadenceDefined=true.");
    }
    if (opts.imported.found && !freshnessOk) {
      notes.push("Import must show dashboardFreshnessHours≤24.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-M3 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    evlM3Satisfied = null;
    notes.push(
      "AI signals present but no online task-success or safety-refusal metric evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      taskSuccessFailure: opts.taskSuccessFailure,
      safetyRefusals: opts.safetyRefusals,
      cadence: opts.cadence,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      onlineSignalsPresent,
      evlM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalOnlineSignalsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const taskRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!TASK_SUCCESS_RE.test(path) && !TASK_SUCCESS_RE.test(text)) {
          return false;
        }
        return (
          METRIC_PATH_RE.test(path) ||
          METRIC_PATH_RE.test(text) ||
          TASK_SUCCESS_RE.test(path)
        );
      },
    );
    const refusalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!REFUSAL_RE.test(path) && !REFUSAL_RE.test(text)) return false;
        return (
          METRIC_PATH_RE.test(path) ||
          METRIC_PATH_RE.test(text) ||
          REFUSAL_RE.test(path)
        );
      },
    );
    const cadenceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TASK_SUCCESS_RE.test(text) ||
          REFUSAL_RE.test(text) ||
          METRIC_PATH_RE.test(path) ||
          METRIC_PATH_RE.test(text)) &&
        CADENCE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEvalOnlineSignalsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      taskSuccessFailure: { found: taskRefs.length > 0, refs: taskRefs },
      safetyRefusals: { found: refusalRefs.length > 0, refs: refusalRefs },
      cadence: { found: cadenceRefs.length > 0, refs: cadenceRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-online-signals-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/eval-online-signals-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-online-signals",
          "evl-m3",
          DETECTOR_ID,
          ...(report.summary.evlM3Satisfied ? ["evl-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.taskSuccessFailure.refs,
        ...report.signals.safetyRefusals.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "runtime-config",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-online-signals-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-M3 status=${report.summary.statusHint} online=${report.summary.onlineSignalsPresent} satisfied=${report.summary.evlM3Satisfied}; report=imports/${PLUGIN_ID}/eval-online-signals-report.json`,
      nodes,
    };
  },
};
