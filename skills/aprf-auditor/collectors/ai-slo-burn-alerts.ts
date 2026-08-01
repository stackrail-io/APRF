/**
 * ai-slo-burn-alerts — PERF-M3 / repo-ai-slo-burn-alerts.
 *
 * Discovers burn-rate/SLO alerts for critical AI journeys + notify proof.
 * Import alertPoliciesCoverCriticalJourneySlos +
 * notificationPathProvenByTestOrDocumentedFire under imports/ai-slo-burn-alerts/
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

const PLUGIN_ID = "ai-slo-burn-alerts";
const RELATED = ["PERF-M3"] as const;
const DETECTOR_ID = "repo-ai-slo-burn-alerts";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const BURN_ALERT_RE =
  /\b(burn[\s_-]*rate[\s_-]*alert|slo[\s_-]*alert|error[\s_-]*budget[\s_-]*alert|burn[\s_-]*alert|multi[\s_-]*window[\s_-]*burn)\b/i;

const JOURNEY_SLO_RE =
  /\b(critical[\s_-]*journey|journey[\s_-]*slo|ai[\s_-]*slo|llm[\s_-]*slo|availability[\s_-]*slo|latency[\s_-]*slo)\b/i;

const NOTIFY_RE =
  /\b(pagerduty|opsgenie|pager|on[\s_-]*call|notification[\s_-]*channel|sns[\s_-]*topic|alertmanager|notify)\b/i;

const ALERT_TEST_RE =
  /\b(alert[\s_-]*test|synthetic[\s_-]*alert|test[\s_-]*fire|documented[\s_-]*fire|alert[\s_-]*drill|fired[\s_-]*alert)\b/i;

export interface AiSloBurnAlertsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    burnAlert: { found: boolean; refs: string[] };
    journeySlo: { found: boolean; refs: string[] };
    notify: { found: boolean; refs: string[] };
    alertTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    alertPoliciesCoverCriticalJourneySlos: boolean | null;
    notificationPathProvenByTestOrDocumentedFire: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    alertSignalsPresent: boolean;
    perfM3Satisfied: boolean | null;
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
): AiSloBurnAlertsReport["importedResults"] {
  const sources: string[] = [];
  let alertPoliciesCoverCriticalJourneySlos: boolean | null = null;
  let notificationPathProvenByTestOrDocumentedFire: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-slo-burn-alerts-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      alertPoliciesCoverCriticalJourneySlos =
        asBool(data.alertPoliciesCoverCriticalJourneySlos) ??
        asBool(data.alert_policies_cover_critical_journey_slos) ??
        asBool(data.criticalJourneySloAlertsConfigured) ??
        alertPoliciesCoverCriticalJourneySlos;
      notificationPathProvenByTestOrDocumentedFire =
        asBool(data.notificationPathProvenByTestOrDocumentedFire) ??
        asBool(data.notification_path_proven_by_test_or_documented_fire) ??
        asBool(data.notifyProven) ??
        asBool(data.alertTestOrDocumentedFire) ??
        notificationPathProvenByTestOrDocumentedFire;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    alertPoliciesCoverCriticalJourneySlos,
    notificationPathProvenByTestOrDocumentedFire,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSloBurnAlertsReport(opts: {
  assessedAt: string;
  burnAlert: { found: boolean; refs: string[] };
  journeySlo: { found: boolean; refs: string[] };
  notify: { found: boolean; refs: string[] };
  alertTest: { found: boolean; refs: string[] };
  imported: AiSloBurnAlertsReport["importedResults"];
}): AiSloBurnAlertsReport {
  const notes: string[] = [];
  const alertSignalsPresent =
    opts.burnAlert.found ||
    opts.journeySlo.found ||
    opts.notify.found ||
    opts.alertTest.found;

  if (!alertSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI SLO burn-alert signals — PERF-M3 may be NOT_APPLICABLE if no critical AI journey SLOs are in scope.",
    );
  }
  if (opts.burnAlert.found) {
    notes.push(`Burn-alert refs: ${opts.burnAlert.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (coverSlos=${opts.imported.alertPoliciesCoverCriticalJourneySlos}, notifyProven=${opts.imported.notificationPathProvenByTestOrDocumentedFire})`,
    );
  } else if (alertSignalsPresent) {
    notes.push(
      "Alert signals alone are PARTIAL — import alertPoliciesCoverCriticalJourneySlos=true + notificationPathProvenByTestOrDocumentedFire=true (measuredAt ≤90d) under imports/ai-slo-burn-alerts/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverOk = opts.imported.alertPoliciesCoverCriticalJourneySlos === true;
  const notifyOk =
    opts.imported.notificationPathProvenByTestOrDocumentedFire === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSloBurnAlertsReport["summary"]["statusHint"];
  let perfM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.alertPoliciesCoverCriticalJourneySlos === false ||
      opts.imported.notificationPathProvenByTestOrDocumentedFire === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!alertSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing critical-journey SLO alert coverage, unproven notify path, or evidence older than 90 days — PERF-M3 fail.",
    );
  } else if (
    (alertSignalsPresent || opts.imported.found) &&
    coverOk &&
    notifyOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfM3Satisfied = true;
  } else if (alertSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfM3Satisfied = false;
    if (opts.imported.found && !coverOk) {
      notes.push(
        "Import must show alertPoliciesCoverCriticalJourneySlos=true.",
      );
    }
    if (opts.imported.found && !notifyOk) {
      notes.push(
        "Import must show notificationPathProvenByTestOrDocumentedFire=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      burnAlert: opts.burnAlert,
      journeySlo: opts.journeySlo,
      notify: opts.notify,
      alertTest: opts.alertTest,
    },
    importedResults: opts.imported,
    summary: {
      alertSignalsPresent,
      perfM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSloBurnAlertsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const burnAlert = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BURN_ALERT_RE.test(path) || BURN_ALERT_RE.test(text),
      10,
    );
    const journeySlo = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => JOURNEY_SLO_RE.test(path) || JOURNEY_SLO_RE.test(text),
      8,
    );
    const notify = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (NOTIFY_RE.test(path) || NOTIFY_RE.test(text)) &&
        (BURN_ALERT_RE.test(path + text) ||
          JOURNEY_SLO_RE.test(path + text) ||
          /slo|burn|alert/i.test(path + text)),
      8,
    );
    const alertTest = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ALERT_TEST_RE.test(path) || ALERT_TEST_RE.test(text),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiSloBurnAlertsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      burnAlert: { found: burnAlert.length > 0, refs: burnAlert },
      journeySlo: { found: journeySlo.length > 0, refs: journeySlo },
      notify: { found: notify.length > 0, refs: notify },
      alertTest: { found: alertTest.length > 0, refs: alertTest },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-slo-burn-alerts-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-slo-burn-alerts-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-slo-burn-alerts",
          "perf-m3",
          DETECTOR_ID,
          ...(report.summary.perfM3Satisfied ? ["perf-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.burnAlert.refs,
        ...report.signals.journeySlo.refs,
        ...report.signals.notify.refs,
        ...report.signals.alertTest.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-slo-burn-alerts-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-M3 status=${report.summary.statusHint} signals=${report.summary.alertSignalsPresent} satisfied=${report.summary.perfM3Satisfied}; report=imports/${PLUGIN_ID}/ai-slo-burn-alerts-report.json`,
      nodes,
    };
  },
};
