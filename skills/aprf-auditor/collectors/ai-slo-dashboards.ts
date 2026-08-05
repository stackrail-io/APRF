/**
 * ai-slo-dashboards — OBS-R3 / repo-ai-slo-dashboards.
 *
 * Discovers named AI SLO targets (latency/error/quality burn) + burn alerts.
 * Import namedSloTargetsForCriticalAiJourneys + coversLatencyErrorAndQualityBurn
 * + burnRateAlertConfigured under imports/ai-slo-dashboards/
 * to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-slo-dashboards";
const RELATED = ["OBS-R3"] as const;
const DETECTOR_ID = "repo-ai-slo-dashboards";
const IMPORT_MAX_AGE_DAYS = 90;

const SLO_RE =
  /\b(ai[\s_-]*slo|llm[\s_-]*slo|model[\s_-]*slo|slo[\s_-]*dashboard|error[\s_-]*budget|service[\s_-]*level[\s_-]*objective)\b/i;

const LATENCY_ERROR_QUALITY_RE =
  /\b((latency|p95|p99).{0,40}(error|quality)|quality[\s_-]*burn|error[\s_-]*burn|burn[\s_-]*rate|latency.{0,20}error.{0,20}quality)\b/i;

const BURN_ALERT_RE =
  /\b(burn[\s_-]*rate[\s_-]*alert|burn[\s_-]*alert|alert.{0,30}burn|page.{0,20}burn|slo[\s_-]*alert)\b/i;

const DASHBOARD_RE =
  /\b(slo[\s_-]*dashboard|grafana|datadog[\s_-]*dashboard|dashboard[\s_-]*url|retention[\s_-]*note)\b/i;

export interface AiSloDashboardsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    slo: { found: boolean; refs: string[] };
    dimensions: { found: boolean; refs: string[] };
    burnAlert: { found: boolean; refs: string[] };
    dashboard: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    namedSloTargetsForCriticalAiJourneys: boolean | null;
    coversLatencyErrorAndQualityBurn: boolean | null;
    burnRateAlertConfigured: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    sloSignalsPresent: boolean;
    obsR3Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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
): AiSloDashboardsReport["importedResults"] {
  const sources: string[] = [];
  let namedSloTargetsForCriticalAiJourneys: boolean | null = null;
  let coversLatencyErrorAndQualityBurn: boolean | null = null;
  let burnRateAlertConfigured: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-slo-dashboards-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      namedSloTargetsForCriticalAiJourneys =
        asBool(data.namedSloTargetsForCriticalAiJourneys) ??
        asBool(data.named_slo_targets_for_critical_ai_journeys) ??
        asBool(data.namedSloTargetsConfigured) ??
        namedSloTargetsForCriticalAiJourneys;
      coversLatencyErrorAndQualityBurn =
        asBool(data.coversLatencyErrorAndQualityBurn) ??
        asBool(data.covers_latency_error_and_quality_burn) ??
        asBool(data.coversLatencyErrorQualityBurn) ??
        coversLatencyErrorAndQualityBurn;
      burnRateAlertConfigured =
        asBool(data.burnRateAlertConfigured) ??
        asBool(data.burn_rate_alert_configured) ??
        asBool(data.burnAlertConfigured) ??
        burnRateAlertConfigured;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    namedSloTargetsForCriticalAiJourneys,
    coversLatencyErrorAndQualityBurn,
    burnRateAlertConfigured,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSloDashboardsReport(opts: {
  assessedAt: string;
  slo: { found: boolean; refs: string[] };
  dimensions: { found: boolean; refs: string[] };
  burnAlert: { found: boolean; refs: string[] };
  dashboard: { found: boolean; refs: string[] };
  imported: AiSloDashboardsReport["importedResults"];
}): AiSloDashboardsReport {
  const notes: string[] = [];
  const sloSignalsPresent =
    opts.slo.found ||
    opts.dimensions.found ||
    opts.burnAlert.found ||
    opts.dashboard.found;

  if (!sloSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI SLO/dashboard signals — OBS-R3 may be NOT_APPLICABLE if no critical AI journeys are in scope.",
    );
  }
  if (opts.slo.found) {
    notes.push(`SLO refs: ${opts.slo.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.burnAlert.found) {
    notes.push(
      `Burn-alert refs: ${opts.burnAlert.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (namedSlos=${opts.imported.namedSloTargetsForCriticalAiJourneys}, dimensions=${opts.imported.coversLatencyErrorAndQualityBurn}, burnAlert=${opts.imported.burnRateAlertConfigured})`,
    );
  } else if (sloSignalsPresent) {
    notes.push(
      "SLO signals alone are PARTIAL — import namedSloTargetsForCriticalAiJourneys=true + coversLatencyErrorAndQualityBurn=true + burnRateAlertConfigured=true (measuredAt ≤90d) under imports/ai-slo-dashboards/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const namedOk = opts.imported.namedSloTargetsForCriticalAiJourneys === true;
  const dimensionsOk = opts.imported.coversLatencyErrorAndQualityBurn === true;
  const alertOk = opts.imported.burnRateAlertConfigured === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSloDashboardsReport["summary"]["statusHint"];
  let obsR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.namedSloTargetsForCriticalAiJourneys === false ||
      opts.imported.coversLatencyErrorAndQualityBurn === false ||
      opts.imported.burnRateAlertConfigured === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!sloSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing named AI SLOs, incomplete latency/error/quality-burn coverage, missing burn alerts, or evidence older than 90 days — OBS-R3 fail.",
    );
  } else if (
    (sloSignalsPresent || opts.imported.found) &&
    namedOk &&
    dimensionsOk &&
    alertOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsR3Satisfied = true;
  } else if (sloSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsR3Satisfied = false;
    if (opts.imported.found && !namedOk) {
      notes.push(
        "Import must show namedSloTargetsForCriticalAiJourneys=true.",
      );
    }
    if (opts.imported.found && !dimensionsOk) {
      notes.push("Import must show coversLatencyErrorAndQualityBurn=true.");
    }
    if (opts.imported.found && !alertOk) {
      notes.push("Import must show burnRateAlertConfigured=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock OBS-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      slo: opts.slo,
      dimensions: opts.dimensions,
      burnAlert: opts.burnAlert,
      dashboard: opts.dashboard,
    },
    importedResults: opts.imported,
    summary: {
      sloSignalsPresent,
      obsR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSloDashboardsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const slo = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SLO_RE.test(path) || SLO_RE.test(text),
      10,
    );
    const dimensions = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        LATENCY_ERROR_QUALITY_RE.test(path) ||
        LATENCY_ERROR_QUALITY_RE.test(text),
      8,
    );
    const burnAlert = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BURN_ALERT_RE.test(path) || BURN_ALERT_RE.test(text),
      8,
    );
    const dashboard = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DASHBOARD_RE.test(path) || DASHBOARD_RE.test(text)) &&
        (SLO_RE.test(path + text) || /slo|burn|ai|llm/i.test(path + text)),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiSloDashboardsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      slo: { found: slo.length > 0, refs: slo },
      dimensions: { found: dimensions.length > 0, refs: dimensions },
      burnAlert: { found: burnAlert.length > 0, refs: burnAlert },
      dashboard: { found: dashboard.length > 0, refs: dashboard },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-slo-dashboards-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-slo-dashboards-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-slo-dashboards",
          "obs-r3",
          DETECTOR_ID,
          ...(report.summary.obsR3Satisfied ? ["obs-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.slo.refs,
        ...report.signals.dimensions.refs,
        ...report.signals.burnAlert.refs,
        ...report.signals.dashboard.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-slo-dashboards-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-R3 status=${report.summary.statusHint} signals=${report.summary.sloSignalsPresent} satisfied=${report.summary.obsR3Satisfied}; report=imports/${PLUGIN_ID}/ai-slo-dashboards-report.json`,
      nodes,
    };
  },
};
