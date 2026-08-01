/**
 * context-compaction-evals — CTX-R2 / repo-context-compaction-evals.
 *
 * Discovers compaction/summarization critical-fact evals.
 * Import retentionMeetsThreshold + regressionsBlockRelease + lastRunAgeDays≤90
 * under imports/context-compaction-evals/ to unlock PASS.
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

const PLUGIN_ID = "context-compaction-evals";
const RELATED = ["CTX-R2"] as const;
const DETECTOR_ID = "repo-context-compaction-evals";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CTX_PATH_RE =
  /(context|prompt|rag|summar|compact|memorr?y|eval|golden)/i;

const COMPACTION_RE =
  /\b(summar(?:y|ize|isation|ization)|compact(?:ion|or)?|condens|fold[\s_-]*histor|context[\s_-]*compress)\b/i;

const FACT_EVAL_RE =
  /\b(critical[\s_-]*fact|fact[\s_-]*retention|information[\s_-]*loss|retention[\s_-]*(rate|threshold|eval)|compaction[\s_-]*eval)\b/i;

const GATE_RE =
  /\b(block[\s_-]*(merge|release|deploy)|ci[\s_-]*gate|fail[\s_-]*the[\s_-]*build|regression[\s_-]*gate|required[\s_-]*check)\b/i;

export interface ContextCompactionEvalsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    compaction: { found: boolean; refs: string[] };
    factEvals: { found: boolean; refs: string[] };
    releaseGates: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    retentionMeetsThreshold: boolean | null;
    regressionsBlockRelease: boolean | null;
    lastRunAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    compactionSignalsPresent: boolean;
    evalSignalsPresent: boolean;
    ctxR2Satisfied: boolean | null;
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

function detectCompactionSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        COMPACTION_RE.test(path) ||
        COMPACTION_RE.test(text) ||
        CTX_PATH_RE.test(path),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextCompactionEvalsReport["importedResults"] {
  const sources: string[] = [];
  let retentionMeetsThreshold: boolean | null = null;
  let regressionsBlockRelease: boolean | null = null;
  let lastRunAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-compaction-evals-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastRunAgeDays =
        asNum(data.lastRunAgeDays) ??
        asNum(data.last_run_age_days) ??
        asNum(data.runAgeDays) ??
        lastRunAgeDays;
      retentionMeetsThreshold =
        asBool(data.retentionMeetsThreshold) ??
        asBool(data.retention_meets_threshold) ??
        retentionMeetsThreshold;
      regressionsBlockRelease =
        asBool(data.regressionsBlockRelease) ??
        asBool(data.regressions_block_release) ??
        asBool(data.blocksRelease) ??
        regressionsBlockRelease;

      const retentionPct = asNum(data.criticalFactRetentionPct);
      const thresholdPct = asNum(data.retentionThresholdPct);
      if (
        retentionPct !== null &&
        thresholdPct !== null &&
        retentionMeetsThreshold === null
      ) {
        retentionMeetsThreshold = retentionPct >= thresholdPct;
      }
      if (asBool(data.passed) === true && retentionMeetsThreshold === null) {
        retentionMeetsThreshold = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    retentionMeetsThreshold,
    regressionsBlockRelease,
    lastRunAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextCompactionEvalsReport(opts: {
  assessedAt: string;
  compaction: { found: boolean; refs: string[] };
  factEvals: { found: boolean; refs: string[] };
  releaseGates: { found: boolean; refs: string[] };
  compactionSignals: boolean;
  imported: ContextCompactionEvalsReport["importedResults"];
}): ContextCompactionEvalsReport {
  const notes: string[] = [];
  const evalSignalsPresent = opts.factEvals.found || opts.releaseGates.found;

  if (
    !opts.compactionSignals &&
    !opts.compaction.found &&
    !evalSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No compaction/summarization signals — CTX-R2 may be NOT_APPLICABLE if context is never compacted.",
    );
  }
  if (opts.compaction.found) {
    notes.push(
      `Compaction refs: ${opts.compaction.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.factEvals.found) {
    notes.push(`Fact-eval refs: ${opts.factEvals.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No critical-fact retention eval signals found.");
  }
  if (opts.releaseGates.found) {
    notes.push(
      `Release-gate refs: ${opts.releaseGates.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (retentionOk=${opts.imported.retentionMeetsThreshold}, gate=${opts.imported.regressionsBlockRelease}, lastRunAge=${opts.imported.lastRunAgeDays})`,
    );
  } else if (evalSignalsPresent || opts.compaction.found) {
    notes.push(
      "Compaction/eval signals alone are PARTIAL — import retentionMeetsThreshold + regressionsBlockRelease + lastRunAgeDays≤90 (measuredAt ≤90d) under imports/context-compaction-evals/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const runFresh =
    opts.imported.lastRunAgeDays !== null &&
    opts.imported.lastRunAgeDays <= IMPORT_MAX_AGE_DAYS;
  const retentionOk = opts.imported.retentionMeetsThreshold === true;
  const gateOk = opts.imported.regressionsBlockRelease === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextCompactionEvalsReport["summary"]["statusHint"];
  let ctxR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.retentionMeetsThreshold === false ||
      opts.imported.regressionsBlockRelease === false ||
      (opts.imported.lastRunAgeDays !== null &&
        opts.imported.lastRunAgeDays > IMPORT_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.compactionSignals &&
    !opts.compaction.found &&
    !evalSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    ctxR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxR2Satisfied = false;
    notes.push(
      "Imported evidence shows retention below threshold, no release gate, stale run, or evidence older than 90 days — CTX-R2 fail.",
    );
  } else if (
    (evalSignalsPresent || opts.compaction.found || opts.imported.found) &&
    retentionOk &&
    gateOk &&
    runFresh &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxR2Satisfied = true;
  } else if (
    opts.compaction.found ||
    evalSignalsPresent ||
    opts.imported.found
  ) {
    statusHint = "partial";
    ctxR2Satisfied = false;
    if (opts.imported.found && !retentionOk) {
      notes.push("Import must show retentionMeetsThreshold=true.");
    }
    if (opts.imported.found && !gateOk) {
      notes.push("Import must show regressionsBlockRelease=true.");
    }
    if (opts.imported.found && !runFresh) {
      notes.push("Import must show lastRunAgeDays≤90.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-R2 PASS.",
      );
    }
  } else if (opts.compactionSignals) {
    statusHint = "not_demonstrated";
    ctxR2Satisfied = null;
    notes.push(
      "Compaction signals present but no critical-fact eval or release-gate evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      compaction: opts.compaction,
      factEvals: opts.factEvals,
      releaseGates: opts.releaseGates,
    },
    importedResults: opts.imported,
    summary: {
      compactionSignalsPresent: opts.compactionSignals || opts.compaction.found,
      evalSignalsPresent,
      ctxR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextCompactionEvalsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const compactionSignals = detectCompactionSignals(ctx.targetPath, maxFiles);

    const compactionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => COMPACTION_RE.test(path) || COMPACTION_RE.test(text),
    );
    const factEvalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!FACT_EVAL_RE.test(path) && !FACT_EVAL_RE.test(text)) return false;
        return (
          COMPACTION_RE.test(path) ||
          COMPACTION_RE.test(text) ||
          CTX_PATH_RE.test(path) ||
          FACT_EVAL_RE.test(path)
        );
      },
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (/(test|spec|ci|workflow|eval)/i.test(path) || GATE_RE.test(text)) &&
        (COMPACTION_RE.test(text) || FACT_EVAL_RE.test(text)) &&
        GATE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildContextCompactionEvalsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      compaction: { found: compactionRefs.length > 0, refs: compactionRefs },
      factEvals: { found: factEvalRefs.length > 0, refs: factEvalRefs },
      releaseGates: { found: gateRefs.length > 0, refs: gateRefs },
      compactionSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-compaction-evals-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/context-compaction-evals-report.json`,
        signals: [
          "context-compaction-evals",
          "ctx-r2",
          DETECTOR_ID,
          ...(report.summary.ctxR2Satisfied ? ["ctx-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.factEvals.refs,
        ...report.signals.compaction.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        signals: ["context-compaction-evals-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-R2 status=${report.summary.statusHint} evals=${report.summary.evalSignalsPresent} satisfied=${report.summary.ctxR2Satisfied}; report=imports/${PLUGIN_ID}/context-compaction-evals-report.json`,
      nodes,
    };
  },
};
