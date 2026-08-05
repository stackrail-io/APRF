/**
 * platform-inner-loop-evals — DX-R2 / repo-inner-loop-evals detector executor.
 *
 * Discovers local/one-command AI eval runners. Import pre-PR sample or waiver
 * (≤30 days) under imports/platform-inner-loop-evals/ to unlock PASS.
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

const PLUGIN_ID = "platform-inner-loop-evals";
const RELATED = ["DX-R2"] as const;
const DETECTOR_ID = "repo-inner-loop-evals";
/** Spec: sampled AI PR ≤30 days. */
const SAMPLE_MAX_AGE_DAYS = 30;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|genai|promptfoo|eval)/i;

const RUNNER_RE =
  /\b(promptfoo|eval[\s_-]*(local|dev|inner|core|subset|runner)|inner[\s_-]*loop|make[\s_-]*eval|npm[\s_-]*run[\s_-]*eval|pnpm[\s_-]*eval|yarn[\s_-]*eval)\b/i;

const ONE_CMD_RE =
  /\b(npm\s+run\s+eval|pnpm\s+(run\s+)?eval|yarn\s+eval|make\s+eval|npx\s+promptfoo|promptfoo\s+eval|one[\s_-]*command|single[\s_-]*command)\b/i;

const DOCS_RE =
  /\b(local[\s_-]*eval|run[\s_-]*evals?[\s_-]*(locally|before[\s_-]*pr)|pre[\s_-]*pr[\s_-]*eval|inner[\s_-]*loop)\b/i;

export interface PlatformInnerLoopEvalsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  runner: { found: boolean; refs: string[] };
  oneCommand: { found: boolean; refs: string[] };
  docs: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    runnerPresent: boolean | null;
    oneCommandCapable: boolean | null;
    prePrEvalEvidence: boolean | null;
    waiverDocumented: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    runnerPresent: boolean;
    oneCommandCapable: boolean;
    dxR2Satisfied: boolean | null;
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
      ".sh",
      ".ts",
      ".js",
      ".py",
    ],
  });
  const named = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
  }).filter((f) => {
    const r = rel(targetPath, f);
    return /Makefile|makefile|package\.json/i.test(r);
  });
  const all = [...new Set([...files, ...named])];
  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
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
        /\b(promptfoo|ChatCompletion|openai|anthropic|bedrock|llm[\s_-]*eval)\b/i.test(
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
): PlatformInnerLoopEvalsReport["importedResults"] {
  const sources: string[] = [];
  let runnerPresent: boolean | null = null;
  let oneCommandCapable: boolean | null = null;
  let prePrEvalEvidence: boolean | null = null;
  let waiverDocumented: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-inner-loop-evals-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      runnerPresent =
        asBool(data.runnerPresent) ??
        asBool(data.hasRunner) ??
        asBool(data.localRunnerPresent) ??
        runnerPresent;
      oneCommandCapable =
        asBool(data.oneCommandCapable) ??
        asBool(data.oneCommand) ??
        asBool(data.hasOneCommand) ??
        oneCommandCapable;
      prePrEvalEvidence =
        asBool(data.prePrEvalEvidence) ??
        asBool(data.prePrEval) ??
        asBool(data.sampledPrHasEval) ??
        prePrEvalEvidence;
      waiverDocumented =
        asBool(data.waiverDocumented) ??
        asBool(data.hasWaiver) ??
        asBool(data.waiver) ??
        waiverDocumented;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    runnerPresent,
    oneCommandCapable,
    prePrEvalEvidence,
    waiverDocumented,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformInnerLoopEvalsReport(opts: {
  assessedAt: string;
  runner: PlatformInnerLoopEvalsReport["runner"];
  oneCommand: PlatformInnerLoopEvalsReport["oneCommand"];
  docs: PlatformInnerLoopEvalsReport["docs"];
  aiSignals: boolean;
  imported: PlatformInnerLoopEvalsReport["importedResults"];
}): PlatformInnerLoopEvalsReport {
  const notes: string[] = [];
  const runnerPresent =
    opts.runner.found ||
    opts.docs.found ||
    opts.imported.runnerPresent === true;
  const oneCommandCapable =
    opts.oneCommand.found || opts.imported.oneCommandCapable === true;

  if (!opts.aiSignals && !runnerPresent && !opts.imported.found) {
    notes.push(
      "No AI/inner-loop eval signals — DX-R2 may be NOT_APPLICABLE if there is no AI eval surface.",
    );
  }
  if (opts.runner.found) {
    notes.push(`Runner refs: ${opts.runner.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No local/inner-loop eval runner signals found.");
  }
  if (opts.oneCommand.found) {
    notes.push(
      `One-command refs: ${opts.oneCommand.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No one-command eval entrypoint signals found.");
  }
  if (opts.docs.found) {
    notes.push(`Docs refs: ${opts.docs.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (runner=${opts.imported.runnerPresent}, oneCmd=${opts.imported.oneCommandCapable}, prePr=${opts.imported.prePrEvalEvidence}, waiver=${opts.imported.waiverDocumented}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (runnerPresent || oneCommandCapable) {
    notes.push(
      "Runner signals alone are PARTIAL — import runnerPresent + oneCommandCapable + (prePrEvalEvidence|waiverDocumented) ≤30d under imports/platform-inner-loop-evals/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= SAMPLE_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    SAMPLE_MAX_AGE_DAYS,
  );
  const sampleOk =
    opts.imported.prePrEvalEvidence === true ||
    opts.imported.waiverDocumented === true;
  const passOk =
    opts.imported.runnerPresent === true &&
    opts.imported.oneCommandCapable === true &&
    sampleOk &&
    ageOk &&
    importFresh;

  let statusHint: PlatformInnerLoopEvalsReport["summary"]["statusHint"];
  let dxR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.runnerPresent === false ||
      opts.imported.oneCommandCapable === false ||
      (opts.imported.prePrEvalEvidence === false &&
        opts.imported.waiverDocumented === false) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > SAMPLE_MAX_AGE_DAYS));

  if (
    !opts.aiSignals &&
    !opts.runner.found &&
    !opts.oneCommand.found &&
    !opts.docs.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dxR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxR2Satisfied = false;
    notes.push(
      "Imported results show missing runner/one-command/sample or evidence older than 30 days — DX-R2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxR2Satisfied = true;
  } else if (
    opts.runner.found ||
    opts.oneCommand.found ||
    opts.docs.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dxR2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.runnerPresent !== true) {
        notes.push("Import must show runnerPresent=true.");
      }
      if (opts.imported.oneCommandCapable !== true) {
        notes.push("Import must show oneCommandCapable=true.");
      }
      if (!sampleOk) {
        notes.push(
          "Import must show prePrEvalEvidence=true or waiverDocumented=true with ageDays ≤30.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤30 days) — required to unlock DX-R2 PASS.",
        );
      }
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    dxR2Satisfied = null;
    notes.push(
      "AI signals present but no local/inner-loop eval runner found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    runner: opts.runner,
    oneCommand: opts.oneCommand,
    docs: opts.docs,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      runnerPresent,
      oneCommandCapable,
      dxR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformInnerLoopEvalsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const inEvalContext = (path: string, text: string) =>
      AI_PATH_RE.test(path) ||
      /eval|promptfoo|Makefile|package\.json/i.test(path) ||
      RUNNER_RE.test(text) ||
      DOCS_RE.test(text);

    const runnerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RUNNER_RE.test(path) || RUNNER_RE.test(text)) &&
        inEvalContext(path, text),
    );
    const oneCmdRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ONE_CMD_RE.test(path) || ONE_CMD_RE.test(text)) &&
        inEvalContext(path, text),
    );
    const docsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DOCS_RE.test(path) || DOCS_RE.test(text)) &&
        (/\.md$/i.test(path) || DOCS_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPlatformInnerLoopEvalsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      runner: { found: runnerRefs.length > 0, refs: runnerRefs },
      oneCommand: { found: oneCmdRefs.length > 0, refs: oneCmdRefs },
      docs: { found: docsRefs.length > 0, refs: docsRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-inner-loop-evals-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/platform-inner-loop-evals-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-inner-loop-evals",
          "dx-r2",
          DETECTOR_ID,
          ...(report.summary.runnerPresent ? ["inner-loop-runner"] : []),
          ...(report.summary.dxR2Satisfied ? ["dx-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...runnerRefs.slice(0, 2),
        ...oneCmdRefs.slice(0, 2),
        ...docsRefs.slice(0, 2),
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
        signals: ["platform-inner-loop-evals-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-R2 status=${report.summary.statusHint} runner=${report.summary.runnerPresent} satisfied=${report.summary.dxR2Satisfied}; report=imports/${PLUGIN_ID}/platform-inner-loop-evals-report.json`,
      nodes,
    };
  },
};
