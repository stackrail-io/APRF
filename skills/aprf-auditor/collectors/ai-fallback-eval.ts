/**
 * ai-fallback-eval — REL-R2 / repo-ai-fallback-eval.
 *
 * Discovers multi-provider/multi-region fallback + exercise + quality/safety eval.
 * Import fallbackPathConfigured + fallbackExercisedWithin90Days +
 * fallbackEvalMeetsQualitySafetyBars under imports/ai-fallback-eval/
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

const PLUGIN_ID = "ai-fallback-eval";
const RELATED = ["REL-R2"] as const;
const DETECTOR_ID = "repo-ai-fallback-eval";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const FALLBACK_RE =
  /\b(multi[_-]?(provider|region|az)|fallback[_-]?(provider|model|region|path)|secondary[_-]?(provider|model|region)|alternate[_-]?(provider|model|region)|cross[_-]?region[_-]?(llm|model|ai|failover))\b/i;

const EXERCISE_RE =
  /\b(fallback[_-]?(test|drill|exercise|switch)|exercised[_-]?fallback|provider[_-]?failover[_-]?test|region[_-]?failover[_-]?(test|drill))\b/i;

const EVAL_RE =
  /\b(fallback[_-]?eval|primary[_-]?vs[_-]?fallback|quality[_-]?(bar|gate|score)|safety[_-]?(bar|gate|score)|eval[_-]?(report|suite).*fallback|fallback.*(promptfoo|eval))\b/i;

export interface AiFallbackEvalReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    fallback: { found: boolean; refs: string[] };
    exercise: { found: boolean; refs: string[] };
    eval: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    fallbackPathConfigured: boolean | null;
    fallbackExercisedWithin90Days: boolean | null;
    fallbackEvalMeetsQualitySafetyBars: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    fallbackSignalsPresent: boolean;
    relR2Satisfied: boolean | null;
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
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".ts",
      ".js",
      ".py",
      ".pdf",
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

function loadImported(
  ctx: CollectorContext,
): AiFallbackEvalReport["importedResults"] {
  const sources: string[] = [];
  let fallbackPathConfigured: boolean | null = null;
  let fallbackExercisedWithin90Days: boolean | null = null;
  let fallbackEvalMeetsQualitySafetyBars: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-fallback-eval-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      fallbackPathConfigured =
        asBool(data.fallbackPathConfigured) ??
        asBool(data.fallback_path_configured) ??
        asBool(data.multiProviderOrRegionFallbackConfigured) ??
        asBool(data.fallbackConfigured) ??
        fallbackPathConfigured;
      fallbackExercisedWithin90Days =
        asBool(data.fallbackExercisedWithin90Days) ??
        asBool(data.fallback_exercised_within_90_days) ??
        asBool(data.fallbackExercised) ??
        asBool(data.fallbackPathExercised) ??
        fallbackExercisedWithin90Days;
      fallbackEvalMeetsQualitySafetyBars =
        asBool(data.fallbackEvalMeetsQualitySafetyBars) ??
        asBool(data.fallback_eval_meets_quality_safety_bars) ??
        asBool(data.fallbackEvalMeetsBars) ??
        asBool(data.primaryVsFallbackEvalPassed) ??
        fallbackEvalMeetsQualitySafetyBars;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    fallbackPathConfigured,
    fallbackExercisedWithin90Days,
    fallbackEvalMeetsQualitySafetyBars,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiFallbackEvalReport(opts: {
  assessedAt: string;
  fallback: { found: boolean; refs: string[] };
  exercise: { found: boolean; refs: string[] };
  eval: { found: boolean; refs: string[] };
  imported: AiFallbackEvalReport["importedResults"];
}): AiFallbackEvalReport {
  const notes: string[] = [];
  const fallbackSignalsPresent =
    opts.fallback.found || opts.exercise.found || opts.eval.found;

  if (!fallbackSignalsPresent && !opts.imported.found) {
    notes.push(
      "No multi-provider/multi-region fallback-eval signals — REL-R2 may be NOT_APPLICABLE if no production AI fallback paths are in scope.",
    );
  }
  if (opts.fallback.found) {
    notes.push(`Fallback refs: ${opts.fallback.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.exercise.found) {
    notes.push(`Exercise refs: ${opts.exercise.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.eval.found) {
    notes.push(`Eval refs: ${opts.eval.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (configured=${opts.imported.fallbackPathConfigured}, exercised=${opts.imported.fallbackExercisedWithin90Days}, evalBars=${opts.imported.fallbackEvalMeetsQualitySafetyBars})`,
    );
  } else if (fallbackSignalsPresent) {
    notes.push(
      "Fallback signals alone are PARTIAL — import fallbackPathConfigured=true + fallbackExercisedWithin90Days=true + fallbackEvalMeetsQualitySafetyBars=true (measuredAt ≤90d) under imports/ai-fallback-eval/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const configuredOk = opts.imported.fallbackPathConfigured === true;
  const exercisedOk = opts.imported.fallbackExercisedWithin90Days === true;
  const evalOk = opts.imported.fallbackEvalMeetsQualitySafetyBars === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiFallbackEvalReport["summary"]["statusHint"];
  let relR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.fallbackPathConfigured === false ||
      opts.imported.fallbackExercisedWithin90Days === false ||
      opts.imported.fallbackEvalMeetsQualitySafetyBars === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!fallbackSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing fallback config, exercise ≤90 days, quality/safety eval bars, or attest older than 90 days — REL-R2 fail.",
    );
  } else if (
    (fallbackSignalsPresent || opts.imported.found) &&
    configuredOk &&
    exercisedOk &&
    evalOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR2Satisfied = true;
  } else if (fallbackSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR2Satisfied = false;
    if (opts.imported.found && !configuredOk) {
      notes.push("Import must show fallbackPathConfigured=true.");
    }
    if (opts.imported.found && !exercisedOk) {
      notes.push("Import must show fallbackExercisedWithin90Days=true.");
    }
    if (opts.imported.found && !evalOk) {
      notes.push("Import must show fallbackEvalMeetsQualitySafetyBars=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      fallback: opts.fallback,
      exercise: opts.exercise,
      eval: opts.eval,
    },
    importedResults: opts.imported,
    summary: {
      fallbackSignalsPresent,
      relR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiFallbackEvalCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const fallbackRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FALLBACK_RE.test(path) || FALLBACK_RE.test(text),
      10,
    );
    const exerciseRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        EXERCISE_RE.test(path) ||
        (/(test|spec|e2e|drill|report)/i.test(path) && EXERCISE_RE.test(text)),
      8,
    );
    const evalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        EVAL_RE.test(path) ||
        (/(eval|promptfoo|quality|safety)/i.test(path) &&
          (EVAL_RE.test(text) || FALLBACK_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiFallbackEvalReport({
      assessedAt: ctx.assessedAt.toISOString(),
      fallback: { found: fallbackRefs.length > 0, refs: fallbackRefs },
      exercise: { found: exerciseRefs.length > 0, refs: exerciseRefs },
      eval: { found: evalRefs.length > 0, refs: evalRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-fallback-eval-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-fallback-eval-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-fallback-eval",
          "rel-r2",
          DETECTOR_ID,
          ...(report.summary.relR2Satisfied ? ["rel-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.fallback.refs,
        ...report.signals.exercise.refs,
        ...report.signals.eval.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-fallback-eval-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R2 status=${report.summary.statusHint} signals=${report.summary.fallbackSignalsPresent} satisfied=${report.summary.relR2Satisfied}; report=imports/${PLUGIN_ID}/ai-fallback-eval-report.json`,
      nodes,
    };
  },
};
