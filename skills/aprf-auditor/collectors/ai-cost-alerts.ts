/**
 * ai-cost-alerts — COST-M2 / repo-cost-alert-config detector executor.
 *
 * Discovers budget-burn / spend-anomaly alert config. Import notify proof
 * under imports/ai-cost-alerts/ to unlock PASS.
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-cost-alerts";
const RELATED = ["COST-M2"] as const;
const DETECTOR_ID = "repo-cost-alert-config";

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|embedding|token|finops|helicone)/i;

const COST_SIGNAL_RE =
  /\b(cost|spend|budget|token[_-]?usage|finops|billing|quota[_-]?burn)\b/i;

const BUDGET_BURN_RE =
  /\bbudget[_-]?burn|\bbudget[_-]?(alert|alarm|threshold)|\bspend[_-]?(cap|ceiling).{0,24}(alert|alarm)|\bburn[_-]?rate|\bquota[_-]?burn/i;

const ANOMALY_RE =
  /\bcost[_-]?anomal|\bspend[_-]?anomal|\banomal(?:y|ous)[_-]?(?:cost|spend|usage|token)|\boutlier[_-]?(?:spend|cost)|\bunusual[_-]?(?:spend|cost)/i;

const ALERT_RE =
  /\b(alert|alarm|pager|pagerduty|opsgenie|notification[_-]?channel|on[_-]?call|sns[_-]?topic)\b/i;

export interface AiCostAlertsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  budgetBurnAlerts: { found: boolean; refs: string[] };
  anomalyAlerts: { found: boolean; refs: string[] };
  costDashboards: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    hasBudgetBurnAlert: boolean | null;
    hasAnomalyAlert: boolean | null;
    notifyProven: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    bothAlertClassesPresent: boolean;
    costM2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".tf"],
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
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm)\b/i.test(
          text,
        ),
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
): AiCostAlertsReport["importedResults"] {
  const sources: string[] = [];
  let hasBudgetBurnAlert: boolean | null = null;
  let hasAnomalyAlert: boolean | null = null;
  let notifyProven: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-cost-alerts-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      hasBudgetBurnAlert =
        asBool(data.hasBudgetBurnAlert) ??
        asBool(data.budgetBurnAlertOk) ??
        asBool(data.budgetBurn) ??
        hasBudgetBurnAlert;
      hasAnomalyAlert =
        asBool(data.hasAnomalyAlert) ??
        asBool(data.anomalyAlertOk) ??
        asBool(data.spendAnomaly) ??
        hasAnomalyAlert;
      notifyProven =
        asBool(data.notifyProven) ??
        asBool(data.alertFiredOrTested) ??
        asBool(data.notifyTestPassed) ??
        asBool(data.paged) ??
        notifyProven;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const events = Array.isArray(data.events)
        ? (data.events as Array<Record<string, unknown>>)
        : Array.isArray(data.tests)
          ? (data.tests as Array<Record<string, unknown>>)
          : Array.isArray(data.results)
            ? (data.results as Array<Record<string, unknown>>)
            : [];
      for (const e of events) {
        if (asBool(e.budgetBurn) === true || asBool(e.budgetBurnAlert) === true) {
          hasBudgetBurnAlert = true;
        }
        if (asBool(e.anomaly) === true || asBool(e.spendAnomaly) === true) {
          hasAnomalyAlert = true;
        }
        const ok =
          e.notified === true ||
          e.paged === true ||
          e.fired === true ||
          e.passed === true ||
          String(e.outcome || "").toLowerCase() === "notified" ||
          String(e.outcome || "").toLowerCase() === "paged";
        notifyProven = notifyProven === null ? ok : notifyProven && ok;
        const age = asNum(e.ageDays) ?? asNum(e.age_days);
        if (age !== null) ageDays = age;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    hasBudgetBurnAlert,
    hasAnomalyAlert,
    notifyProven,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiCostAlertsReport(opts: {
  assessedAt: string;
  budgetBurn: { found: boolean; refs: string[] };
  anomaly: { found: boolean; refs: string[] };
  dashboards: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiCostAlertsReport["importedResults"];
}): AiCostAlertsReport {
  const notes: string[] = [];
  const bothFromRepo = opts.budgetBurn.found && opts.anomaly.found;
  const bothFromImport =
    opts.imported.hasBudgetBurnAlert === true &&
    opts.imported.hasAnomalyAlert === true;
  const bothAlertClassesPresent = bothFromRepo || bothFromImport;

  if (!opts.aiSignals && !bothAlertClassesPresent && !opts.imported.found && !opts.dashboards.found) {
    notes.push(
      "No AI/cost-alert signals — COST-M2 may be NOT_APPLICABLE if there is no production AI spend.",
    );
  }
  if (opts.budgetBurn.found) {
    notes.push(`Budget-burn alert refs: ${opts.budgetBurn.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No budget-burn alert policy signals found in repo.");
  }
  if (opts.anomaly.found) {
    notes.push(`Anomaly alert refs: ${opts.anomaly.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No spend-anomaly alert policy signals found in repo.");
  }
  if (opts.dashboards.found) {
    notes.push(`Cost dashboard refs: ${opts.dashboards.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (budget=${opts.imported.hasBudgetBurnAlert}, anomaly=${opts.imported.hasAnomalyAlert}, notify=${opts.imported.notifyProven}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (bothFromRepo || opts.dashboards.found) {
    notes.push(
      "Alert/dashboard config alone is PARTIAL — import ≤90-day notify proof under imports/ai-cost-alerts/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const notifyOk = opts.imported.notifyProven === true && ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const alertsOk = bothAlertClassesPresent;

  let statusHint: AiCostAlertsReport["summary"]["statusHint"];
  let costM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.notifyProven === false ||
      opts.imported.hasBudgetBurnAlert === false ||
      opts.imported.hasAnomalyAlert === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.budgetBurn.found &&
    !opts.anomaly.found &&
    !opts.dashboards.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    costM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costM2Satisfied = false;
    notes.push(
      "Imported results show missing alert class, notify not proven, or evidence older than 90 days — COST-M2 fail.",
    );
  } else if (alertsOk && notifyOk && importFresh) {
    statusHint = "pass";
    costM2Satisfied = true;
  } else if (
    opts.budgetBurn.found ||
    opts.anomaly.found ||
    opts.dashboards.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costM2Satisfied = false;
    if (opts.imported.found && !alertsOk) {
      notes.push(
        "Need both hasBudgetBurnAlert=true and hasAnomalyAlert=true (repo and/or import).",
      );
    }
    if (opts.imported.found && !notifyOk) {
      notes.push(
        "Import must show notifyProven=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-M2 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costM2Satisfied = null;
    notes.push(
      "AI signals present but no cost alert/dashboard or notify evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    budgetBurnAlerts: opts.budgetBurn,
    anomalyAlerts: opts.anomaly,
    costDashboards: opts.dashboards,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      bothAlertClassesPresent,
      costM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiCostAlertsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const budgetBurnRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!BUDGET_BURN_RE.test(path) && !BUDGET_BURN_RE.test(text)) return false;
        return (
          ALERT_RE.test(path) ||
          ALERT_RE.test(text) ||
          COST_SIGNAL_RE.test(path) ||
          COST_SIGNAL_RE.test(text)
        );
      },
    );
    const anomalyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!ANOMALY_RE.test(path) && !ANOMALY_RE.test(text)) return false;
        return ALERT_RE.test(path) || ALERT_RE.test(text) || COST_SIGNAL_RE.test(text);
      },
    );
    const dashboardRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        const dash =
          /\b(dashboard|grafana|cloudwatch|datadog|helicone|cost[_-]?report)\b/i.test(
            path,
          ) ||
          /\b(dashboard|grafana|cloudwatch|datadog|helicone)\b/i.test(text);
        return dash && COST_SIGNAL_RE.test(path + "\n" + text);
      },
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiCostAlertsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      budgetBurn: { found: budgetBurnRefs.length > 0, refs: budgetBurnRefs },
      anomaly: { found: anomalyRefs.length > 0, refs: anomalyRefs },
      dashboards: { found: dashboardRefs.length > 0, refs: dashboardRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-cost-alerts-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-cost-alerts-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-cost-alerts",
          "cost-m2",
          DETECTOR_ID,
          ...(report.summary.bothAlertClassesPresent
            ? ["budget-and-anomaly-alerts"]
            : []),
          ...(report.summary.costM2Satisfied ? ["cost-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...budgetBurnRefs.slice(0, 3),
        ...anomalyRefs.slice(0, 3),
        ...dashboardRefs.slice(0, 2),
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
        signals: ["ai-cost-alerts-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-M2 status=${report.summary.statusHint} bothAlerts=${report.summary.bothAlertClassesPresent} satisfied=${report.summary.costM2Satisfied}; report=imports/${PLUGIN_ID}/ai-cost-alerts-report.json`,
      nodes,
    };
  },
};
