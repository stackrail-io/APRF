/**
 * ai-circuit-bulkhead — REL-R1 / repo-ai-circuit-bulkhead.
 *
 * Discovers circuit breakers + bulkheads on AI/provider clients.
 * Import circuitBreakerConfigured + bulkheadLimitsConcurrentCalls +
 * breakerTripEvidenceWithin90Days under imports/ai-circuit-bulkhead/
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

const PLUGIN_ID = "ai-circuit-bulkhead";
const RELATED = ["REL-R1"] as const;
const DETECTOR_ID = "repo-ai-circuit-bulkhead";
const IMPORT_MAX_AGE_DAYS = 90;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|provider|litellm)/i;

const BREAKER_RE =
  /\b(circuit[_-]?break|CircuitBreaker|opossum|resilience4j|polly|hystrix|failsafe|breaker[_-]?(open|half|closed))\b/i;

const BULKHEAD_RE =
  /\b(bulkhead|concurrency[_-]?(limit|cap|pool)|max[_-]?(concurrent|in[_-]?flight|parallel)|semaphore|isolate[_-]?(pool|thread))\b/i;

const TRIP_RE =
  /\b(breaker[_-]?(trip|open|opened)|circuit[_-]?open|induced[_-]?fail|trip[_-]?log|breaker[_-]?test)\b/i;

export interface AiCircuitBulkheadReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    breaker: { found: boolean; refs: string[] };
    bulkhead: { found: boolean; refs: string[] };
    trip: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    circuitBreakerConfigured: boolean | null;
    bulkheadLimitsConcurrentCalls: boolean | null;
    breakerTripEvidenceWithin90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    isolationSignalsPresent: boolean;
    relR1Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".java",
      ".kt",
      ".go",
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
): AiCircuitBulkheadReport["importedResults"] {
  const sources: string[] = [];
  let circuitBreakerConfigured: boolean | null = null;
  let bulkheadLimitsConcurrentCalls: boolean | null = null;
  let breakerTripEvidenceWithin90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-circuit-bulkhead-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      circuitBreakerConfigured =
        asBool(data.circuitBreakerConfigured) ??
        asBool(data.circuit_breaker_configured) ??
        asBool(data.breakerConfigured) ??
        circuitBreakerConfigured;
      bulkheadLimitsConcurrentCalls =
        asBool(data.bulkheadLimitsConcurrentCalls) ??
        asBool(data.bulkhead_limits_concurrent_calls) ??
        asBool(data.bulkheadConfigured) ??
        asBool(data.concurrencyLimitedPerProvider) ??
        bulkheadLimitsConcurrentCalls;
      breakerTripEvidenceWithin90Days =
        asBool(data.breakerTripEvidenceWithin90Days) ??
        asBool(data.breaker_trip_evidence_within_90_days) ??
        asBool(data.breakerOpenedInTestOrProd) ??
        asBool(data.tripEvidence) ??
        breakerTripEvidenceWithin90Days;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    circuitBreakerConfigured,
    bulkheadLimitsConcurrentCalls,
    breakerTripEvidenceWithin90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiCircuitBulkheadReport(opts: {
  assessedAt: string;
  breaker: { found: boolean; refs: string[] };
  bulkhead: { found: boolean; refs: string[] };
  trip: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiCircuitBulkheadReport["importedResults"];
}): AiCircuitBulkheadReport {
  const notes: string[] = [];
  const isolationSignalsPresent =
    opts.breaker.found || opts.bulkhead.found || opts.trip.found;

  if (!opts.aiSignals && !isolationSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI circuit-breaker/bulkhead signals — REL-R1 may be NOT_APPLICABLE if there are no production AI/provider clients.",
    );
  }
  if (opts.breaker.found) {
    notes.push(`Breaker refs: ${opts.breaker.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.bulkhead.found) {
    notes.push(`Bulkhead refs: ${opts.bulkhead.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.trip.found) {
    notes.push(`Trip refs: ${opts.trip.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (breaker=${opts.imported.circuitBreakerConfigured}, bulkhead=${opts.imported.bulkheadLimitsConcurrentCalls}, trip=${opts.imported.breakerTripEvidenceWithin90Days})`,
    );
  } else if (isolationSignalsPresent) {
    notes.push(
      "Isolation signals alone are PARTIAL — import circuitBreakerConfigured=true + bulkheadLimitsConcurrentCalls=true + breakerTripEvidenceWithin90Days=true (measuredAt ≤90d) under imports/ai-circuit-bulkhead/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const breakerOk = opts.imported.circuitBreakerConfigured === true;
  const bulkheadOk = opts.imported.bulkheadLimitsConcurrentCalls === true;
  const tripOk = opts.imported.breakerTripEvidenceWithin90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiCircuitBulkheadReport["summary"]["statusHint"];
  let relR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.circuitBreakerConfigured === false ||
      opts.imported.bulkheadLimitsConcurrentCalls === false ||
      opts.imported.breakerTripEvidenceWithin90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !isolationSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing circuit breaker, missing bulkhead, no trip evidence ≤90 days, or attest older than 90 days — REL-R1 fail.",
    );
  } else if (
    (isolationSignalsPresent || opts.imported.found) &&
    breakerOk &&
    bulkheadOk &&
    tripOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR1Satisfied = true;
  } else if (isolationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR1Satisfied = false;
    if (opts.imported.found && !breakerOk) {
      notes.push("Import must show circuitBreakerConfigured=true.");
    }
    if (opts.imported.found && !bulkheadOk) {
      notes.push("Import must show bulkheadLimitsConcurrentCalls=true.");
    }
    if (opts.imported.found && !tripOk) {
      notes.push("Import must show breakerTripEvidenceWithin90Days=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R1 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    relR1Satisfied = null;
    notes.push(
      "AI signals present but no circuit-breaker/bulkhead evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      breaker: opts.breaker,
      bulkhead: opts.bulkhead,
      trip: opts.trip,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      isolationSignalsPresent,
      relR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiCircuitBulkheadCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const breakerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!BREAKER_RE.test(path) && !BREAKER_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          BREAKER_RE.test(path)
        );
      },
      10,
    );
    const bulkheadRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!BULKHEAD_RE.test(path) && !BULKHEAD_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          BULKHEAD_RE.test(path) ||
          BREAKER_RE.test(path + text)
        );
      },
      10,
    );
    const tripRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        TRIP_RE.test(path) ||
        (/(test|spec|e2e|log|fixture)/i.test(path) &&
          (TRIP_RE.test(text) || BREAKER_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiCircuitBulkheadReport({
      assessedAt: ctx.assessedAt.toISOString(),
      breaker: { found: breakerRefs.length > 0, refs: breakerRefs },
      bulkhead: { found: bulkheadRefs.length > 0, refs: bulkheadRefs },
      trip: { found: tripRefs.length > 0, refs: tripRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-circuit-bulkhead-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-circuit-bulkhead-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-circuit-bulkhead",
          "rel-r1",
          DETECTOR_ID,
          ...(report.summary.relR1Satisfied ? ["rel-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.breaker.refs,
        ...report.signals.bulkhead.refs,
        ...report.signals.trip.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-circuit-bulkhead-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R1 status=${report.summary.statusHint} signals=${report.summary.isolationSignalsPresent} satisfied=${report.summary.relR1Satisfied}; report=imports/${PLUGIN_ID}/ai-circuit-bulkhead-report.json`,
      nodes,
    };
  },
};
