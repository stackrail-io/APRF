/**
 * ai-control-testing — CMP-R1 / repo-ai-control-testing.
 *
 * Discovers control-testing schedules and exceptions registers. Import cycle
 * results under imports/ai-control-testing/ to unlock PASS.
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

const PLUGIN_ID = "ai-control-testing";
const RELATED = ["CMP-R1"] as const;
const DETECTOR_ID = "repo-ai-control-testing";
const CYCLE_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(control[\s_-]*test|test[\s_-]*schedule|exceptions?[\s_-]*register|control[\s_-]*assurance|compliance[\s_-]*test)/i;

const SCHEDULE_RE =
  /\b(control[\s_-]*test(?:ing)?[\s_-]*schedule|testing[\s_-]*schedule|control[\s_-]*assurance[\s_-]*calendar|recurring[\s_-]*control[\s_-]*test)\b/i;

const RESULTS_RE =
  /\b(control[\s_-]*test[\s_-]*result|test[\s_-]*results?[\s_-]*pack|last[\s_-]*test[\s_-]*cycle|controls?[\s_-]*tested)\b/i;

const EXCEPTIONS_RE =
  /\b(exceptions?[\s_-]*register|open[\s_-]*exception|compensating[\s_-]*control|waiver[\s_-]*register)\b/i;

export interface AiControlTestingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    schedule: { found: boolean; refs: string[] };
    results: { found: boolean; refs: string[] };
    exceptions: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    testedOnSchedule: boolean | null;
    controlsDueCount: number | null;
    controlsMissedCount: number | null;
    openExceptionsIncomplete: number | null;
    cycleAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    testingSignalsPresent: boolean;
    cmpR1Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".txt",
      ".csv",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function exceptionIncomplete(row: Record<string, unknown>): boolean {
  const owner = row.owner || row.ownerId || row.owner_id;
  const expiry = row.expiry || row.expiresAt || row.expiryDate || row.expires_at;
  const compensating =
    row.compensatingControl ||
    row.compensating_control ||
    row.compensating ||
    row.mitigation;
  return !owner || !expiry || !compensating;
}

function loadImported(
  ctx: CollectorContext,
): AiControlTestingReport["importedResults"] {
  const sources: string[] = [];
  let testedOnSchedule: boolean | null = null;
  let controlsDueCount: number | null = null;
  let controlsMissedCount: number | null = null;
  let openExceptionsIncomplete: number | null = null;
  let cycleAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-control-testing-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      testedOnSchedule =
        asBool(data.testedOnSchedule) ??
        asBool(data.onSchedule) ??
        testedOnSchedule;
      controlsDueCount =
        asNum(data.controlsDueCount) ??
        asNum(data.controlsDue) ??
        controlsDueCount;
      controlsMissedCount =
        asNum(data.controlsMissedCount) ??
        asNum(data.missedControls) ??
        controlsMissedCount;
      openExceptionsIncomplete =
        asNum(data.openExceptionsIncomplete) ??
        asNum(data.incompleteExceptions) ??
        openExceptionsIncomplete;
      cycleAgeDays =
        asNum(data.cycleAgeDays) ??
        asNum(data.lastTestCycleAgeDays) ??
        asNum(data.cycle_age_days) ??
        cycleAgeDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const exceptions =
        (data.openExceptions as unknown[]) ||
        (data.exceptions as unknown[]) ||
        [];
      if (Array.isArray(exceptions) && exceptions.length > 0) {
        let incomplete = 0;
        for (const e of exceptions) {
          if (!e || typeof e !== "object") continue;
          if (exceptionIncomplete(e as Record<string, unknown>)) incomplete += 1;
        }
        openExceptionsIncomplete = openExceptionsIncomplete ?? incomplete;
      }

      if (
        testedOnSchedule == null &&
        controlsDueCount !== null &&
        controlsMissedCount !== null
      ) {
        testedOnSchedule =
          controlsDueCount >= 0 && controlsMissedCount === 0;
      }

      if (asBool(data.cmpR1Complete) === true) {
        testedOnSchedule = testedOnSchedule ?? true;
        controlsMissedCount = controlsMissedCount ?? 0;
        openExceptionsIncomplete = openExceptionsIncomplete ?? 0;
        cycleAgeDays = cycleAgeDays ?? 0;
        controlsDueCount = controlsDueCount ?? 1;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    testedOnSchedule,
    controlsDueCount,
    controlsMissedCount,
    openExceptionsIncomplete,
    cycleAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiControlTestingReport(opts: {
  assessedAt: string;
  signals: AiControlTestingReport["signals"];
  complianceSignals: boolean;
  imported: AiControlTestingReport["importedResults"];
}): AiControlTestingReport {
  const notes: string[] = [];
  const testingSignalsPresent =
    opts.signals.schedule.found ||
    opts.signals.results.found ||
    opts.signals.exceptions.found;

  if (
    !opts.complianceSignals &&
    !testingSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No control-testing signals — CMP-R1 may be NOT_APPLICABLE if no production AI/compliance controls are on a testing schedule.",
    );
  }
  if (opts.signals.schedule.found) {
    notes.push(
      `Schedule refs: ${opts.signals.schedule.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (onSchedule=${opts.imported.testedOnSchedule}, due=${opts.imported.controlsDueCount}, missed=${opts.imported.controlsMissedCount}, incompleteExc=${opts.imported.openExceptionsIncomplete}, cycleAgeDays=${opts.imported.cycleAgeDays})`,
    );
  } else if (testingSignalsPresent) {
    notes.push(
      "Testing signals alone are PARTIAL — import on-schedule cycle results + complete exceptions (measuredAt ≤90d) under imports/ai-control-testing/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= CYCLE_MAX_AGE_DAYS;
  const cycleOk =
    opts.imported.cycleAgeDays === null ||
    opts.imported.cycleAgeDays <= CYCLE_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    CYCLE_MAX_AGE_DAYS,
  );
  const scheduleOk = opts.imported.testedOnSchedule === true;
  const exceptionsOk = opts.imported.openExceptionsIncomplete === 0;
  const passOk =
    scheduleOk && exceptionsOk && cycleOk && ageOk && importFresh;

  let statusHint: AiControlTestingReport["summary"]["statusHint"];
  let cmpR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.testedOnSchedule === false ||
      (opts.imported.controlsMissedCount !== null &&
        opts.imported.controlsMissedCount > 0) ||
      (opts.imported.openExceptionsIncomplete !== null &&
        opts.imported.openExceptionsIncomplete > 0) ||
      (opts.imported.cycleAgeDays !== null &&
        opts.imported.cycleAgeDays > CYCLE_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > CYCLE_MAX_AGE_DAYS));

  if (
    !opts.complianceSignals &&
    !testingSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpR1Satisfied = false;
    notes.push(
      "Imported evidence shows missed controls, incomplete exceptions, stale cycle (>90 days), or evidence older than 90 days — CMP-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpR1Satisfied = true;
  } else if (testingSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpR1Satisfied = false;
    if (opts.imported.found) {
      if (!scheduleOk) {
        notes.push(
          "Import must show testedOnSchedule=true (or controlsMissedCount=0 for due controls).",
        );
      }
      if (!exceptionsOk) {
        notes.push(
          "Import must show openExceptionsIncomplete=0 (every open exception has owner, expiry, compensating control).",
        );
      }
      if (!cycleOk) {
        notes.push(
          `Import must show cycleAgeDays≤${CYCLE_MAX_AGE_DAYS}.`,
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-R1 PASS.",
        );
      }
    }
  } else if (opts.complianceSignals) {
    statusHint = "not_demonstrated";
    cmpR1Satisfied = null;
    notes.push(
      "Compliance signals present but no control-testing schedule/results/exceptions found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      testingSignalsPresent,
      cmpR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiControlTestingCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const complianceSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      SCHEDULE_RE.test(text) ||
      EXCEPTIONS_RE.test(text);

    const scheduleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SCHEDULE_RE.test(path) || SCHEDULE_RE.test(text)) &&
        inCtx(path, text),
    );
    const resultsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RESULTS_RE.test(path) || RESULTS_RE.test(text)) && inCtx(path, text),
      12,
    );
    const exceptionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (EXCEPTIONS_RE.test(path) || EXCEPTIONS_RE.test(text)) &&
        inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiControlTestingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        schedule: { found: scheduleRefs.length > 0, refs: scheduleRefs },
        results: { found: resultsRefs.length > 0, refs: resultsRefs },
        exceptions: { found: exceptionRefs.length > 0, refs: exceptionRefs },
      },
      complianceSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-control-testing-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-control-testing-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-control-testing",
          "cmp-r1",
          DETECTOR_ID,
          ...(report.summary.testingSignalsPresent
            ? ["testing-signals"]
            : []),
          ...(report.summary.cmpR1Satisfied ? ["cmp-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...scheduleRefs.slice(0, 2),
        ...resultsRefs.slice(0, 1),
        ...exceptionRefs.slice(0, 1),
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
        signals: ["ai-control-testing-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-R1 status=${report.summary.statusHint} testing=${report.summary.testingSignalsPresent} satisfied=${report.summary.cmpR1Satisfied}; report=imports/${PLUGIN_ID}/ai-control-testing-report.json`,
      nodes,
    };
  },
};
