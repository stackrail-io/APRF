/**
 * one-click-ai-rollback — CHG-R1 / repo-one-click-ai-rollback.
 *
 * Discovers single-command/one-click rollback for AI release units.
 * Import singleCommandOrActionRollbackDocumented +
 * exerciseOrRealRollbackWithinRtoLast90Days under imports/one-click-ai-rollback/
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

const PLUGIN_ID = "one-click-ai-rollback";
const RELATED = ["CHG-R1"] as const;
const DETECTOR_ID = "repo-one-click-ai-rollback";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_RELEASE_RE =
  /(prompt|model|llm|ai[\s_-]*release|tool[\s_-]*catalog|deploy|canary)/i;

const ONE_CLICK_RE =
  /\b(one[\s_-]*click[\s_-]*rollback|single[\s_-]*command[\s_-]*rollback|one[\s_-]*command[\s_-]*rollback|rollback[\s_-]*ai[\s_-]*release|ai[\s_-]*release[\s_-]*unit[\s_-]*rollback)\b/i;

const SCRIPT_RE =
  /\b(rollback\.sh|rollback\.py|rollback\.ts|make\s+rollback|npm\s+run\s+rollback|gh\s+workflow\s+run\s+.*rollback)\b/i;

const EXERCISE_RE =
  /\b(rollback[\s_-]*exercise|exercise[\s_-]*rollback|rollback[\s_-]*drill|real[\s_-]*rollback|within[\s_-]*rto)\b/i;

export interface OneClickAiRollbackReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    oneClick: { found: boolean; refs: string[] };
    script: { found: boolean; refs: string[] };
    exercise: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    singleCommandOrActionRollbackDocumented: boolean | null;
    exerciseOrRealRollbackWithinRtoLast90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiReleaseSignalsPresent: boolean;
    oneClickSignalsPresent: boolean;
    chgR1Satisfied: boolean | null;
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
      ".sh",
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

function detectAiReleaseSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_RELEASE_RE.test(path) ||
        /\b(ai[\s_-]*release|model[\s_-]*pin|prompt[\s_-]*release)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): OneClickAiRollbackReport["importedResults"] {
  const sources: string[] = [];
  let singleCommandOrActionRollbackDocumented: boolean | null = null;
  let exerciseOrRealRollbackWithinRtoLast90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/one-click-ai-rollback-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      singleCommandOrActionRollbackDocumented =
        asBool(data.singleCommandOrActionRollbackDocumented) ??
        asBool(data.single_command_or_action_rollback_documented) ??
        asBool(data.oneClickRollbackDocumented) ??
        singleCommandOrActionRollbackDocumented;
      exerciseOrRealRollbackWithinRtoLast90Days =
        asBool(data.exerciseOrRealRollbackWithinRtoLast90Days) ??
        asBool(data.exercise_or_real_rollback_within_rto_last_90_days) ??
        asBool(data.exerciseWithinRto) ??
        exerciseOrRealRollbackWithinRtoLast90Days;

      if (asBool(data.hasSingleRollbackCommand) === true) {
        singleCommandOrActionRollbackDocumented = true;
      }
      if (asBool(data.lastExerciseWithinRto) === true) {
        exerciseOrRealRollbackWithinRtoLast90Days = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    singleCommandOrActionRollbackDocumented,
    exerciseOrRealRollbackWithinRtoLast90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildOneClickAiRollbackReport(opts: {
  assessedAt: string;
  oneClick: { found: boolean; refs: string[] };
  script: { found: boolean; refs: string[] };
  exercise: { found: boolean; refs: string[] };
  aiReleaseSignals: boolean;
  imported: OneClickAiRollbackReport["importedResults"];
}): OneClickAiRollbackReport {
  const notes: string[] = [];
  const oneClickSignalsPresent =
    opts.oneClick.found || opts.script.found || opts.exercise.found;

  if (!opts.aiReleaseSignals && !oneClickSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI-release/one-click-rollback signals — CHG-R1 may be NOT_APPLICABLE if no AI release units ship.",
    );
  }
  if (opts.oneClick.found) {
    notes.push(`One-click refs: ${opts.oneClick.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.script.found) {
    notes.push(`Script refs: ${opts.script.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.exercise.found) {
    notes.push(`Exercise refs: ${opts.exercise.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (singleAction=${opts.imported.singleCommandOrActionRollbackDocumented}, exercise=${opts.imported.exerciseOrRealRollbackWithinRtoLast90Days})`,
    );
  } else if (oneClickSignalsPresent) {
    notes.push(
      "One-click signals alone are PARTIAL — import singleCommandOrActionRollbackDocumented=true + exerciseOrRealRollbackWithinRtoLast90Days=true (measuredAt ≤90d) under imports/one-click-ai-rollback/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const singleOk =
    opts.imported.singleCommandOrActionRollbackDocumented === true;
  const exerciseOk =
    opts.imported.exerciseOrRealRollbackWithinRtoLast90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: OneClickAiRollbackReport["summary"]["statusHint"] =
    "not_demonstrated";
  let chgR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.singleCommandOrActionRollbackDocumented === false ||
      opts.imported.exerciseOrRealRollbackWithinRtoLast90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiReleaseSignals && !oneClickSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing single-action rollback, exercise outside RTO/90d, or evidence older than 90 days — CHG-R1 fail.",
    );
  } else if (
    (oneClickSignalsPresent || opts.imported.found) &&
    singleOk &&
    exerciseOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgR1Satisfied = true;
  } else if (oneClickSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgR1Satisfied = false;
    if (opts.imported.found && !singleOk) {
      notes.push(
        "Import must show singleCommandOrActionRollbackDocumented=true.",
      );
    }
    if (opts.imported.found && !exerciseOk) {
      notes.push(
        "Import must show exerciseOrRealRollbackWithinRtoLast90Days=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-R1 PASS.",
      );
    }
  } else if (opts.aiReleaseSignals) {
    statusHint = "not_demonstrated";
    chgR1Satisfied = null;
    notes.push(
      "AI-release signals present but no one-click/single-command rollback evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      oneClick: opts.oneClick,
      script: opts.script,
      exercise: opts.exercise,
    },
    importedResults: opts.imported,
    summary: {
      aiReleaseSignalsPresent: opts.aiReleaseSignals,
      oneClickSignalsPresent,
      chgR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const oneClickAiRollbackCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiReleaseSignals = detectAiReleaseSignals(ctx.targetPath, maxFiles);

    const oneClickRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ONE_CLICK_RE.test(path) || ONE_CLICK_RE.test(text),
      12,
    );
    const scriptRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCRIPT_RE.test(path) || SCRIPT_RE.test(text),
      12,
    );
    const exerciseRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EXERCISE_RE.test(path) || EXERCISE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildOneClickAiRollbackReport({
      assessedAt: ctx.assessedAt.toISOString(),
      oneClick: { found: oneClickRefs.length > 0, refs: oneClickRefs },
      script: { found: scriptRefs.length > 0, refs: scriptRefs },
      exercise: { found: exerciseRefs.length > 0, refs: exerciseRefs },
      aiReleaseSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "one-click-ai-rollback-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/one-click-ai-rollback-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "one-click-ai-rollback",
          "chg-r1",
          DETECTOR_ID,
          ...(report.summary.chgR1Satisfied ? ["chg-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.oneClick.refs,
        ...report.signals.script.refs,
        ...report.signals.exercise.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["one-click-ai-rollback-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-R1 status=${report.summary.statusHint} oneClick=${report.summary.oneClickSignalsPresent} satisfied=${report.summary.chgR1Satisfied}; report=imports/${PLUGIN_ID}/one-click-ai-rollback-report.json`,
      nodes,
    };
  },
};
