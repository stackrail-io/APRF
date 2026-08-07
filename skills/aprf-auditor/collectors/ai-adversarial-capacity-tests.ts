/**
 * ai-adversarial-capacity-tests — PERF-R2 / repo-ai-adversarial-capacity-tests.
 *
 * Discovers capacity/load tests with long-prompt + agent-loop scenarios.
 * Import capacityTestIncludesAdversarialLongPrompts +
 * capacityTestIncludesMultiStepAgentLoops +
 * p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency +
 * lastCapacityTestWithin90Days under imports/ai-adversarial-capacity-tests/
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
  SCAN_EXTENSIONS_DOCS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-adversarial-capacity-tests";
const RELATED = ["PERF-R2"] as const;
const DETECTOR_ID = "repo-ai-adversarial-capacity-tests";
const IMPORT_MAX_AGE_DAYS = 90;
const TEST_MAX_AGE_DAYS = 90;

const CAPACITY_RE =
  /\b(capacity[\s_-]*test|load[\s_-]*test|soak[\s_-]*test|stress[\s_-]*test|k6|jmeter|locust|gatling)\b/i;

const LONG_PROMPT_RE =
  /\b(long[\s_-]*prompt|adversarial[\s_-]*prompt|context[\s_-]*blow|max[\s_-]*context|oversized[\s_-]*prompt|prompt[\s_-]*flood)\b/i;

const AGENT_LOOP_RE =
  /\b(agent[\s_-]*loop|multi[\s_-]*step[\s_-]*agent|tool[\s_-]*loop|recursive[\s_-]*agent|agent[\s_-]*concurrency|multi[\s_-]*agent[\s_-]*load)\b/i;

const SLO_CONCURRENCY_RE =
  /\b(p95|p99|error[\s_-]*rate|within[\s_-]*slo|documented[\s_-]*concurrency|concurrency[\s_-]*target)\b/i;

export interface AiAdversarialCapacityTestsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    capacity: { found: boolean; refs: string[] };
    longPrompt: { found: boolean; refs: string[] };
    agentLoop: { found: boolean; refs: string[] };
    sloConcurrency: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    capacityTestIncludesAdversarialLongPrompts: boolean | null;
    capacityTestIncludesMultiStepAgentLoops: boolean | null;
    p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency: boolean | null;
    lastCapacityTestWithin90Days: boolean | null;
    lastCapacityTestAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    capacitySignalsPresent: boolean;
    perfR2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS_DOCS],
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
): AiAdversarialCapacityTestsReport["importedResults"] {
  const sources: string[] = [];
  let capacityTestIncludesAdversarialLongPrompts: boolean | null = null;
  let capacityTestIncludesMultiStepAgentLoops: boolean | null = null;
  let p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency:
    | boolean
    | null = null;
  let lastCapacityTestWithin90Days: boolean | null = null;
  let lastCapacityTestAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-adversarial-capacity-tests-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastCapacityTestAgeDays =
        asNum(data.lastCapacityTestAgeDays) ??
        asNum(data.last_capacity_test_age_days) ??
        lastCapacityTestAgeDays;
      capacityTestIncludesAdversarialLongPrompts =
        asBool(data.capacityTestIncludesAdversarialLongPrompts) ??
        asBool(data.capacity_test_includes_adversarial_long_prompts) ??
        asBool(data.longPromptScenariosIncluded) ??
        capacityTestIncludesAdversarialLongPrompts;
      capacityTestIncludesMultiStepAgentLoops =
        asBool(data.capacityTestIncludesMultiStepAgentLoops) ??
        asBool(data.capacity_test_includes_multi_step_agent_loops) ??
        asBool(data.agentLoopScenariosIncluded) ??
        capacityTestIncludesMultiStepAgentLoops;
      p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency =
        asBool(
          data.p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency,
        ) ??
        asBool(
          data.p95_latency_and_error_rate_within_slo_under_documented_concurrency,
        ) ??
        asBool(data.withinSloUnderDocumentedConcurrency) ??
        p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency;
      lastCapacityTestWithin90Days =
        asBool(data.lastCapacityTestWithin90Days) ??
        asBool(data.last_capacity_test_within_90_days) ??
        lastCapacityTestWithin90Days;

      if (lastCapacityTestAgeDays !== null) {
        lastCapacityTestWithin90Days =
          lastCapacityTestWithin90Days ??
          lastCapacityTestAgeDays <= TEST_MAX_AGE_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    capacityTestIncludesAdversarialLongPrompts,
    capacityTestIncludesMultiStepAgentLoops,
    p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency,
    lastCapacityTestWithin90Days,
    lastCapacityTestAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiAdversarialCapacityTestsReport(opts: {
  assessedAt: string;
  capacity: { found: boolean; refs: string[] };
  longPrompt: { found: boolean; refs: string[] };
  agentLoop: { found: boolean; refs: string[] };
  sloConcurrency: { found: boolean; refs: string[] };
  imported: AiAdversarialCapacityTestsReport["importedResults"];
}): AiAdversarialCapacityTestsReport {
  const notes: string[] = [];
  const capacitySignalsPresent =
    opts.capacity.found ||
    opts.longPrompt.found ||
    opts.agentLoop.found ||
    opts.sloConcurrency.found;

  if (!capacitySignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI adversarial capacity-test signals — PERF-R2 may be NOT_APPLICABLE if no production AI capacity risk is in scope.",
    );
  }
  if (opts.capacity.found) {
    notes.push(`Capacity refs: ${opts.capacity.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (longPrompt=${opts.imported.capacityTestIncludesAdversarialLongPrompts}, agentLoop=${opts.imported.capacityTestIncludesMultiStepAgentLoops}, withinSlo=${opts.imported.p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency}, recent=${opts.imported.lastCapacityTestWithin90Days}, age=${opts.imported.lastCapacityTestAgeDays})`,
    );
  } else if (capacitySignalsPresent) {
    notes.push(
      "Capacity signals alone are PARTIAL — import capacityTestIncludesAdversarialLongPrompts=true + capacityTestIncludesMultiStepAgentLoops=true + p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency=true + lastCapacityTestWithin90Days=true (measuredAt ≤90d) under imports/ai-adversarial-capacity-tests/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const longOk =
    opts.imported.capacityTestIncludesAdversarialLongPrompts === true;
  const agentOk =
    opts.imported.capacityTestIncludesMultiStepAgentLoops === true;
  const sloOk =
    opts.imported.p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency ===
    true;
  const recentOk =
    opts.imported.lastCapacityTestWithin90Days === true ||
    (opts.imported.lastCapacityTestAgeDays !== null &&
      opts.imported.lastCapacityTestAgeDays <= TEST_MAX_AGE_DAYS);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiAdversarialCapacityTestsReport["summary"]["statusHint"];
  let perfR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.capacityTestIncludesAdversarialLongPrompts === false ||
      opts.imported.capacityTestIncludesMultiStepAgentLoops === false ||
      opts.imported.p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency ===
        false ||
      opts.imported.lastCapacityTestWithin90Days === false ||
      (typeof opts.imported.lastCapacityTestAgeDays === "number" &&
        opts.imported.lastCapacityTestAgeDays > TEST_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!capacitySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing long-prompt/agent-loop scenarios, SLO miss under concurrency, stale capacity test (>90d), or evidence older than 90 days — PERF-R2 fail.",
    );
  } else if (
    (capacitySignalsPresent || opts.imported.found) &&
    longOk &&
    agentOk &&
    sloOk &&
    recentOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfR2Satisfied = true;
  } else if (capacitySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfR2Satisfied = false;
    if (opts.imported.found && !longOk) {
      notes.push(
        "Import must show capacityTestIncludesAdversarialLongPrompts=true.",
      );
    }
    if (opts.imported.found && !agentOk) {
      notes.push(
        "Import must show capacityTestIncludesMultiStepAgentLoops=true.",
      );
    }
    if (opts.imported.found && !sloOk) {
      notes.push(
        "Import must show p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency=true.",
      );
    }
    if (opts.imported.found && !recentOk) {
      notes.push(
        "Import must show lastCapacityTestWithin90Days=true (or lastCapacityTestAgeDays≤90).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      capacity: opts.capacity,
      longPrompt: opts.longPrompt,
      agentLoop: opts.agentLoop,
      sloConcurrency: opts.sloConcurrency,
    },
    importedResults: opts.imported,
    summary: {
      capacitySignalsPresent,
      perfR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiAdversarialCapacityTestsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const capacity = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CAPACITY_RE.test(path) || CAPACITY_RE.test(text),
      10,
    );
    const longPrompt = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => LONG_PROMPT_RE.test(path) || LONG_PROMPT_RE.test(text),
      8,
    );
    const agentLoop = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => AGENT_LOOP_RE.test(path) || AGENT_LOOP_RE.test(text),
      8,
    );
    const sloConcurrency = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SLO_CONCURRENCY_RE.test(path) || SLO_CONCURRENCY_RE.test(text)) &&
        (CAPACITY_RE.test(path + text) || /load|capacity|slo/i.test(path + text)),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiAdversarialCapacityTestsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      capacity: { found: capacity.length > 0, refs: capacity },
      longPrompt: { found: longPrompt.length > 0, refs: longPrompt },
      agentLoop: { found: agentLoop.length > 0, refs: agentLoop },
      sloConcurrency: {
        found: sloConcurrency.length > 0,
        refs: sloConcurrency,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-adversarial-capacity-tests-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-adversarial-capacity-tests-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-adversarial-capacity-tests",
          "perf-r2",
          DETECTOR_ID,
          ...(report.summary.perfR2Satisfied ? ["perf-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.capacity.refs,
        ...report.signals.longPrompt.refs,
        ...report.signals.agentLoop.refs,
        ...report.signals.sloConcurrency.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-adversarial-capacity-tests-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-R2 status=${report.summary.statusHint} signals=${report.summary.capacitySignalsPresent} satisfied=${report.summary.perfR2Satisfied}; report=imports/${PLUGIN_ID}/ai-adversarial-capacity-tests-report.json`,
      nodes,
    };
  },
};
