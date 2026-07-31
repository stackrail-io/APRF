/**
 * eval-suite-ci — EVL-M1 / repo-eval-suite-present.
 *
 * Discovers versioned offline eval suites + CI triggers on relevant changes.
 * Import criticalJourneysMissingSuite=0 +
 * relevantChangesMissingTriggerOrWaiver=0 under imports/eval-suite-ci/ to PASS.
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

const PLUGIN_ID = "eval-suite-ci";
const RELATED = ["EVL-M1"] as const;
const DETECTOR_ID = "repo-eval-suite-present";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const EVAL_PATH_RE =
  /(eval|evals|promptfoo|golden|benchmark|journey|redteam)/i;

const SUITE_RE =
  /\b(eval[\s_-]*(suite|config|harness|registry)|promptfoo|offline[\s_-]*eval|golden[\s_-]*(set|suite)|journey[\s_-]*eval)\b/i;

const CI_TRIGGER_RE =
  /\b(workflow_dispatch|pull_request|push:|on:[\s\S]{0,80}(prompt|model|eval)|eval[\s_-]*(job|gate|ci)|promptfoo[\s_-]*eval)\b/i;

const JOURNEY_RE =
  /\b(critical[\s_-]*journey|journey[\s_-]*(id|map|registry)|customer[\s_-]*journey)\b/i;

export interface EvalSuiteCiReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    suites: { found: boolean; refs: string[] };
    ciTriggers: { found: boolean; refs: string[] };
    journeyMaps: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    criticalJourneysMissingSuite: number | null;
    relevantChangesMissingTriggerOrWaiver: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    evalSignalsPresent: boolean;
    suiteSignalsPresent: boolean;
    evlM1Satisfied: boolean | null;
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

function detectEvalSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        EVAL_PATH_RE.test(path) ||
        /\b(promptfoo|openai|anthropic|llm|ChatCompletion)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalSuiteCiReport["importedResults"] {
  const sources: string[] = [];
  let criticalJourneysMissingSuite: number | null = null;
  let relevantChangesMissingTriggerOrWaiver: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-suite-ci-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      criticalJourneysMissingSuite =
        asNum(data.criticalJourneysMissingSuite) ??
        asNum(data.critical_journeys_missing_suite) ??
        asNum(data.journeysMissingSuite) ??
        criticalJourneysMissingSuite;
      relevantChangesMissingTriggerOrWaiver =
        asNum(data.relevantChangesMissingTriggerOrWaiver) ??
        asNum(data.relevant_changes_missing_trigger_or_waiver) ??
        asNum(data.changesMissingTriggerOrWaiver) ??
        relevantChangesMissingTriggerOrWaiver;

      if (
        asBool(data.coversAllCriticalJourneys) === true &&
        criticalJourneysMissingSuite === null
      ) {
        criticalJourneysMissingSuite = 0;
      }
      if (
        asBool(data.allRelevantChangesCovered) === true &&
        relevantChangesMissingTriggerOrWaiver === null
      ) {
        relevantChangesMissingTriggerOrWaiver = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    criticalJourneysMissingSuite,
    relevantChangesMissingTriggerOrWaiver,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalSuiteCiReport(opts: {
  assessedAt: string;
  suites: { found: boolean; refs: string[] };
  ciTriggers: { found: boolean; refs: string[] };
  journeyMaps: { found: boolean; refs: string[] };
  evalSignals: boolean;
  imported: EvalSuiteCiReport["importedResults"];
}): EvalSuiteCiReport {
  const notes: string[] = [];
  const suiteSignalsPresent = opts.suites.found;

  if (!opts.evalSignals && !suiteSignalsPresent && !opts.imported.found) {
    notes.push(
      "No eval/AI signals — EVL-M1 may be NOT_APPLICABLE if there are no critical AI customer journeys.",
    );
  }
  if (suiteSignalsPresent) {
    notes.push(`Suite refs: ${opts.suites.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No versioned offline eval suite signals found.");
  }
  if (opts.journeyMaps.found) {
    notes.push(
      `Journey-map refs: ${opts.journeyMaps.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.ciTriggers.found) {
    notes.push(`CI-trigger refs: ${opts.ciTriggers.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingSuites=${opts.imported.criticalJourneysMissingSuite}, missingTriggers=${opts.imported.relevantChangesMissingTriggerOrWaiver})`,
    );
  } else if (suiteSignalsPresent) {
    notes.push(
      "Suite signals alone are PARTIAL — import criticalJourneysMissingSuite=0 and relevantChangesMissingTriggerOrWaiver=0 (measuredAt ≤90d) under imports/eval-suite-ci/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const suiteCoverageOk =
    opts.imported.criticalJourneysMissingSuite !== null &&
    opts.imported.criticalJourneysMissingSuite === 0;
  const changeCoverageOk =
    opts.imported.relevantChangesMissingTriggerOrWaiver !== null &&
    opts.imported.relevantChangesMissingTriggerOrWaiver === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalSuiteCiReport["summary"]["statusHint"] =
    "not_demonstrated";
  let evlM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.criticalJourneysMissingSuite !== null &&
      opts.imported.criticalJourneysMissingSuite > 0) ||
      (opts.imported.relevantChangesMissingTriggerOrWaiver !== null &&
        opts.imported.relevantChangesMissingTriggerOrWaiver > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.evalSignals && !suiteSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    evlM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    evlM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing critical-journey suites, uncovered relevant changes, or evidence older than 90 days — EVL-M1 fail.",
    );
  } else if (
    (suiteSignalsPresent || opts.imported.found) &&
    suiteCoverageOk &&
    changeCoverageOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlM1Satisfied = true;
  } else if (
    suiteSignalsPresent ||
    opts.ciTriggers.found ||
    opts.journeyMaps.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    evlM1Satisfied = false;
    if (opts.imported.found && !suiteCoverageOk) {
      notes.push("Import must show criticalJourneysMissingSuite=0.");
    }
    if (opts.imported.found && !changeCoverageOk) {
      notes.push("Import must show relevantChangesMissingTriggerOrWaiver=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-M1 PASS.",
      );
    }
  } else if (opts.evalSignals) {
    statusHint = "not_demonstrated";
    evlM1Satisfied = null;
    notes.push(
      "Eval/AI signals present but no offline eval suite or CI trigger evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      suites: opts.suites,
      ciTriggers: opts.ciTriggers,
      journeyMaps: opts.journeyMaps,
    },
    importedResults: opts.imported,
    summary: {
      evalSignalsPresent: opts.evalSignals,
      suiteSignalsPresent,
      evlM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalSuiteCiCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const evalSignals = detectEvalSignals(ctx.targetPath, maxFiles);

    const suiteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!SUITE_RE.test(path) && !SUITE_RE.test(text)) return false;
        return (
          EVAL_PATH_RE.test(path) ||
          EVAL_PATH_RE.test(text) ||
          SUITE_RE.test(path)
        );
      },
    );
    const journeyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (EVAL_PATH_RE.test(path) || SUITE_RE.test(text)) &&
        JOURNEY_RE.test(text),
      12,
    );
    const ciRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(\.github\/workflows|cicd|gitlab-ci|azure-pipelines|Jenkinsfile)/i.test(
          path,
        ) &&
        (SUITE_RE.test(text) || EVAL_PATH_RE.test(text) || CI_TRIGGER_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEvalSuiteCiReport({
      assessedAt: ctx.assessedAt.toISOString(),
      suites: { found: suiteRefs.length > 0, refs: suiteRefs },
      ciTriggers: { found: ciRefs.length > 0, refs: ciRefs },
      journeyMaps: { found: journeyRefs.length > 0, refs: journeyRefs },
      evalSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-suite-ci-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/eval-suite-ci-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-suite-ci",
          "evl-m1",
          DETECTOR_ID,
          ...(report.summary.evlM1Satisfied ? ["evl-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.suites.refs,
        ...report.signals.ciTriggers.refs,
        ...report.signals.journeyMaps.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-suite-ci-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-M1 status=${report.summary.statusHint} suites=${report.summary.suiteSignalsPresent} satisfied=${report.summary.evlM1Satisfied}; report=imports/${PLUGIN_ID}/eval-suite-ci-report.json`,
      nodes,
    };
  },
};
