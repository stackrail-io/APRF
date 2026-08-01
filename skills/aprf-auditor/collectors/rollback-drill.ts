/**
 * rollback-drill — CHG-M3 / repo-rollback-drill.
 *
 * Discovers successful rollback drills/incidents within documented RTO.
 * Import successfulRollbacksLast90Days≥1 + measuredTimeToRestoreWithinRto under
 * imports/rollback-drill/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "rollback-drill";
const RELATED = ["CHG-M3"] as const;
const DETECTOR_ID = "repo-rollback-drill";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_CHANGE_RE =
  /(prompt|model|llm|deploy|release|rollback|canary|feature[\s_-]*flag)/i;

const DRILL_RE =
  /\b(rollback[\s_-]*drill|drill[\s_-]*rollback|game[\s_-]*day|incident[\s_-]*rollback|rollback[\s_-]*incident|successful[\s_-]*rollback)\b/i;

const RTO_RE =
  /\b(rto|recovery[\s_-]*time|time[\s_-]*to[\s_-]*restore|restore[\s_-]*within|≤\s*\d+\s*(min|minute|m|hour|h)\b|<=\s*\d+\s*(min|minute|m|hour|h))\b/i;

const SUCCESS_RE =
  /\b(successful[\s_-]*rollback|rollback[\s_-]*succeeded|restore[\s_-]*succeeded|outcome:\s*success|passed[\s_-]*drill)\b/i;

const TIMESTAMP_RE =
  /\b(timestamp|started[\s_-]*at|completed[\s_-]*at|duration|elapsed|time[\s_-]*to[\s_-]*restore)\b/i;

export interface RollbackDrillReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    drill: { found: boolean; refs: string[] };
    rto: { found: boolean; refs: string[] };
    success: { found: boolean; refs: string[] };
    timestamps: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    successfulRollbacksLast90Days: number | null;
    measuredTimeToRestoreWithinRto: boolean | null;
    documentedRtoPresent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiChangeSignalsPresent: boolean;
    drillSignalsPresent: boolean;
    chgM3Satisfied: boolean | null;
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

function detectAiChangeSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_CHANGE_RE.test(path) ||
        /\b(prompt|model[\s_-]*pin|llm|ai[\s_-]*deploy)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): RollbackDrillReport["importedResults"] {
  const sources: string[] = [];
  let successfulRollbacksLast90Days: number | null = null;
  let measuredTimeToRestoreWithinRto: boolean | null = null;
  let documentedRtoPresent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/rollback-drill-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      successfulRollbacksLast90Days =
        asNum(data.successfulRollbacksLast90Days) ??
        asNum(data.successful_rollbacks_last_90_days) ??
        asNum(data.successfulRollbackCount) ??
        successfulRollbacksLast90Days;
      measuredTimeToRestoreWithinRto =
        asBool(data.measuredTimeToRestoreWithinRto) ??
        asBool(data.measured_time_to_restore_within_rto) ??
        asBool(data.withinRto) ??
        measuredTimeToRestoreWithinRto;
      documentedRtoPresent =
        asBool(data.documentedRtoPresent) ??
        asBool(data.documented_rto_present) ??
        asBool(data.hasDocumentedRto) ??
        documentedRtoPresent;

      if (asBool(data.successfulRollbackCompleted) === true) {
        successfulRollbacksLast90Days =
          successfulRollbacksLast90Days ?? 1;
      }
      // Affirmative RTO met overrides earlier false.
      if (asBool(data.timeToRestoreMetRto) === true) {
        measuredTimeToRestoreWithinRto = true;
        documentedRtoPresent = documentedRtoPresent ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    successfulRollbacksLast90Days,
    measuredTimeToRestoreWithinRto,
    documentedRtoPresent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildRollbackDrillReport(opts: {
  assessedAt: string;
  drill: { found: boolean; refs: string[] };
  rto: { found: boolean; refs: string[] };
  success: { found: boolean; refs: string[] };
  timestamps: { found: boolean; refs: string[] };
  aiChangeSignals: boolean;
  imported: RollbackDrillReport["importedResults"];
}): RollbackDrillReport {
  const notes: string[] = [];
  const drillSignalsPresent =
    opts.drill.found ||
    opts.rto.found ||
    opts.success.found ||
    opts.timestamps.found;

  if (!opts.aiChangeSignals && !drillSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI-change/rollback-drill signals — CHG-M3 may be NOT_APPLICABLE if no production AI changes need rollback.",
    );
  }
  if (opts.drill.found) {
    notes.push(`Drill refs: ${opts.drill.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.rto.found) {
    notes.push(`RTO refs: ${opts.rto.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.success.found) {
    notes.push(`Success refs: ${opts.success.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.timestamps.found) {
    notes.push(
      `Timestamp refs: ${opts.timestamps.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (successes=${opts.imported.successfulRollbacksLast90Days}, withinRto=${opts.imported.measuredTimeToRestoreWithinRto}, rtoDoc=${opts.imported.documentedRtoPresent})`,
    );
  } else if (drillSignalsPresent) {
    notes.push(
      "Drill signals alone are PARTIAL — import successfulRollbacksLast90Days≥1 + measuredTimeToRestoreWithinRto=true (measuredAt ≤90d) under imports/rollback-drill/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const successOk =
    opts.imported.successfulRollbacksLast90Days !== null &&
    opts.imported.successfulRollbacksLast90Days >= 1;
  const withinRtoOk = opts.imported.measuredTimeToRestoreWithinRto === true;
  // Documented RTO: prefer explicit true; if within-RTO attested, treat as present.
  const rtoDocOk =
    opts.imported.documentedRtoPresent === true ||
    (opts.imported.documentedRtoPresent === null && withinRtoOk);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: RollbackDrillReport["summary"]["statusHint"];
  let chgM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.successfulRollbacksLast90Days !== null &&
      opts.imported.successfulRollbacksLast90Days < 1) ||
      opts.imported.measuredTimeToRestoreWithinRto === false ||
      opts.imported.documentedRtoPresent === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiChangeSignals && !drillSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgM3Satisfied = false;
    notes.push(
      "Imported evidence shows no successful rollback in 90d, restore outside RTO, missing RTO, or evidence older than 90 days — CHG-M3 fail.",
    );
  } else if (
    (drillSignalsPresent || opts.imported.found) &&
    successOk &&
    withinRtoOk &&
    rtoDocOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgM3Satisfied = true;
  } else if (drillSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgM3Satisfied = false;
    if (opts.imported.found && !successOk) {
      notes.push("Import must show successfulRollbacksLast90Days≥1.");
    }
    if (opts.imported.found && !withinRtoOk) {
      notes.push("Import must show measuredTimeToRestoreWithinRto=true.");
    }
    if (opts.imported.found && !rtoDocOk) {
      notes.push("Import must show documentedRtoPresent=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-M3 PASS.",
      );
    }
  } else if (opts.aiChangeSignals) {
    statusHint = "not_demonstrated";
    chgM3Satisfied = null;
    notes.push(
      "AI-change signals present but no successful rollback drill/incident evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      drill: opts.drill,
      rto: opts.rto,
      success: opts.success,
      timestamps: opts.timestamps,
    },
    importedResults: opts.imported,
    summary: {
      aiChangeSignalsPresent: opts.aiChangeSignals,
      drillSignalsPresent,
      chgM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const rollbackDrillCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiChangeSignals = detectAiChangeSignals(ctx.targetPath, maxFiles);

    const drillRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRILL_RE.test(path) || DRILL_RE.test(text),
      12,
    );
    const rtoRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DRILL_RE.test(path) || DRILL_RE.test(text) || RTO_RE.test(path)) &&
        RTO_RE.test(text),
      12,
    );
    const successRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SUCCESS_RE.test(path) || SUCCESS_RE.test(text),
      12,
    );
    const timestampRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DRILL_RE.test(path) || DRILL_RE.test(text)) && TIMESTAMP_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildRollbackDrillReport({
      assessedAt: ctx.assessedAt.toISOString(),
      drill: { found: drillRefs.length > 0, refs: drillRefs },
      rto: { found: rtoRefs.length > 0, refs: rtoRefs },
      success: { found: successRefs.length > 0, refs: successRefs },
      timestamps: { found: timestampRefs.length > 0, refs: timestampRefs },
      aiChangeSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "rollback-drill-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/rollback-drill-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "rollback-drill",
          "chg-m3",
          DETECTOR_ID,
          ...(report.summary.chgM3Satisfied ? ["chg-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.drill.refs,
        ...report.signals.rto.refs,
        ...report.signals.success.refs,
        ...report.signals.timestamps.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["rollback-drill-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-M3 status=${report.summary.statusHint} drill=${report.summary.drillSignalsPresent} satisfied=${report.summary.chgM3Satisfied}; report=imports/${PLUGIN_ID}/rollback-drill-report.json`,
      nodes,
    };
  },
};
