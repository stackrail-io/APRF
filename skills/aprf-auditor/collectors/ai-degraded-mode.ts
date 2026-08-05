/**
 * ai-degraded-mode — REL-M2 / repo-ai-degraded-mode.
 *
 * Discovers degraded-mode / fallback specs for critical AI journeys.
 * Import degradedModeDocumented + criticalJourneyCount≥1 +
 * criticalJourneysWithDegradedModePct=100 +
 * failoverTestShowsSafeFallback under imports/ai-degraded-mode/
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

const PLUGIN_ID = "ai-degraded-mode";
const RELATED = ["REL-M2"] as const;
const DETECTOR_ID = "repo-ai-degraded-mode";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|ai[_-]?gateway)/i;

const DEGRADED_RE =
  /\b(degraded[_-]?(mode|path|behavior|ux)|graceful[_-]?degrad|fallback[_-]?(mode|path|ux|response)|non[_-]?ai[_-]?(path|fallback|mode)|ai[_-]?(unavailable|outage|down)|circuit[_-]?break)\b/i;

const FEATURE_FLAG_RE =
  /\b(feature[_-]?flag|kill[_-]?switch|ai[_-]?(enabled|disabled)|disable[_-]?ai|fallback[_-]?flag|launchdarkly|unleash|flagsmith)\b/i;

const FAILOVER_TEST_RE =
  /\b(failover[_-]?test|fallback[_-]?test|degraded[_-]?mode[_-]?test|force[_-]?(ai[_-]?)?(fail|outage|unavailable)|inject[_-]?(ai[_-]?)?(fail|outage))\b/i;

export interface AiDegradedModeReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    degraded: { found: boolean; refs: string[] };
    featureFlag: { found: boolean; refs: string[] };
    failoverTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    degradedModeDocumented: boolean | null;
    criticalJourneyCount: number | null;
    criticalJourneysWithDegradedModePct: number | null;
    failoverTestShowsSafeFallback: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    degradedSignalsPresent: boolean;
    relM2Satisfied: boolean | null;
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
    extensions: [
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".ts",
      ".tsx",
      ".js",
      ".py",
    ],
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

function loadImported(
  ctx: CollectorContext,
): AiDegradedModeReport["importedResults"] {
  const sources: string[] = [];
  let degradedModeDocumented: boolean | null = null;
  let criticalJourneyCount: number | null = null;
  let criticalJourneysWithDegradedModePct: number | null = null;
  let failoverTestShowsSafeFallback: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-degraded-mode-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      degradedModeDocumented =
        asBool(data.degradedModeDocumented) ??
        asBool(data.degraded_mode_documented) ??
        asBool(data.degradedModeSpecExists) ??
        degradedModeDocumented;
      criticalJourneyCount =
        asNum(data.criticalJourneyCount) ??
        asNum(data.critical_journey_count) ??
        asNum(data.criticalJourneys) ??
        criticalJourneyCount;
      criticalJourneysWithDegradedModePct =
        asNum(data.criticalJourneysWithDegradedModePct) ??
        asNum(data.critical_journeys_with_degraded_mode_pct) ??
        asNum(data.coveragePct) ??
        criticalJourneysWithDegradedModePct;
      failoverTestShowsSafeFallback =
        asBool(data.failoverTestShowsSafeFallback) ??
        asBool(data.failover_test_shows_safe_fallback) ??
        asBool(data.safeFallbackActivatedOnAiFailure) ??
        asBool(data.failoverTestPassed) ??
        failoverTestShowsSafeFallback;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    degradedModeDocumented,
    criticalJourneyCount,
    criticalJourneysWithDegradedModePct,
    failoverTestShowsSafeFallback,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDegradedModeReport(opts: {
  assessedAt: string;
  degraded: { found: boolean; refs: string[] };
  featureFlag: { found: boolean; refs: string[] };
  failoverTest: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiDegradedModeReport["importedResults"];
}): AiDegradedModeReport {
  const notes: string[] = [];
  const degradedSignalsPresent =
    opts.degraded.found || opts.featureFlag.found || opts.failoverTest.found;

  if (!opts.aiSignals && !degradedSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI degraded-mode signals — REL-M2 may be NOT_APPLICABLE if there are no critical AI-dependent journeys.",
    );
  }
  if (opts.degraded.found) {
    notes.push(`Degraded-mode refs: ${opts.degraded.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.featureFlag.found) {
    notes.push(
      `Feature-flag refs: ${opts.featureFlag.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.failoverTest.found) {
    notes.push(
      `Failover-test refs: ${opts.failoverTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (documented=${opts.imported.degradedModeDocumented}, journeys=${opts.imported.criticalJourneyCount}, coveragePct=${opts.imported.criticalJourneysWithDegradedModePct}, failover=${opts.imported.failoverTestShowsSafeFallback})`,
    );
  } else if (degradedSignalsPresent) {
    notes.push(
      "Degraded-mode signals alone are PARTIAL — import degradedModeDocumented=true + criticalJourneyCount≥1 + criticalJourneysWithDegradedModePct=100 + failoverTestShowsSafeFallback=true (measuredAt ≤90d) under imports/ai-degraded-mode/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const documentedOk = opts.imported.degradedModeDocumented === true;
  const journeyOk =
    opts.imported.criticalJourneyCount !== null &&
    opts.imported.criticalJourneyCount >= 1;
  const coverageOk =
    opts.imported.criticalJourneysWithDegradedModePct !== null &&
    opts.imported.criticalJourneysWithDegradedModePct >= COVERAGE_PCT_MIN;
  const failoverOk = opts.imported.failoverTestShowsSafeFallback === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiDegradedModeReport["summary"]["statusHint"];
  let relM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.degradedModeDocumented === false ||
      (typeof opts.imported.criticalJourneyCount === "number" &&
        opts.imported.criticalJourneyCount < 1) ||
      (typeof opts.imported.criticalJourneysWithDegradedModePct === "number" &&
        opts.imported.criticalJourneysWithDegradedModePct < COVERAGE_PCT_MIN) ||
      opts.imported.failoverTestShowsSafeFallback === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !degradedSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing degraded-mode docs, zero critical journeys, coverage <100%, failed/absent failover test, or evidence older than 90 days — REL-M2 fail.",
    );
  } else if (
    (degradedSignalsPresent || opts.imported.found) &&
    documentedOk &&
    journeyOk &&
    coverageOk &&
    failoverOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relM2Satisfied = true;
  } else if (degradedSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relM2Satisfied = false;
    if (opts.imported.found && !documentedOk) {
      notes.push("Import must show degradedModeDocumented=true.");
    }
    if (opts.imported.found && !journeyOk) {
      notes.push("Import must show criticalJourneyCount≥1.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show criticalJourneysWithDegradedModePct=100.");
    }
    if (opts.imported.found && !failoverOk) {
      notes.push("Import must show failoverTestShowsSafeFallback=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-M2 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    relM2Satisfied = null;
    notes.push(
      "AI signals present but no degraded-mode / failover evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      degraded: opts.degraded,
      featureFlag: opts.featureFlag,
      failoverTest: opts.failoverTest,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      degradedSignalsPresent,
      relM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDegradedModeCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const degradedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        DEGRADED_RE.test(path) ||
        (DEGRADED_RE.test(text) &&
          (AI_PATH_RE.test(path + text) || /journey|fallback|outage/i.test(text))),
      10,
    );
    const featureFlagRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        FEATURE_FLAG_RE.test(path) ||
        (FEATURE_FLAG_RE.test(text) &&
          (AI_PATH_RE.test(path + text) || DEGRADED_RE.test(text))),
      8,
    );
    const failoverTestRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        FAILOVER_TEST_RE.test(path) ||
        (/(test|spec|e2e|fixture)/i.test(path) &&
          FAILOVER_TEST_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiDegradedModeReport({
      assessedAt: ctx.assessedAt.toISOString(),
      degraded: { found: degradedRefs.length > 0, refs: degradedRefs },
      featureFlag: {
        found: featureFlagRefs.length > 0,
        refs: featureFlagRefs,
      },
      failoverTest: {
        found: failoverTestRefs.length > 0,
        refs: failoverTestRefs,
      },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-degraded-mode-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-degraded-mode-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-degraded-mode",
          "rel-m2",
          DETECTOR_ID,
          ...(report.summary.relM2Satisfied ? ["rel-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.degraded.refs,
        ...report.signals.featureFlag.refs,
        ...report.signals.failoverTest.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-degraded-mode-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-M2 status=${report.summary.statusHint} signals=${report.summary.degradedSignalsPresent} satisfied=${report.summary.relM2Satisfied}; report=imports/${PLUGIN_ID}/ai-degraded-mode-report.json`,
      nodes,
    };
  },
};
