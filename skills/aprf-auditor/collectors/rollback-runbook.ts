/**
 * rollback-runbook — CHG-M2 / repo-rollback-runbook.
 *
 * Discovers rollback runbooks (commands/UI + owners) and on-call drills.
 * Import runbookHasCommandsAndOwners + onCallWalkthroughOrDrillCompleted under
 * imports/rollback-runbook/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "rollback-runbook";
const RELATED = ["CHG-M2"] as const;
const DETECTOR_ID = "repo-rollback-runbook";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_CHANGE_RE =
  /(prompt|model|llm|deploy|release|rollback|canary|feature[\s_-]*flag)/i;

const RUNBOOK_RE =
  /\b(rollback[\s_-]*runbook|runbook[\s_-]*rollback|revert[\s_-]*procedure|rollback[\s_-]*procedure|how[\s_-]*to[\s_-]*rollback)\b/i;

const STEPS_RE =
  /\b(exact[\s_-]*(commands?|steps?)|ui[\s_-]*steps?|kubectl|aws\s+cli|gh\s+workflow|click|dashboard[\s_-]*step)\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|on[\s_-]*call|pager|raci|runbook[\s_-]*owner)\b/i;

const DRILL_RE =
  /\b(walkthrough|on[\s_-]*call[\s_-]*drill|drill[\s_-]*checklist|time[\s_-]*to[\s_-]*execute|game[\s_-]*day|tabletop)\b/i;

export interface RollbackRunbookReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    runbook: { found: boolean; refs: string[] };
    steps: { found: boolean; refs: string[] };
    owners: { found: boolean; refs: string[] };
    drill: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    runbookHasCommandsAndOwners: boolean | null;
    onCallWalkthroughOrDrillCompleted: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiChangeSignalsPresent: boolean;
    runbookSignalsPresent: boolean;
    chgM2Satisfied: boolean | null;
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
): RollbackRunbookReport["importedResults"] {
  const sources: string[] = [];
  let runbookHasCommandsAndOwners: boolean | null = null;
  let onCallWalkthroughOrDrillCompleted: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/rollback-runbook-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      runbookHasCommandsAndOwners =
        asBool(data.runbookHasCommandsAndOwners) ??
        asBool(data.runbook_has_commands_and_owners) ??
        asBool(data.runbookComplete) ??
        runbookHasCommandsAndOwners;
      onCallWalkthroughOrDrillCompleted =
        asBool(data.onCallWalkthroughOrDrillCompleted) ??
        asBool(data.on_call_walkthrough_or_drill_completed) ??
        asBool(data.drillCompleted) ??
        onCallWalkthroughOrDrillCompleted;

      const drillCount =
        asNum(data.onCallDrillCountLast90Days) ??
        asNum(data.on_call_drill_count_last_90_days);
      if (drillCount !== null) {
        onCallWalkthroughOrDrillCompleted =
          onCallWalkthroughOrDrillCompleted ?? drillCount >= 1;
      }
      if (
        asBool(data.hasExactCommandsOrUiSteps) === true &&
        asBool(data.hasNamedOwners) === true
      ) {
        runbookHasCommandsAndOwners = true;
      }
      if (asBool(data.timeToExecuteRecorded) === true && drillCount === null) {
        // Affirmative time recording with walkthrough flag.
        if (asBool(data.walkthroughCompleted) === true) {
          onCallWalkthroughOrDrillCompleted = true;
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    runbookHasCommandsAndOwners,
    onCallWalkthroughOrDrillCompleted,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildRollbackRunbookReport(opts: {
  assessedAt: string;
  runbook: { found: boolean; refs: string[] };
  steps: { found: boolean; refs: string[] };
  owners: { found: boolean; refs: string[] };
  drill: { found: boolean; refs: string[] };
  aiChangeSignals: boolean;
  imported: RollbackRunbookReport["importedResults"];
}): RollbackRunbookReport {
  const notes: string[] = [];
  const runbookSignalsPresent =
    opts.runbook.found ||
    opts.steps.found ||
    opts.owners.found ||
    opts.drill.found;

  if (!opts.aiChangeSignals && !runbookSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI-change/rollback signals — CHG-M2 may be NOT_APPLICABLE if no production AI changes need rollback.",
    );
  }
  if (opts.runbook.found) {
    notes.push(`Runbook refs: ${opts.runbook.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.steps.found) {
    notes.push(`Steps refs: ${opts.steps.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.owners.found) {
    notes.push(`Owner refs: ${opts.owners.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.drill.found) {
    notes.push(`Drill refs: ${opts.drill.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (runbook=${opts.imported.runbookHasCommandsAndOwners}, drill=${opts.imported.onCallWalkthroughOrDrillCompleted})`,
    );
  } else if (runbookSignalsPresent) {
    notes.push(
      "Runbook signals alone are PARTIAL — import runbookHasCommandsAndOwners=true + onCallWalkthroughOrDrillCompleted=true (measuredAt ≤90d) under imports/rollback-runbook/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const runbookOk = opts.imported.runbookHasCommandsAndOwners === true;
  const drillOk = opts.imported.onCallWalkthroughOrDrillCompleted === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: RollbackRunbookReport["summary"]["statusHint"] =
    "not_demonstrated";
  let chgM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.runbookHasCommandsAndOwners === false ||
      opts.imported.onCallWalkthroughOrDrillCompleted === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiChangeSignals && !runbookSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgM2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete runbook, missing on-call drill, or evidence older than 90 days — CHG-M2 fail.",
    );
  } else if (
    (runbookSignalsPresent || opts.imported.found) &&
    runbookOk &&
    drillOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgM2Satisfied = true;
  } else if (runbookSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgM2Satisfied = false;
    if (opts.imported.found && !runbookOk) {
      notes.push("Import must show runbookHasCommandsAndOwners=true.");
    }
    if (opts.imported.found && !drillOk) {
      notes.push("Import must show onCallWalkthroughOrDrillCompleted=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-M2 PASS.",
      );
    }
  } else if (opts.aiChangeSignals) {
    statusHint = "not_demonstrated";
    chgM2Satisfied = null;
    notes.push(
      "AI-change signals present but no rollback runbook/on-call drill evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      runbook: opts.runbook,
      steps: opts.steps,
      owners: opts.owners,
      drill: opts.drill,
    },
    importedResults: opts.imported,
    summary: {
      aiChangeSignalsPresent: opts.aiChangeSignals,
      runbookSignalsPresent,
      chgM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const rollbackRunbookCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiChangeSignals = detectAiChangeSignals(ctx.targetPath, maxFiles);

    const runbookRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RUNBOOK_RE.test(path) || RUNBOOK_RE.test(text),
      12,
    );
    const stepsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RUNBOOK_RE.test(path) || RUNBOOK_RE.test(text)) && STEPS_RE.test(text),
      12,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RUNBOOK_RE.test(path) || RUNBOOK_RE.test(text)) && OWNER_RE.test(text),
      12,
    );
    const drillRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRILL_RE.test(path) || DRILL_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildRollbackRunbookReport({
      assessedAt: ctx.assessedAt.toISOString(),
      runbook: { found: runbookRefs.length > 0, refs: runbookRefs },
      steps: { found: stepsRefs.length > 0, refs: stepsRefs },
      owners: { found: ownerRefs.length > 0, refs: ownerRefs },
      drill: { found: drillRefs.length > 0, refs: drillRefs },
      aiChangeSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "rollback-runbook-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/rollback-runbook-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "rollback-runbook",
          "chg-m2",
          DETECTOR_ID,
          ...(report.summary.chgM2Satisfied ? ["chg-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.runbook.refs,
        ...report.signals.steps.refs,
        ...report.signals.owners.refs,
        ...report.signals.drill.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["rollback-runbook-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-M2 status=${report.summary.statusHint} runbook=${report.summary.runbookSignalsPresent} satisfied=${report.summary.chgM2Satisfied}; report=imports/${PLUGIN_ID}/rollback-runbook-report.json`,
      nodes,
    };
  },
};
