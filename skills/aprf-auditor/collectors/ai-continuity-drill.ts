/**
 * ai-continuity-drill — REL-R4 / repo-ai-continuity-drill.
 *
 * Discovers provider-loss continuity drills + RTO/RPO results.
 * Import continuityDrillCalendarConfigured +
 * providerLossDrillCompletedWithin90Days +
 * rtoRpoMetOrOwnedExceptions under imports/ai-continuity-drill/
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

const PLUGIN_ID = "ai-continuity-drill";
const RELATED = ["REL-R4"] as const;
const DETECTOR_ID = "repo-ai-continuity-drill";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CALENDAR_RE =
  /\b(continuity[_-]?drill[_-]?(calendar|schedule)|drill[_-]?calendar|bcp[_-]?drill|dr[_-]?drill[_-]?(calendar|schedule)|continuity[_-]?exercise[_-]?calendar)\b/i;

const PROVIDER_LOSS_RE =
  /\b(provider[_-]?loss|provider[_-]?(outage|fail)|llm[_-]?provider[_-]?(loss|outage)|ai[_-]?provider[_-]?(loss|outage)|model[_-]?provider[_-]?loss)\b/i;

const DRILL_REPORT_RE =
  /\b(continuity[_-]?drill[_-]?(report|result)|provider[_-]?loss[_-]?drill|drill[_-]?(report|after[_-]?action)|rto[_-]?rpo[_-]?(result|met|miss))\b/i;

export interface AiContinuityDrillReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    calendar: { found: boolean; refs: string[] };
    providerLoss: { found: boolean; refs: string[] };
    report: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    continuityDrillCalendarConfigured: boolean | null;
    providerLossDrillCompletedWithin90Days: boolean | null;
    rtoRpoMetOrOwnedExceptions: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    drillSignalsPresent: boolean;
    relR4Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".pdf"],
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
): AiContinuityDrillReport["importedResults"] {
  const sources: string[] = [];
  let continuityDrillCalendarConfigured: boolean | null = null;
  let providerLossDrillCompletedWithin90Days: boolean | null = null;
  let rtoRpoMetOrOwnedExceptions: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-continuity-drill-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      continuityDrillCalendarConfigured =
        asBool(data.continuityDrillCalendarConfigured) ??
        asBool(data.continuity_drill_calendar_configured) ??
        asBool(data.drillCalendarConfigured) ??
        continuityDrillCalendarConfigured;
      providerLossDrillCompletedWithin90Days =
        asBool(data.providerLossDrillCompletedWithin90Days) ??
        asBool(data.provider_loss_drill_completed_within_90_days) ??
        asBool(data.providerLossDrillCompleted) ??
        providerLossDrillCompletedWithin90Days;
      rtoRpoMetOrOwnedExceptions =
        asBool(data.rtoRpoMetOrOwnedExceptions) ??
        asBool(data.rto_rpo_met_or_owned_exceptions) ??
        asBool(data.rtoRpoMet) ??
        asBool(data.rtoRpoResultsRetained) ??
        rtoRpoMetOrOwnedExceptions;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    continuityDrillCalendarConfigured,
    providerLossDrillCompletedWithin90Days,
    rtoRpoMetOrOwnedExceptions,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiContinuityDrillReport(opts: {
  assessedAt: string;
  calendar: { found: boolean; refs: string[] };
  providerLoss: { found: boolean; refs: string[] };
  report: { found: boolean; refs: string[] };
  imported: AiContinuityDrillReport["importedResults"];
}): AiContinuityDrillReport {
  const notes: string[] = [];
  const drillSignalsPresent =
    opts.calendar.found || opts.providerLoss.found || opts.report.found;

  if (!drillSignalsPresent && !opts.imported.found) {
    notes.push(
      "No continuity-drill signals — REL-R4 may be NOT_APPLICABLE if there are no production AI provider dependencies.",
    );
  }
  if (opts.calendar.found) {
    notes.push(`Calendar refs: ${opts.calendar.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.providerLoss.found) {
    notes.push(
      `Provider-loss refs: ${opts.providerLoss.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.report.found) {
    notes.push(`Report refs: ${opts.report.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (calendar=${opts.imported.continuityDrillCalendarConfigured}, drill90d=${opts.imported.providerLossDrillCompletedWithin90Days}, rtoRpo=${opts.imported.rtoRpoMetOrOwnedExceptions})`,
    );
  } else if (drillSignalsPresent) {
    notes.push(
      "Drill signals alone are PARTIAL — import continuityDrillCalendarConfigured=true + providerLossDrillCompletedWithin90Days=true + rtoRpoMetOrOwnedExceptions=true (measuredAt ≤90d) under imports/ai-continuity-drill/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const calendarOk = opts.imported.continuityDrillCalendarConfigured === true;
  const drillOk = opts.imported.providerLossDrillCompletedWithin90Days === true;
  const rtoOk = opts.imported.rtoRpoMetOrOwnedExceptions === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiContinuityDrillReport["summary"]["statusHint"];
  let relR4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.continuityDrillCalendarConfigured === false ||
      opts.imported.providerLossDrillCompletedWithin90Days === false ||
      opts.imported.rtoRpoMetOrOwnedExceptions === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!drillSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR4Satisfied = false;
    notes.push(
      "Imported evidence shows missing drill calendar, drill ≤90 days, RTO/RPO results/exceptions, or attest older than 90 days — REL-R4 fail.",
    );
  } else if (
    (drillSignalsPresent || opts.imported.found) &&
    calendarOk &&
    drillOk &&
    rtoOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR4Satisfied = true;
  } else if (drillSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR4Satisfied = false;
    if (opts.imported.found && !calendarOk) {
      notes.push("Import must show continuityDrillCalendarConfigured=true.");
    }
    if (opts.imported.found && !drillOk) {
      notes.push("Import must show providerLossDrillCompletedWithin90Days=true.");
    }
    if (opts.imported.found && !rtoOk) {
      notes.push("Import must show rtoRpoMetOrOwnedExceptions=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      calendar: opts.calendar,
      providerLoss: opts.providerLoss,
      report: opts.report,
    },
    importedResults: opts.imported,
    summary: {
      drillSignalsPresent,
      relR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiContinuityDrillCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const calendarRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CALENDAR_RE.test(path) || CALENDAR_RE.test(text),
      8,
    );
    const providerLossRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROVIDER_LOSS_RE.test(path) || PROVIDER_LOSS_RE.test(text),
      10,
    );
    const reportRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        DRILL_REPORT_RE.test(path) ||
        (/(drill|report|after[_-]?action|rto|rpo)/i.test(path) &&
          (DRILL_REPORT_RE.test(text) || PROVIDER_LOSS_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiContinuityDrillReport({
      assessedAt: ctx.assessedAt.toISOString(),
      calendar: { found: calendarRefs.length > 0, refs: calendarRefs },
      providerLoss: {
        found: providerLossRefs.length > 0,
        refs: providerLossRefs,
      },
      report: { found: reportRefs.length > 0, refs: reportRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-continuity-drill-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-continuity-drill-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-continuity-drill",
          "rel-r4",
          DETECTOR_ID,
          ...(report.summary.relR4Satisfied ? ["rel-r4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.calendar.refs,
        ...report.signals.providerLoss.refs,
        ...report.signals.report.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-continuity-drill-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R4 status=${report.summary.statusHint} signals=${report.summary.drillSignalsPresent} satisfied=${report.summary.relR4Satisfied}; report=imports/${PLUGIN_ID}/ai-continuity-drill-report.json`,
      nodes,
    };
  },
};
