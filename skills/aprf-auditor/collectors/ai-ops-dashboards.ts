/**
 * ai-ops-dashboards — PERF-R4 / repo-ai-ops-dashboards.
 *
 * Discovers near-real-time ops dashboards for AI latency/error/throughput/etc.
 * Import dashboardCoversLatencyErrorThroughput + dashboardCoversResourceUtilization
 * + dashboardCoversAiQuality + nearRealtimeRefreshConfigured under
 * imports/ai-ops-dashboards/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-ops-dashboards";
const RELATED = ["PERF-R4"] as const;
const DETECTOR_ID = "repo-ai-ops-dashboards";
const IMPORT_MAX_AGE_DAYS = 90;
const FRESHNESS_MAX_MINUTES = 15;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DASHBOARD_RE =
  /\b(grafana|datadog[\s_-]*dashboard|ops[\s_-]*dashboard|slo[\s_-]*dashboard|ai[\s_-]*dashboard|llm[\s_-]*dashboard)\b/i;

const LATENCY_ERROR_THROUGHPUT_RE =
  /\b((latency|error[\s_-]*rate|throughput|qps|rps).{0,40}(latency|error|throughput|qps|rps)|panel.{0,20}(latency|error|throughput))\b/i;

const RESOURCE_RE =
  /\b(resource[\s_-]*util|cpu[\s_-]*util|gpu[\s_-]*util|memory[\s_-]*util|token[\s_-]*throughput|concurrency)\b/i;

const QUALITY_PANEL_RE =
  /\b(quality[\s_-]*(panel|metric|dashboard)|task[\s_-]*success[\s_-]*panel|refusal[\s_-]*rate[\s_-]*panel|ai[\s_-]*quality)\b/i;

const NEAR_REALTIME_RE =
  /\b(near[\s_-]*real[\s_-]*time|realtime|refresh[\s_-]*(interval|rate)|freshness|scrape[\s_-]*interval|15[\s_-]*min|auto[\s_-]*refresh)\b/i;

export interface AiOpsDashboardsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    dashboard: { found: boolean; refs: string[] };
    latencyErrorThroughput: { found: boolean; refs: string[] };
    resource: { found: boolean; refs: string[] };
    quality: { found: boolean; refs: string[] };
    nearRealtime: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    dashboardCoversLatencyErrorThroughput: boolean | null;
    dashboardCoversResourceUtilization: boolean | null;
    dashboardCoversAiQuality: boolean | null;
    nearRealtimeRefreshConfigured: boolean | null;
    panelFreshnessMinutes: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    dashboardSignalsPresent: boolean;
    perfR4Satisfied: boolean | null;
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
): AiOpsDashboardsReport["importedResults"] {
  const sources: string[] = [];
  let dashboardCoversLatencyErrorThroughput: boolean | null = null;
  let dashboardCoversResourceUtilization: boolean | null = null;
  let dashboardCoversAiQuality: boolean | null = null;
  let nearRealtimeRefreshConfigured: boolean | null = null;
  let panelFreshnessMinutes: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-ops-dashboards-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      panelFreshnessMinutes =
        asNum(data.panelFreshnessMinutes) ??
        asNum(data.panel_freshness_minutes) ??
        panelFreshnessMinutes;
      dashboardCoversLatencyErrorThroughput =
        asBool(data.dashboardCoversLatencyErrorThroughput) ??
        asBool(data.dashboard_covers_latency_error_throughput) ??
        dashboardCoversLatencyErrorThroughput;
      dashboardCoversResourceUtilization =
        asBool(data.dashboardCoversResourceUtilization) ??
        asBool(data.dashboard_covers_resource_utilization) ??
        dashboardCoversResourceUtilization;
      dashboardCoversAiQuality =
        asBool(data.dashboardCoversAiQuality) ??
        asBool(data.dashboard_covers_ai_quality) ??
        dashboardCoversAiQuality;
      nearRealtimeRefreshConfigured =
        asBool(data.nearRealtimeRefreshConfigured) ??
        asBool(data.near_realtime_refresh_configured) ??
        nearRealtimeRefreshConfigured;

      if (panelFreshnessMinutes !== null) {
        nearRealtimeRefreshConfigured =
          nearRealtimeRefreshConfigured ??
          panelFreshnessMinutes <= FRESHNESS_MAX_MINUTES;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    dashboardCoversLatencyErrorThroughput,
    dashboardCoversResourceUtilization,
    dashboardCoversAiQuality,
    nearRealtimeRefreshConfigured,
    panelFreshnessMinutes,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiOpsDashboardsReport(opts: {
  assessedAt: string;
  dashboard: { found: boolean; refs: string[] };
  latencyErrorThroughput: { found: boolean; refs: string[] };
  resource: { found: boolean; refs: string[] };
  quality: { found: boolean; refs: string[] };
  nearRealtime: { found: boolean; refs: string[] };
  imported: AiOpsDashboardsReport["importedResults"];
}): AiOpsDashboardsReport {
  const notes: string[] = [];
  const dashboardSignalsPresent =
    opts.dashboard.found ||
    opts.latencyErrorThroughput.found ||
    opts.resource.found ||
    opts.quality.found ||
    opts.nearRealtime.found;

  if (!dashboardSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI ops-dashboard signals — PERF-R4 may be NOT_APPLICABLE if no production AI services are in scope.",
    );
  }
  if (opts.dashboard.found) {
    notes.push(`Dashboard refs: ${opts.dashboard.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (let=${opts.imported.dashboardCoversLatencyErrorThroughput}, resource=${opts.imported.dashboardCoversResourceUtilization}, quality=${opts.imported.dashboardCoversAiQuality}, nearRealtime=${opts.imported.nearRealtimeRefreshConfigured}, freshnessMin=${opts.imported.panelFreshnessMinutes})`,
    );
  } else if (dashboardSignalsPresent) {
    notes.push(
      "Dashboard signals alone are PARTIAL — import dashboardCoversLatencyErrorThroughput=true + dashboardCoversResourceUtilization=true + dashboardCoversAiQuality=true + nearRealtimeRefreshConfigured=true (measuredAt ≤90d) under imports/ai-ops-dashboards/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const letOk = opts.imported.dashboardCoversLatencyErrorThroughput === true;
  const resourceOk = opts.imported.dashboardCoversResourceUtilization === true;
  const qualityOk = opts.imported.dashboardCoversAiQuality === true;
  const nearOk =
    opts.imported.nearRealtimeRefreshConfigured === true ||
    (opts.imported.panelFreshnessMinutes !== null &&
      opts.imported.panelFreshnessMinutes <= FRESHNESS_MAX_MINUTES);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiOpsDashboardsReport["summary"]["statusHint"];
  let perfR4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.dashboardCoversLatencyErrorThroughput === false ||
      opts.imported.dashboardCoversResourceUtilization === false ||
      opts.imported.dashboardCoversAiQuality === false ||
      opts.imported.nearRealtimeRefreshConfigured === false ||
      (typeof opts.imported.panelFreshnessMinutes === "number" &&
        opts.imported.panelFreshnessMinutes > FRESHNESS_MAX_MINUTES) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!dashboardSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfR4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfR4Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete dashboard coverage, missing near-real-time refresh, stale freshness (>15m), or evidence older than 90 days — PERF-R4 fail.",
    );
  } else if (
    (dashboardSignalsPresent || opts.imported.found) &&
    letOk &&
    resourceOk &&
    qualityOk &&
    nearOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfR4Satisfied = true;
  } else if (dashboardSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfR4Satisfied = false;
    if (opts.imported.found && !letOk) {
      notes.push(
        "Import must show dashboardCoversLatencyErrorThroughput=true.",
      );
    }
    if (opts.imported.found && !resourceOk) {
      notes.push("Import must show dashboardCoversResourceUtilization=true.");
    }
    if (opts.imported.found && !qualityOk) {
      notes.push("Import must show dashboardCoversAiQuality=true.");
    }
    if (opts.imported.found && !nearOk) {
      notes.push(
        "Import must show nearRealtimeRefreshConfigured=true (or panelFreshnessMinutes≤15).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-R4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      dashboard: opts.dashboard,
      latencyErrorThroughput: opts.latencyErrorThroughput,
      resource: opts.resource,
      quality: opts.quality,
      nearRealtime: opts.nearRealtime,
    },
    importedResults: opts.imported,
    summary: {
      dashboardSignalsPresent,
      perfR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiOpsDashboardsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const dashboard = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DASHBOARD_RE.test(path) || DASHBOARD_RE.test(text),
      10,
    );
    const latencyErrorThroughput = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        LATENCY_ERROR_THROUGHPUT_RE.test(path) ||
        LATENCY_ERROR_THROUGHPUT_RE.test(text),
      8,
    );
    const resource = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RESOURCE_RE.test(path) || RESOURCE_RE.test(text),
      6,
    );
    const quality = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        QUALITY_PANEL_RE.test(path) || QUALITY_PANEL_RE.test(text),
      6,
    );
    const nearRealtime = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (NEAR_REALTIME_RE.test(path) || NEAR_REALTIME_RE.test(text)) &&
        (DASHBOARD_RE.test(path + text) || /dashboard|panel|grafana/i.test(path + text)),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiOpsDashboardsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      dashboard: { found: dashboard.length > 0, refs: dashboard },
      latencyErrorThroughput: {
        found: latencyErrorThroughput.length > 0,
        refs: latencyErrorThroughput,
      },
      resource: { found: resource.length > 0, refs: resource },
      quality: { found: quality.length > 0, refs: quality },
      nearRealtime: { found: nearRealtime.length > 0, refs: nearRealtime },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-ops-dashboards-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-ops-dashboards-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-ops-dashboards",
          "perf-r4",
          DETECTOR_ID,
          ...(report.summary.perfR4Satisfied ? ["perf-r4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.dashboard.refs,
        ...report.signals.latencyErrorThroughput.refs,
        ...report.signals.resource.refs,
        ...report.signals.quality.refs,
        ...report.signals.nearRealtime.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-ops-dashboards-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-R4 status=${report.summary.statusHint} signals=${report.summary.dashboardSignalsPresent} satisfied=${report.summary.perfR4Satisfied}; report=imports/${PLUGIN_ID}/ai-ops-dashboards-report.json`,
      nodes,
    };
  },
};
