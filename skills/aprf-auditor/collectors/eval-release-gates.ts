/**
 * eval-release-gates — EVL-M2 / repo-eval-release-gates.
 *
 * Discovers numeric quality+safety release gates that block deploy.
 * Import journeysMissingQualityMetric=0 + journeysMissingSafetyMetric=0 +
 * failingGateBlocksDeploy under imports/eval-release-gates/ to unlock PASS.
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "eval-release-gates";
const RELATED = ["EVL-M2"] as const;
const DETECTOR_ID = "repo-eval-release-gates";
const IMPORT_MAX_AGE_DAYS = 90;

const EVAL_PATH_RE =
  /(eval|evals|promptfoo|gate|threshold|quality|safety|journey)/i;

const THRESHOLD_RE =
  /\b(threshold|min[_-]?score|pass[_-]?rate|quality[\s_-]*(metric|gate|threshold)|safety[\s_-]*(metric|gate|threshold)|numeric[\s_-]*threshold)\b/i;

const GATE_RE =
  /\b(release[\s_-]*gate|deploy[\s_-]*gate|eval[\s_-]*gate|required[\s_-]*check|block[\s_-]*(deploy|merge|release)|fail[\s_-]*the[\s_-]*build)\b/i;

const QUALITY_RE =
  /\b(quality|accuracy|relevance|grounding|task[\s_-]*success|bleu|rouge|pass[@_-]?k)\b/i;

const SAFETY_RE =
  /\b(safety|refusal|toxicity|jailbreak|harm|policy[\s_-]*violat|unsafe)\b/i;

export interface EvalReleaseGatesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    thresholds: { found: boolean; refs: string[] };
    gates: { found: boolean; refs: string[] };
    quality: { found: boolean; refs: string[] };
    safety: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    journeysMissingQualityMetric: number | null;
    journeysMissingSafetyMetric: number | null;
    failingGateBlocksDeploy: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    evalSignalsPresent: boolean;
    gateSignalsPresent: boolean;
    evlM2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
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

function detectEvalSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        EVAL_PATH_RE.test(path) ||
        /\b(promptfoo|openai|anthropic|llm|eval[\s_-]*suite)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalReleaseGatesReport["importedResults"] {
  const sources: string[] = [];
  let journeysMissingQualityMetric: number | null = null;
  let journeysMissingSafetyMetric: number | null = null;
  let failingGateBlocksDeploy: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-release-gates-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      journeysMissingQualityMetric =
        asNum(data.journeysMissingQualityMetric) ??
        asNum(data.journeys_missing_quality_metric) ??
        journeysMissingQualityMetric;
      journeysMissingSafetyMetric =
        asNum(data.journeysMissingSafetyMetric) ??
        asNum(data.journeys_missing_safety_metric) ??
        journeysMissingSafetyMetric;
      failingGateBlocksDeploy =
        asBool(data.failingGateBlocksDeploy) ??
        asBool(data.failing_gate_blocks_deploy) ??
        asBool(data.blocksDeploy) ??
        failingGateBlocksDeploy;

      if (
        asBool(data.coversAllCriticalJourneys) === true &&
        journeysMissingQualityMetric === null &&
        journeysMissingSafetyMetric === null
      ) {
        journeysMissingQualityMetric = 0;
        journeysMissingSafetyMetric = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    journeysMissingQualityMetric,
    journeysMissingSafetyMetric,
    failingGateBlocksDeploy,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalReleaseGatesReport(opts: {
  assessedAt: string;
  thresholds: { found: boolean; refs: string[] };
  gates: { found: boolean; refs: string[] };
  quality: { found: boolean; refs: string[] };
  safety: { found: boolean; refs: string[] };
  evalSignals: boolean;
  imported: EvalReleaseGatesReport["importedResults"];
}): EvalReleaseGatesReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.thresholds.found || opts.gates.found || opts.quality.found || opts.safety.found;

  if (!opts.evalSignals && !gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No eval/gate signals — EVL-M2 may be NOT_APPLICABLE if there are no critical AI journeys.",
    );
  }
  if (opts.thresholds.found) {
    notes.push(`Threshold refs: ${opts.thresholds.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.gates.found) {
    notes.push(`Gate refs: ${opts.gates.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.quality.found) {
    notes.push(`Quality-metric refs: ${opts.quality.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No quality-metric threshold signals found.");
  }
  if (opts.safety.found) {
    notes.push(`Safety-metric refs: ${opts.safety.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No safety-metric threshold signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingQ=${opts.imported.journeysMissingQualityMetric}, missingS=${opts.imported.journeysMissingSafetyMetric}, blocks=${opts.imported.failingGateBlocksDeploy})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import journeysMissingQualityMetric=0, journeysMissingSafetyMetric=0, failingGateBlocksDeploy=true (measuredAt ≤90d) under imports/eval-release-gates/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const qualityOk =
    opts.imported.journeysMissingQualityMetric !== null &&
    opts.imported.journeysMissingQualityMetric === 0;
  const safetyOk =
    opts.imported.journeysMissingSafetyMetric !== null &&
    opts.imported.journeysMissingSafetyMetric === 0;
  const blocksOk = opts.imported.failingGateBlocksDeploy === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalReleaseGatesReport["summary"]["statusHint"];
  let evlM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.journeysMissingQualityMetric !== null &&
      opts.imported.journeysMissingQualityMetric > 0) ||
      (opts.imported.journeysMissingSafetyMetric !== null &&
        opts.imported.journeysMissingSafetyMetric > 0) ||
      opts.imported.failingGateBlocksDeploy === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.evalSignals && !gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    evlM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    evlM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing quality/safety thresholds, non-blocking gate, or evidence older than 90 days — EVL-M2 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    qualityOk &&
    safetyOk &&
    blocksOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlM2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    evlM2Satisfied = false;
    if (opts.imported.found && !qualityOk) {
      notes.push("Import must show journeysMissingQualityMetric=0.");
    }
    if (opts.imported.found && !safetyOk) {
      notes.push("Import must show journeysMissingSafetyMetric=0.");
    }
    if (opts.imported.found && !blocksOk) {
      notes.push("Import must show failingGateBlocksDeploy=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-M2 PASS.",
      );
    }
  } else if (opts.evalSignals) {
    statusHint = "not_demonstrated";
    evlM2Satisfied = null;
    notes.push(
      "Eval signals present but no numeric quality/safety release-gate evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      thresholds: opts.thresholds,
      gates: opts.gates,
      quality: opts.quality,
      safety: opts.safety,
    },
    importedResults: opts.imported,
    summary: {
      evalSignalsPresent: opts.evalSignals,
      gateSignalsPresent,
      evlM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalReleaseGatesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const evalSignals = detectEvalSignals(ctx.targetPath, maxFiles);

    const thresholdRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!THRESHOLD_RE.test(path) && !THRESHOLD_RE.test(text)) return false;
        return (
          EVAL_PATH_RE.test(path) ||
          EVAL_PATH_RE.test(text) ||
          THRESHOLD_RE.test(path)
        );
      },
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => GATE_RE.test(path) || GATE_RE.test(text),
      12,
    );
    const qualityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (THRESHOLD_RE.test(text) || GATE_RE.test(text) || EVAL_PATH_RE.test(path)) &&
        QUALITY_RE.test(text),
      12,
    );
    const safetyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (THRESHOLD_RE.test(text) || GATE_RE.test(text) || EVAL_PATH_RE.test(path)) &&
        SAFETY_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEvalReleaseGatesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      thresholds: { found: thresholdRefs.length > 0, refs: thresholdRefs },
      gates: { found: gateRefs.length > 0, refs: gateRefs },
      quality: { found: qualityRefs.length > 0, refs: qualityRefs },
      safety: { found: safetyRefs.length > 0, refs: safetyRefs },
      evalSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-release-gates-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/eval-release-gates-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-release-gates",
          "evl-m2",
          DETECTOR_ID,
          ...(report.summary.evlM2Satisfied ? ["evl-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.thresholds.refs,
        ...report.signals.gates.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-release-gates-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-M2 status=${report.summary.statusHint} gates=${report.summary.gateSignalsPresent} satisfied=${report.summary.evlM2Satisfied}; report=imports/${PLUGIN_ID}/eval-release-gates-report.json`,
      nodes,
    };
  },
};
