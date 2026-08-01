/**
 * ai-partial-tool-failure — REL-M3 / repo-ai-partial-tool-failure.
 *
 * Discovers partial tool-failure handling + outcome test evidence
 * (integration, chaos, e2e, replay, contract, simulator, or equivalent).
 * Import partialFailureHandlingConfigured +
 * testEvidenceShowsNoFalseSuccess +
 * noFalseSuccessWithoutRemediationPct=100 under
 * imports/ai-partial-tool-failure/ to unlock PASS (measuredAt ≤90d).
 * Legacy injectionTestsCoverPartialFailure /
 * noFalseSuccessWithoutCompensationPct keys still accepted.
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

const PLUGIN_ID = "ai-partial-tool-failure";
const RELATED = ["REL-M3"] as const;
const DETECTOR_ID = "repo-ai-partial-tool-failure";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const TOOL_AGENT_RE =
  /\b(tool[_-]?call|tool[_-]?result|function[_-]?call|agent|mcp|langchain|langgraph|autogen|crewai)\b/i;

const PARTIAL_FAIL_RE =
  /\b(partial[_-]?(fail|failure|success|result)|mid[_-]?(sequence|tool)|false[_-]?success|compensat|rollback|saga|tool[_-]?(error|fail|exception)|side[_-]?effect)\b/i;

const TEST_EVIDENCE_RE =
  /\b(partial[_-]?fail(ure)?[_-]?test|false[_-]?success[_-]?test|inject[_-]?(tool[_-]?)?(fail|error|partial)|force[_-]?(tool[_-]?)?(fail|error)|chaos[_-]?(test|experiment)|replay[_-]?test|contract[_-]?test|simulator|e2e|end[_-]?to[_-]?end|integration[_-]?test)\b/i;

export interface AiPartialToolFailureReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    handling: { found: boolean; refs: string[] };
    testEvidence: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    partialFailureHandlingConfigured: boolean | null;
    testEvidenceShowsNoFalseSuccess: boolean | null;
    noFalseSuccessWithoutRemediationPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    toolAgentSignalsPresent: boolean;
    handlingSignalsPresent: boolean;
    relM3Satisfied: boolean | null;
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

function detectToolAgentSignals(
  targetPath: string,
  maxFiles: number,
): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        TOOL_AGENT_RE.test(path) ||
        /\b(tool_calls|function_call|ToolMessage|execute_tool)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiPartialToolFailureReport["importedResults"] {
  const sources: string[] = [];
  let partialFailureHandlingConfigured: boolean | null = null;
  let testEvidenceShowsNoFalseSuccess: boolean | null = null;
  let noFalseSuccessWithoutRemediationPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-partial-tool-failure-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      partialFailureHandlingConfigured =
        asBool(data.partialFailureHandlingConfigured) ??
        asBool(data.partial_failure_handling_configured) ??
        asBool(data.partialFailureDetected) ??
        partialFailureHandlingConfigured;
      testEvidenceShowsNoFalseSuccess =
        asBool(data.testEvidenceShowsNoFalseSuccess) ??
        asBool(data.test_evidence_shows_no_false_success) ??
        asBool(data.injectionTestsCoverPartialFailure) ??
        asBool(data.injection_tests_cover_partial_failure) ??
        asBool(data.partialFailureInjectionTested) ??
        asBool(data.outcomeTestPassed) ??
        testEvidenceShowsNoFalseSuccess;
      noFalseSuccessWithoutRemediationPct =
        asNum(data.noFalseSuccessWithoutRemediationPct) ??
        asNum(data.no_false_success_without_remediation_pct) ??
        asNum(data.noFalseSuccessWithoutCompensationPct) ??
        asNum(data.no_false_success_without_compensation_pct) ??
        asNum(data.coveragePct) ??
        asNum(data.falseSuccessPreventedPct) ??
        noFalseSuccessWithoutRemediationPct;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    partialFailureHandlingConfigured,
    testEvidenceShowsNoFalseSuccess,
    noFalseSuccessWithoutRemediationPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiPartialToolFailureReport(opts: {
  assessedAt: string;
  handling: { found: boolean; refs: string[] };
  testEvidence: { found: boolean; refs: string[] };
  toolAgentSignals: boolean;
  imported: AiPartialToolFailureReport["importedResults"];
}): AiPartialToolFailureReport {
  const notes: string[] = [];
  const handlingSignalsPresent =
    opts.handling.found || opts.testEvidence.found;

  if (
    !opts.toolAgentSignals &&
    !handlingSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No tool/agent partial-failure signals — REL-M3 may be NOT_APPLICABLE if there are no tool-using workflows.",
    );
  }
  if (opts.handling.found) {
    notes.push(
      `Partial-failure handling refs: ${opts.handling.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.testEvidence.found) {
    notes.push(
      `Test-evidence refs: ${opts.testEvidence.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (handling=${opts.imported.partialFailureHandlingConfigured}, testEvidence=${opts.imported.testEvidenceShowsNoFalseSuccess}, noFalseSuccessPct=${opts.imported.noFalseSuccessWithoutRemediationPct})`,
    );
  } else if (handlingSignalsPresent) {
    notes.push(
      "Partial-failure signals alone are PARTIAL — import partialFailureHandlingConfigured=true + testEvidenceShowsNoFalseSuccess=true + noFalseSuccessWithoutRemediationPct=100 (measuredAt ≤90d) under imports/ai-partial-tool-failure/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const handlingOk = opts.imported.partialFailureHandlingConfigured === true;
  const testOk = opts.imported.testEvidenceShowsNoFalseSuccess === true;
  const coverageOk =
    opts.imported.noFalseSuccessWithoutRemediationPct !== null &&
    opts.imported.noFalseSuccessWithoutRemediationPct >= COVERAGE_PCT_MIN;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiPartialToolFailureReport["summary"]["statusHint"];
  let relM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.partialFailureHandlingConfigured === false ||
      opts.imported.testEvidenceShowsNoFalseSuccess === false ||
      (typeof opts.imported.noFalseSuccessWithoutRemediationPct ===
        "number" &&
        opts.imported.noFalseSuccessWithoutRemediationPct <
          COVERAGE_PCT_MIN) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.toolAgentSignals &&
    !handlingSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    relM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing partial-failure handling, missing outcome test evidence, false-success still possible, or evidence older than 90 days — REL-M3 fail.",
    );
  } else if (
    (handlingSignalsPresent || opts.imported.found) &&
    handlingOk &&
    testOk &&
    coverageOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relM3Satisfied = true;
  } else if (handlingSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relM3Satisfied = false;
    if (opts.imported.found && !handlingOk) {
      notes.push("Import must show partialFailureHandlingConfigured=true.");
    }
    if (opts.imported.found && !testOk) {
      notes.push("Import must show testEvidenceShowsNoFalseSuccess=true.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show noFalseSuccessWithoutRemediationPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-M3 PASS.",
      );
    }
  } else if (opts.toolAgentSignals) {
    statusHint = "not_demonstrated";
    relM3Satisfied = null;
    notes.push(
      "Tool/agent signals present but no partial-failure handling or outcome test evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      handling: opts.handling,
      testEvidence: opts.testEvidence,
    },
    importedResults: opts.imported,
    summary: {
      toolAgentSignalsPresent: opts.toolAgentSignals,
      handlingSignalsPresent,
      relM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiPartialToolFailureCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const toolAgentSignals = detectToolAgentSignals(
      ctx.targetPath,
      maxFiles,
    );

    const handlingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!PARTIAL_FAIL_RE.test(path) && !PARTIAL_FAIL_RE.test(text)) {
          return false;
        }
        return (
          TOOL_AGENT_RE.test(path) ||
          TOOL_AGENT_RE.test(text) ||
          PARTIAL_FAIL_RE.test(path)
        );
      },
      10,
    );
    const testRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        TEST_EVIDENCE_RE.test(path) ||
        (/(test|spec|e2e|fixture|chaos|simulat|replay|contract)/i.test(path) &&
          (TEST_EVIDENCE_RE.test(text) ||
            (PARTIAL_FAIL_RE.test(text) && TOOL_AGENT_RE.test(text)))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiPartialToolFailureReport({
      assessedAt: ctx.assessedAt.toISOString(),
      handling: { found: handlingRefs.length > 0, refs: handlingRefs },
      testEvidence: { found: testRefs.length > 0, refs: testRefs },
      toolAgentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-partial-tool-failure-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-partial-tool-failure-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-partial-tool-failure",
          "rel-m3",
          DETECTOR_ID,
          ...(report.summary.relM3Satisfied ? ["rel-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.handling.refs,
        ...report.signals.testEvidence.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-partial-tool-failure-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-M3 status=${report.summary.statusHint} signals=${report.summary.handlingSignalsPresent} satisfied=${report.summary.relM3Satisfied}; report=imports/${PLUGIN_ID}/ai-partial-tool-failure-report.json`,
      nodes,
    };
  },
};
