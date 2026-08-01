/**
 * ai-customer-notification-criteria — INC-R3 /
 * repo-ai-customer-notification-criteria.
 *
 * Discovers AI customer notification criteria + drill/incident samples.
 * Import criteriaMapEventTypesToNotifyDecision +
 * lastDrillOrIncidentFollowedCriteriaWithin12Months + timestampsPresent
 * under imports/ai-customer-notification-criteria/ to unlock PASS
 * (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-customer-notification-criteria";
const RELATED = ["INC-R3"] as const;
const DETECTOR_ID = "repo-ai-customer-notification-criteria";
const IMPORT_MAX_AGE_DAYS = 90;
const FOLLOWED_MAX_AGE_DAYS = 365;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CRITERIA_RE =
  /\b(customer[\s_-]*notif|user[\s_-]*notif|notify[\s_-]*customer|disclosure[\s_-]*criter|notification[\s_-]*criter|notify[\s_-]*\/[\s_-]*no[\s_-]*notify|no[\s_-]*notify)\b/i;

const EVENT_TYPE_RE =
  /\b(safety[\s_-]*incident|quality[\s_-]*fail|data[\s_-]*exposure|data[\s_-]*breach|widespread[\s_-]*quality|ai[\s_-]*incident)\b/i;

const SAMPLE_RE =
  /\b(notification[\s_-]*drill|comms[\s_-]*drill|customer[\s_-]*comms|status[\s_-]*page|notification[\s_-]*sample|followed[\s_-]*criter)\b/i;

const TIMESTAMP_RE =
  /\b(timestamp|notified[\s_-]*at|sent[\s_-]*at|decision[\s_-]*at|\d{4}-\d{2}-\d{2})\b/i;

export interface AiCustomerNotificationCriteriaReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    criteria: { found: boolean; refs: string[] };
    sample: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    criteriaMapEventTypesToNotifyDecision: boolean | null;
    lastDrillOrIncidentFollowedCriteriaWithin12Months: boolean | null;
    lastDrillOrIncidentAgeDays: number | null;
    timestampsPresent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    notificationSignalsPresent: boolean;
    incR3Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".html"],
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
): AiCustomerNotificationCriteriaReport["importedResults"] {
  const sources: string[] = [];
  let criteriaMapEventTypesToNotifyDecision: boolean | null = null;
  let lastDrillOrIncidentFollowedCriteriaWithin12Months: boolean | null = null;
  let lastDrillOrIncidentAgeDays: number | null = null;
  let timestampsPresent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-customer-notification-criteria-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastDrillOrIncidentAgeDays =
        asNum(data.lastDrillOrIncidentAgeDays) ??
        asNum(data.last_drill_or_incident_age_days) ??
        lastDrillOrIncidentAgeDays;
      criteriaMapEventTypesToNotifyDecision =
        asBool(data.criteriaMapEventTypesToNotifyDecision) ??
        asBool(data.criteria_map_event_types_to_notify_decision) ??
        asBool(data.criteriaMapPresent) ??
        criteriaMapEventTypesToNotifyDecision;
      lastDrillOrIncidentFollowedCriteriaWithin12Months =
        asBool(data.lastDrillOrIncidentFollowedCriteriaWithin12Months) ??
        asBool(data.last_drill_or_incident_followed_criteria_within_12_months) ??
        asBool(data.followedCriteriaWithin12Months) ??
        lastDrillOrIncidentFollowedCriteriaWithin12Months;
      timestampsPresent =
        asBool(data.timestampsPresent) ??
        asBool(data.timestamps_present) ??
        timestampsPresent;

      if (lastDrillOrIncidentAgeDays !== null) {
        lastDrillOrIncidentFollowedCriteriaWithin12Months =
          lastDrillOrIncidentFollowedCriteriaWithin12Months ??
          lastDrillOrIncidentAgeDays <= FOLLOWED_MAX_AGE_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    criteriaMapEventTypesToNotifyDecision,
    lastDrillOrIncidentFollowedCriteriaWithin12Months,
    lastDrillOrIncidentAgeDays,
    timestampsPresent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiCustomerNotificationCriteriaReport(opts: {
  assessedAt: string;
  criteria: { found: boolean; refs: string[] };
  sample: { found: boolean; refs: string[] };
  imported: AiCustomerNotificationCriteriaReport["importedResults"];
}): AiCustomerNotificationCriteriaReport {
  const notes: string[] = [];
  const notificationSignalsPresent =
    opts.criteria.found || opts.sample.found;

  if (!notificationSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI customer-notification signals — INC-R3 may be NOT_APPLICABLE if no customer-facing AI system is in scope.",
    );
  }
  if (opts.criteria.found) {
    notes.push(`Criteria refs: ${opts.criteria.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.sample.found) {
    notes.push(`Sample refs: ${opts.sample.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (criteriaMap=${opts.imported.criteriaMapEventTypesToNotifyDecision}, followed12m=${opts.imported.lastDrillOrIncidentFollowedCriteriaWithin12Months}, age=${opts.imported.lastDrillOrIncidentAgeDays}, timestamps=${opts.imported.timestampsPresent})`,
    );
  } else if (notificationSignalsPresent) {
    notes.push(
      "Notification signals alone are PARTIAL — import criteriaMapEventTypesToNotifyDecision=true + lastDrillOrIncidentFollowedCriteriaWithin12Months=true (measuredAt ≤90d) under imports/ai-customer-notification-criteria/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const criteriaOk =
    opts.imported.criteriaMapEventTypesToNotifyDecision === true;
  const followedOk =
    opts.imported.lastDrillOrIncidentFollowedCriteriaWithin12Months === true ||
    (opts.imported.lastDrillOrIncidentAgeDays !== null &&
      opts.imported.lastDrillOrIncidentAgeDays <= FOLLOWED_MAX_AGE_DAYS);
  const timestampsOk = opts.imported.timestampsPresent === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiCustomerNotificationCriteriaReport["summary"]["statusHint"];
  let incR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.criteriaMapEventTypesToNotifyDecision === false ||
      opts.imported.lastDrillOrIncidentFollowedCriteriaWithin12Months ===
        false ||
      (typeof opts.imported.lastDrillOrIncidentAgeDays === "number" &&
        opts.imported.lastDrillOrIncidentAgeDays > FOLLOWED_MAX_AGE_DAYS) ||
      opts.imported.timestampsPresent === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!notificationSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing criteria map, stale/unfollowed sample (>12 months), missing timestamps, or evidence older than 90 days — INC-R3 fail.",
    );
  } else if (
    (notificationSignalsPresent || opts.imported.found) &&
    criteriaOk &&
    followedOk &&
    timestampsOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incR3Satisfied = true;
  } else if (notificationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incR3Satisfied = false;
    if (opts.imported.found && !criteriaOk) {
      notes.push(
        "Import must show criteriaMapEventTypesToNotifyDecision=true.",
      );
    }
    if (opts.imported.found && !followedOk) {
      notes.push(
        "Import must show lastDrillOrIncidentFollowedCriteriaWithin12Months=true (or lastDrillOrIncidentAgeDays≤365).",
      );
    }
    if (opts.imported.found && !timestampsOk) {
      notes.push("Import must show timestampsPresent=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      criteria: opts.criteria,
      sample: opts.sample,
    },
    importedResults: opts.imported,
    summary: {
      notificationSignalsPresent,
      incR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiCustomerNotificationCriteriaCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const criteria = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CRITERIA_RE.test(path) || CRITERIA_RE.test(text)) &&
        (EVENT_TYPE_RE.test(path + text) ||
          /ai|llm|safety|exposure/i.test(path + text)),
      10,
    );
    const sample = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SAMPLE_RE.test(path) || SAMPLE_RE.test(text)) &&
        (CRITERIA_RE.test(path + text) ||
          TIMESTAMP_RE.test(text) ||
          EVENT_TYPE_RE.test(text)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiCustomerNotificationCriteriaReport({
      assessedAt: ctx.assessedAt.toISOString(),
      criteria: { found: criteria.length > 0, refs: criteria },
      sample: { found: sample.length > 0, refs: sample },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-customer-notification-criteria-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-customer-notification-criteria-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-customer-notification-criteria",
          "inc-r3",
          DETECTOR_ID,
          ...(report.summary.incR3Satisfied ? ["inc-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.criteria.refs,
        ...report.signals.sample.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-customer-notification-criteria-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-R3 status=${report.summary.statusHint} signals=${report.summary.notificationSignalsPresent} satisfied=${report.summary.incR3Satisfied}; report=imports/${PLUGIN_ID}/ai-customer-notification-criteria-report.json`,
      nodes,
    };
  },
};
