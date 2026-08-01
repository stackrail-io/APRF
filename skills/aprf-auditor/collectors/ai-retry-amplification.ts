/**
 * ai-retry-amplification — COST-M3 / repo-retry-amplification-config executor.
 *
 * Discovers finite retry/backoff and AI loop budgets. Import amplification
 * test results under imports/ai-retry-amplification/ to unlock PASS.
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

const PLUGIN_ID = "ai-retry-amplification";
const RELATED = ["COST-M3"] as const;
const DETECTOR_ID = "repo-retry-amplification-config";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|embedding|litellm|langchain)/i;

const RETRY_RE =
  /\b(max[_-]?retr(?:y|ies)|retry[_-]?(limit|count|attempts|policy)|num[_-]?retr(?:y|ies)|retries?\s*[:=]|tenacity|backoff|exponential[_-]?backoff)\b/i;

const LOOP_BUDGET_RE =
  /\b(max[_-]?(steps|iterations|tool[_-]?calls|turns|loops)|step[_-]?limit|iteration[_-]?limit|loop[_-]?(limit|budget)|maxIterations)\b/i;

const AMP_TEST_RE =
  /\b(amplif|retry[_-]?storm|unbounded[_-]?(cost|retry|loop)|cost[_-]?under[_-]?retry|forced[_-]?fail|bounded[_-]?(token|cost|spend))\b/i;

export interface AiRetryAmplificationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  retryConfig: { found: boolean; refs: string[] };
  loopBudgets: { found: boolean; refs: string[] };
  ampTestSignals: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    finiteRetries: boolean | null;
    finiteLoops: boolean | null;
    amplificationBounded: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    retryOrLoopPresent: boolean;
    costM3Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".tf",
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

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): AiRetryAmplificationReport["importedResults"] {
  const sources: string[] = [];
  let finiteRetries: boolean | null = null;
  let finiteLoops: boolean | null = null;
  let amplificationBounded: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-retry-amplification-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      finiteRetries =
        asBool(data.finiteRetries) ??
        asBool(data.maxRetriesFinite) ??
        asBool(data.retriesBounded) ??
        finiteRetries;
      finiteLoops =
        asBool(data.finiteLoops) ??
        asBool(data.loopBudgetFinite) ??
        asBool(data.maxLoopsFinite) ??
        finiteLoops;
      amplificationBounded =
        asBool(data.amplificationBounded) ??
        asBool(data.costBoundedUnderRetry) ??
        asBool(data.boundedCeilingHit) ??
        amplificationBounded;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const results = Array.isArray(data.results)
        ? (data.results as Array<Record<string, unknown>>)
        : Array.isArray(data.tests)
          ? (data.tests as Array<Record<string, unknown>>)
          : [];
      for (const r of results) {
        const ok =
          r.bounded === true ||
          r.ceilingHit === true ||
          r.passed === true ||
          asBool(r.amplificationBounded) === true ||
          String(r.outcome || "").toLowerCase() === "bounded";
        amplificationBounded =
          amplificationBounded === null
            ? ok
            : amplificationBounded && ok;
        if (asBool(r.finiteRetries) === true) finiteRetries = true;
        if (asBool(r.finiteLoops) === true) finiteLoops = true;
        const age = asNum(r.ageDays) ?? asNum(r.age_days);
        if (age !== null) ageDays = age;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    finiteRetries,
    finiteLoops,
    amplificationBounded,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiRetryAmplificationReport(opts: {
  assessedAt: string;
  retry: { found: boolean; refs: string[] };
  loops: { found: boolean; refs: string[] };
  ampTests: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiRetryAmplificationReport["importedResults"];
}): AiRetryAmplificationReport {
  const notes: string[] = [];
  const retryOrLoopPresent =
    opts.retry.found ||
    opts.loops.found ||
    opts.imported.finiteRetries === true ||
    opts.imported.finiteLoops === true;

  if (
    !opts.aiSignals &&
    !retryOrLoopPresent &&
    !opts.imported.found &&
    !opts.ampTests.found
  ) {
    notes.push(
      "No AI/retry-amplification signals — COST-M3 may be NOT_APPLICABLE if there are no production AI clients.",
    );
  }
  if (opts.retry.found) {
    notes.push(`Retry/backoff refs: ${opts.retry.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No finite retry/backoff config signals found.");
  }
  if (opts.loops.found) {
    notes.push(`Loop-budget refs: ${opts.loops.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.ampTests.found) {
    notes.push(`Amplification-test refs: ${opts.ampTests.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (retries=${opts.imported.finiteRetries}, loops=${opts.imported.finiteLoops}, bounded=${opts.imported.amplificationBounded}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (retryOrLoopPresent || opts.ampTests.found) {
    notes.push(
      "Retry/loop config alone is PARTIAL — import ≤90-day amplification test under imports/ai-retry-amplification/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  // Finite retries always required; loops via repo signal, import, or
  // amplification suite that attests client paths are bounded without agents.
  const configOk =
    (opts.retry.found || opts.imported.finiteRetries === true) &&
    (opts.loops.found ||
      opts.imported.finiteLoops === true ||
      opts.imported.amplificationBounded === true);
  const ampOk = opts.imported.amplificationBounded === true && ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiRetryAmplificationReport["summary"]["statusHint"];
  let costM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.amplificationBounded === false ||
      opts.imported.finiteRetries === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.retry.found &&
    !opts.loops.found &&
    !opts.ampTests.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    costM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costM3Satisfied = false;
    notes.push(
      "Imported results show unbounded amplification, missing finite retries, or evidence older than 90 days — COST-M3 fail.",
    );
  } else if (configOk && ampOk && importFresh) {
    statusHint = "pass";
    costM3Satisfied = true;
  } else if (
    opts.retry.found ||
    opts.loops.found ||
    opts.ampTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costM3Satisfied = false;
    if (opts.imported.found && !configOk) {
      notes.push(
        "Need finiteRetries (repo and/or import) plus loop budget or amplificationBounded attestation.",
      );
    }
    if (opts.imported.found && !ampOk) {
      notes.push(
        "Import must show amplificationBounded=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-M3 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costM3Satisfied = null;
    notes.push(
      "AI signals present but no retry/loop budget or amplification evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    retryConfig: opts.retry,
    loopBudgets: opts.loops,
    ampTestSignals: opts.ampTests,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      retryOrLoopPresent,
      costM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiRetryAmplificationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const retryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!RETRY_RE.test(path) && !RETRY_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          RETRY_RE.test(path)
        );
      },
    );
    const loopRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!LOOP_BUDGET_RE.test(path) && !LOOP_BUDGET_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          LOOP_BUDGET_RE.test(path)
        );
      },
    );
    const ampRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture)/i.test(path) &&
        (AMP_TEST_RE.test(text) ||
          (RETRY_RE.test(text) &&
            /\b(bound|ceiling|token|cost|spend)\b/i.test(text))),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiRetryAmplificationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      retry: { found: retryRefs.length > 0, refs: retryRefs },
      loops: { found: loopRefs.length > 0, refs: loopRefs },
      ampTests: { found: ampRefs.length > 0, refs: ampRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-retry-amplification-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-retry-amplification-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-retry-amplification",
          "cost-m3",
          DETECTOR_ID,
          ...(report.summary.retryOrLoopPresent
            ? ["retry-or-loop-budget"]
            : []),
          ...(report.summary.costM3Satisfied ? ["cost-m3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...retryRefs.slice(0, 4),
        ...loopRefs.slice(0, 2),
        ...ampRefs.slice(0, 2),
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
        signals: ["ai-retry-amplification-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-M3 status=${report.summary.statusHint} retryOrLoop=${report.summary.retryOrLoopPresent} satisfied=${report.summary.costM3Satisfied}; report=imports/${PLUGIN_ID}/ai-retry-amplification-report.json`,
      nodes,
    };
  },
};
