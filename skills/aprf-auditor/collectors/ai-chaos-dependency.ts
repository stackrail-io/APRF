/**
 * ai-chaos-dependency — REL-R5 / repo-chaos-tests.
 *
 * Discovers AI-dependency chaos plans + after-action signals.
 * Import chaosPlanCoversAiDependencies +
 * aiDependencyChaosExerciseCompletedWithin180Days +
 * afterActionRetainedWithActions under imports/ai-chaos-dependency/
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

const PLUGIN_ID = "ai-chaos-dependency";
const RELATED = ["REL-R5"] as const;
const DETECTOR_ID = "repo-chaos-tests";
const IMPORT_MAX_AGE_DAYS = 90;

const CHAOS_RE =
  /\b(chaos|litmus|chaosmesh|chaos[_-]?eng|game[_-]?day|failure[_-]?inject|fault[_-]?inject)\b/i;

const AI_DEP_RE =
  /\b(ai[_-]?dependenc|provider[_-]?(outage|fail|loss)|model[_-]?(outage|fail|unavailable)|tool[_-]?(outage|fail)|gateway[_-]?(outage|fail)|openai|anthropic|bedrock|llm[_-]?fail)\b/i;

const AFTER_ACTION_RE =
  /\b(after[_-]?action|post[_-]?mortem|retro(spective)?|retained[_-]?action|action[_-]?item|chaos[_-]?(report|result))\b/i;

export interface AiChaosDependencyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    chaos: { found: boolean; refs: string[] };
    aiDependency: { found: boolean; refs: string[] };
    afterAction: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    chaosPlanCoversAiDependencies: boolean | null;
    aiDependencyChaosExerciseCompletedWithin180Days: boolean | null;
    afterActionRetainedWithActions: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    chaosSignalsPresent: boolean;
    relR5Satisfied: boolean | null;
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
): AiChaosDependencyReport["importedResults"] {
  const sources: string[] = [];
  let chaosPlanCoversAiDependencies: boolean | null = null;
  let aiDependencyChaosExerciseCompletedWithin180Days: boolean | null = null;
  let afterActionRetainedWithActions: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-chaos-dependency-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      chaosPlanCoversAiDependencies =
        asBool(data.chaosPlanCoversAiDependencies) ??
        asBool(data.chaos_plan_covers_ai_dependencies) ??
        asBool(data.aiDependencyModesCovered) ??
        chaosPlanCoversAiDependencies;
      aiDependencyChaosExerciseCompletedWithin180Days =
        asBool(data.aiDependencyChaosExerciseCompletedWithin180Days) ??
        asBool(data.ai_dependency_chaos_exercise_completed_within_180_days) ??
        asBool(data.chaosExerciseWithin180Days) ??
        asBool(data.exerciseCompleted) ??
        aiDependencyChaosExerciseCompletedWithin180Days;
      afterActionRetainedWithActions =
        asBool(data.afterActionRetainedWithActions) ??
        asBool(data.after_action_retained_with_actions) ??
        asBool(data.actionsRetained) ??
        afterActionRetainedWithActions;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    chaosPlanCoversAiDependencies,
    aiDependencyChaosExerciseCompletedWithin180Days,
    afterActionRetainedWithActions,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiChaosDependencyReport(opts: {
  assessedAt: string;
  chaos: { found: boolean; refs: string[] };
  aiDependency: { found: boolean; refs: string[] };
  afterAction: { found: boolean; refs: string[] };
  imported: AiChaosDependencyReport["importedResults"];
}): AiChaosDependencyReport {
  const notes: string[] = [];
  const chaosSignalsPresent =
    opts.chaos.found || opts.aiDependency.found || opts.afterAction.found;

  if (!chaosSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI-dependency chaos signals — REL-R5 may be NOT_APPLICABLE if there are no production AI dependencies.",
    );
  }
  if (opts.chaos.found) {
    notes.push(`Chaos refs: ${opts.chaos.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.aiDependency.found) {
    notes.push(
      `AI-dependency refs: ${opts.aiDependency.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.afterAction.found) {
    notes.push(
      `After-action refs: ${opts.afterAction.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (plan=${opts.imported.chaosPlanCoversAiDependencies}, exercise180d=${opts.imported.aiDependencyChaosExerciseCompletedWithin180Days}, actions=${opts.imported.afterActionRetainedWithActions})`,
    );
  } else if (chaosSignalsPresent) {
    notes.push(
      "Chaos signals alone are PARTIAL — import chaosPlanCoversAiDependencies=true + aiDependencyChaosExerciseCompletedWithin180Days=true + afterActionRetainedWithActions=true (measuredAt ≤90d) under imports/ai-chaos-dependency/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const planOk = opts.imported.chaosPlanCoversAiDependencies === true;
  const exerciseOk =
    opts.imported.aiDependencyChaosExerciseCompletedWithin180Days === true;
  const actionsOk = opts.imported.afterActionRetainedWithActions === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiChaosDependencyReport["summary"]["statusHint"];
  let relR5Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.chaosPlanCoversAiDependencies === false ||
      opts.imported.aiDependencyChaosExerciseCompletedWithin180Days ===
        false ||
      opts.imported.afterActionRetainedWithActions === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!chaosSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR5Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR5Satisfied = false;
    notes.push(
      "Imported evidence shows missing AI-dependency chaos plan, exercise older than 180 days / absent, missing after-action actions, or attest older than 90 days — REL-R5 fail.",
    );
  } else if (
    (chaosSignalsPresent || opts.imported.found) &&
    planOk &&
    exerciseOk &&
    actionsOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR5Satisfied = true;
  } else if (chaosSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR5Satisfied = false;
    if (opts.imported.found && !planOk) {
      notes.push("Import must show chaosPlanCoversAiDependencies=true.");
    }
    if (opts.imported.found && !exerciseOk) {
      notes.push(
        "Import must show aiDependencyChaosExerciseCompletedWithin180Days=true.",
      );
    }
    if (opts.imported.found && !actionsOk) {
      notes.push("Import must show afterActionRetainedWithActions=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R5 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relR5Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      chaos: opts.chaos,
      aiDependency: opts.aiDependency,
      afterAction: opts.afterAction,
    },
    importedResults: opts.imported,
    summary: {
      chaosSignalsPresent,
      relR5Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiChaosDependencyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const chaosRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CHAOS_RE.test(path) || CHAOS_RE.test(text),
      10,
    );
    const aiDepRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AI_DEP_RE.test(path) ||
        (AI_DEP_RE.test(text) && CHAOS_RE.test(path + text)),
      8,
    );
    const afterActionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AFTER_ACTION_RE.test(path) ||
        (AFTER_ACTION_RE.test(text) &&
          (CHAOS_RE.test(path + text) || AI_DEP_RE.test(path + text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiChaosDependencyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      chaos: { found: chaosRefs.length > 0, refs: chaosRefs },
      aiDependency: { found: aiDepRefs.length > 0, refs: aiDepRefs },
      afterAction: {
        found: afterActionRefs.length > 0,
        refs: afterActionRefs,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-chaos-dependency-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-chaos-dependency-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-chaos-dependency",
          "rel-r5",
          DETECTOR_ID,
          ...(report.summary.relR5Satisfied ? ["rel-r5-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.chaos.refs,
        ...report.signals.aiDependency.refs,
        ...report.signals.afterAction.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-chaos-dependency-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R5 status=${report.summary.statusHint} signals=${report.summary.chaosSignalsPresent} satisfied=${report.summary.relR5Satisfied}; report=imports/${PLUGIN_ID}/ai-chaos-dependency-report.json`,
      nodes,
    };
  },
};
