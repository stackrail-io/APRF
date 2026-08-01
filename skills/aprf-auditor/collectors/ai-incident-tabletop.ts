/**
 * ai-incident-tabletop — INC-R4 / repo-ai-incident-tabletop.
 *
 * Discovers AI-focused incident tabletops + after-action reports.
 * Import aiFocusedTabletopCompletedWithin180Days +
 * retainedActionsWithOwners under imports/ai-incident-tabletop/
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

const PLUGIN_ID = "ai-incident-tabletop";
const RELATED = ["INC-R4"] as const;
const DETECTOR_ID = "repo-ai-incident-tabletop";
const IMPORT_MAX_AGE_DAYS = 90;
const TABLETOP_MAX_AGE_DAYS = 180;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const TABLETOP_RE =
  /\b(table[\s_-]*top|tabletop|war[\s_-]*game|game[\s_-]*day|scenario[\s_-]*exercise)\b/i;

const AI_SCENARIO_RE =
  /\b(ai[\s_-]*incident|prompt[\s_-]*injection|model[\s_-]*outage|agent[\s_-]*abuse|data[\s_-]*leakage|jailbreak|llm[\s_-]*incident)\b/i;

const AFTER_ACTION_RE =
  /\b(after[\s_-]*action|aar|retained[\s_-]*action|action[\s_-]*item|follow[\s_-]*up|owner)\b/i;

export interface AiIncidentTabletopReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    tabletop: { found: boolean; refs: string[] };
    afterAction: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    aiFocusedTabletopCompletedWithin180Days: boolean | null;
    tabletopAgeDays: number | null;
    retainedActionsWithOwners: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    tabletopSignalsPresent: boolean;
    incR4Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".html", ".pptx"],
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
): AiIncidentTabletopReport["importedResults"] {
  const sources: string[] = [];
  let aiFocusedTabletopCompletedWithin180Days: boolean | null = null;
  let tabletopAgeDays: number | null = null;
  let retainedActionsWithOwners: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-incident-tabletop-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      tabletopAgeDays =
        asNum(data.tabletopAgeDays) ??
        asNum(data.tabletop_age_days) ??
        tabletopAgeDays;
      aiFocusedTabletopCompletedWithin180Days =
        asBool(data.aiFocusedTabletopCompletedWithin180Days) ??
        asBool(data.ai_focused_tabletop_completed_within_180_days) ??
        asBool(data.tabletopCompleted) ??
        aiFocusedTabletopCompletedWithin180Days;
      retainedActionsWithOwners =
        asBool(data.retainedActionsWithOwners) ??
        asBool(data.retained_actions_with_owners) ??
        asBool(data.actionsHaveOwners) ??
        retainedActionsWithOwners;

      if (tabletopAgeDays !== null) {
        aiFocusedTabletopCompletedWithin180Days =
          aiFocusedTabletopCompletedWithin180Days ??
          tabletopAgeDays <= TABLETOP_MAX_AGE_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    aiFocusedTabletopCompletedWithin180Days,
    tabletopAgeDays,
    retainedActionsWithOwners,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiIncidentTabletopReport(opts: {
  assessedAt: string;
  tabletop: { found: boolean; refs: string[] };
  afterAction: { found: boolean; refs: string[] };
  imported: AiIncidentTabletopReport["importedResults"];
}): AiIncidentTabletopReport {
  const notes: string[] = [];
  const tabletopSignalsPresent =
    opts.tabletop.found || opts.afterAction.found;

  if (!tabletopSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI tabletop signals — INC-R4 may be NOT_APPLICABLE if no production AI system is in scope.",
    );
  }
  if (opts.tabletop.found) {
    notes.push(`Tabletop refs: ${opts.tabletop.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.afterAction.found) {
    notes.push(
      `After-action refs: ${opts.afterAction.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (completed180d=${opts.imported.aiFocusedTabletopCompletedWithin180Days}, age=${opts.imported.tabletopAgeDays}, actionsOwned=${opts.imported.retainedActionsWithOwners})`,
    );
  } else if (tabletopSignalsPresent) {
    notes.push(
      "Tabletop signals alone are PARTIAL — import aiFocusedTabletopCompletedWithin180Days=true + retainedActionsWithOwners=true (measuredAt ≤90d) under imports/ai-incident-tabletop/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const completedOk =
    opts.imported.aiFocusedTabletopCompletedWithin180Days === true ||
    (opts.imported.tabletopAgeDays !== null &&
      opts.imported.tabletopAgeDays <= TABLETOP_MAX_AGE_DAYS);
  const actionsOk = opts.imported.retainedActionsWithOwners === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiIncidentTabletopReport["summary"]["statusHint"] ;
  let incR4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.aiFocusedTabletopCompletedWithin180Days === false ||
      (typeof opts.imported.tabletopAgeDays === "number" &&
        opts.imported.tabletopAgeDays > TABLETOP_MAX_AGE_DAYS) ||
      opts.imported.retainedActionsWithOwners === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!tabletopSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incR4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incR4Satisfied = false;
    notes.push(
      "Imported evidence shows missing/stale AI tabletop (>180d), actions without owners, or evidence older than 90 days — INC-R4 fail.",
    );
  } else if (
    (tabletopSignalsPresent || opts.imported.found) &&
    completedOk &&
    actionsOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incR4Satisfied = true;
  } else if (tabletopSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incR4Satisfied = false;
    if (opts.imported.found && !completedOk) {
      notes.push(
        "Import must show aiFocusedTabletopCompletedWithin180Days=true (or tabletopAgeDays≤180).",
      );
    }
    if (opts.imported.found && !actionsOk) {
      notes.push("Import must show retainedActionsWithOwners=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-R4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      tabletop: opts.tabletop,
      afterAction: opts.afterAction,
    },
    importedResults: opts.imported,
    summary: {
      tabletopSignalsPresent,
      incR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiIncidentTabletopCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const tabletop = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TABLETOP_RE.test(path) || TABLETOP_RE.test(text)) &&
        (AI_SCENARIO_RE.test(path) ||
          AI_SCENARIO_RE.test(text) ||
          /ai|llm|agent|prompt/i.test(path + text)),
      10,
    );
    const afterAction = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AFTER_ACTION_RE.test(path) ||
        ((TABLETOP_RE.test(path) || TABLETOP_RE.test(text)) &&
          AFTER_ACTION_RE.test(text)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiIncidentTabletopReport({
      assessedAt: ctx.assessedAt.toISOString(),
      tabletop: { found: tabletop.length > 0, refs: tabletop },
      afterAction: { found: afterAction.length > 0, refs: afterAction },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-incident-tabletop-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-incident-tabletop-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-incident-tabletop",
          "inc-r4",
          DETECTOR_ID,
          ...(report.summary.incR4Satisfied ? ["inc-r4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.tabletop.refs,
        ...report.signals.afterAction.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-incident-tabletop-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-R4 status=${report.summary.statusHint} tabletop=${report.summary.tabletopSignalsPresent} satisfied=${report.summary.incR4Satisfied}; report=imports/${PLUGIN_ID}/ai-incident-tabletop-report.json`,
      nodes,
    };
  },
};
