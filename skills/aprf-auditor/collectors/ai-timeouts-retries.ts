/**
 * ai-timeouts-retries — REL-M1 / repo-ai-timeouts-retries.
 *
 * Discovers finite timeout + max-retry on model/tool clients.
 * Import timeoutsConfigured + retriesBounded + callSitesCoveredPct=100 +
 * verifiedByStaticOrIntegrationTest under imports/ai-timeouts-retries/
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-timeouts-retries";
const RELATED = ["REL-M1"] as const;
const DETECTOR_ID = "repo-ai-timeouts-retries";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|embedding|litellm|langchain|tool[_-]?call|mcp)/i;

const TIMEOUT_RE =
  /\b(timeout[_-]?(ms|s|secs?|seconds|millis)?|request[_-]?timeout|client[_-]?timeout|socket[_-]?timeout|http[_-]?timeout|deadline|AbortSignal\.timeout|signal\s*:\s*AbortSignal)\b/i;

const RETRY_RE =
  /\b(max[_-]?retr(?:y|ies)|retry[_-]?(limit|count|attempts|policy)|num[_-]?retr(?:y|ies)|retries?\s*[:=]|tenacity|backoff|exponential[_-]?backoff)\b/i;

const VERIFY_RE =
  /\b(static[_-]?analy|semgrep|eslint|bandit|call[_-]?site|timeout[_-]?retr|bounded[_-]?retr|integration[_-]?test|assert.*timeout|assert.*retr)\b/i;

export interface AiTimeoutsRetriesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    timeout: { found: boolean; refs: string[] };
    retry: { found: boolean; refs: string[] };
    verify: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    timeoutsConfigured: boolean | null;
    retriesBounded: boolean | null;
    callSitesCoveredPct: number | null;
    verifiedByStaticOrIntegrationTest: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    timeoutOrRetryPresent: boolean;
    relM1Satisfied: boolean | null;
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

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm|tool_call)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiTimeoutsRetriesReport["importedResults"] {
  const sources: string[] = [];
  let timeoutsConfigured: boolean | null = null;
  let retriesBounded: boolean | null = null;
  let callSitesCoveredPct: number | null = null;
  let verifiedByStaticOrIntegrationTest: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-timeouts-retries-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      timeoutsConfigured =
        asBool(data.timeoutsConfigured) ??
        asBool(data.timeouts_configured) ??
        asBool(data.finiteTimeouts) ??
        timeoutsConfigured;
      retriesBounded =
        asBool(data.retriesBounded) ??
        asBool(data.retries_bounded) ??
        asBool(data.finiteMaxRetries) ??
        asBool(data.maxRetriesBounded) ??
        retriesBounded;
      callSitesCoveredPct =
        asNum(data.callSitesCoveredPct) ??
        asNum(data.call_sites_covered_pct) ??
        asNum(data.coveragePct) ??
        asNum(data.coverage_pct) ??
        callSitesCoveredPct;
      verifiedByStaticOrIntegrationTest =
        asBool(data.verifiedByStaticOrIntegrationTest) ??
        asBool(data.verified_by_static_or_integration_test) ??
        asBool(data.staticOrIntegrationVerified) ??
        asBool(data.verified) ??
        verifiedByStaticOrIntegrationTest;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    timeoutsConfigured,
    retriesBounded,
    callSitesCoveredPct,
    verifiedByStaticOrIntegrationTest,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTimeoutsRetriesReport(opts: {
  assessedAt: string;
  timeout: { found: boolean; refs: string[] };
  retry: { found: boolean; refs: string[] };
  verify: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiTimeoutsRetriesReport["importedResults"];
}): AiTimeoutsRetriesReport {
  const notes: string[] = [];
  const timeoutOrRetryPresent = opts.timeout.found || opts.retry.found;

  if (!opts.aiSignals && !timeoutOrRetryPresent && !opts.imported.found) {
    notes.push(
      "No AI timeout/retry signals — REL-M1 may be NOT_APPLICABLE if there are no production model/tool clients.",
    );
  }
  if (opts.timeout.found) {
    notes.push(`Timeout refs: ${opts.timeout.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.retry.found) {
    notes.push(`Retry refs: ${opts.retry.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.verify.found) {
    notes.push(`Verify refs: ${opts.verify.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (timeouts=${opts.imported.timeoutsConfigured}, retries=${opts.imported.retriesBounded}, coveragePct=${opts.imported.callSitesCoveredPct}, verified=${opts.imported.verifiedByStaticOrIntegrationTest})`,
    );
  } else if (timeoutOrRetryPresent) {
    notes.push(
      "Timeout/retry signals alone are PARTIAL — import timeoutsConfigured=true + retriesBounded=true + callSitesCoveredPct=100 + verifiedByStaticOrIntegrationTest=true (measuredAt ≤90d) under imports/ai-timeouts-retries/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const timeoutsOk = opts.imported.timeoutsConfigured === true;
  const retriesOk = opts.imported.retriesBounded === true;
  const coverageOk =
    opts.imported.callSitesCoveredPct !== null &&
    opts.imported.callSitesCoveredPct >= COVERAGE_PCT_MIN;
  const verifiedOk =
    opts.imported.verifiedByStaticOrIntegrationTest === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiTimeoutsRetriesReport["summary"]["statusHint"];
  let relM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.timeoutsConfigured === false ||
      opts.imported.retriesBounded === false ||
      (typeof opts.imported.callSitesCoveredPct === "number" &&
        opts.imported.callSitesCoveredPct < COVERAGE_PCT_MIN) ||
      opts.imported.verifiedByStaticOrIntegrationTest === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !timeoutOrRetryPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing timeouts, unbounded retries, coverage <100%, unverified call sites, or evidence older than 90 days — REL-M1 fail.",
    );
  } else if (
    (timeoutOrRetryPresent || opts.imported.found) &&
    timeoutsOk &&
    retriesOk &&
    coverageOk &&
    verifiedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relM1Satisfied = true;
  } else if (
    timeoutOrRetryPresent ||
    opts.verify.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    relM1Satisfied = false;
    if (opts.imported.found && !timeoutsOk) {
      notes.push("Import must show timeoutsConfigured=true.");
    }
    if (opts.imported.found && !retriesOk) {
      notes.push("Import must show retriesBounded=true.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show callSitesCoveredPct=100.");
    }
    if (opts.imported.found && !verifiedOk) {
      notes.push(
        "Import must show verifiedByStaticOrIntegrationTest=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-M1 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    relM1Satisfied = null;
    notes.push(
      "AI signals present but no timeout/retry config or coverage evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      timeout: opts.timeout,
      retry: opts.retry,
      verify: opts.verify,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      timeoutOrRetryPresent,
      relM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiTimeoutsRetriesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const timeoutRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!TIMEOUT_RE.test(path) && !TIMEOUT_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          TIMEOUT_RE.test(path)
        );
      },
      10,
    );
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
      10,
    );
    const verifyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture|lint|semgrep|static)/i.test(path) &&
        (TIMEOUT_RE.test(text) || RETRY_RE.test(text)) &&
        VERIFY_RE.test(path + text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiTimeoutsRetriesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      timeout: { found: timeoutRefs.length > 0, refs: timeoutRefs },
      retry: { found: retryRefs.length > 0, refs: retryRefs },
      verify: { found: verifyRefs.length > 0, refs: verifyRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-timeouts-retries-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-timeouts-retries-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-timeouts-retries",
          "rel-m1",
          DETECTOR_ID,
          ...(report.summary.relM1Satisfied ? ["rel-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.timeout.refs,
        ...report.signals.retry.refs,
        ...report.signals.verify.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-timeouts-retries-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-M1 status=${report.summary.statusHint} signals=${report.summary.timeoutOrRetryPresent} satisfied=${report.summary.relM1Satisfied}; report=imports/${PLUGIN_ID}/ai-timeouts-retries-report.json`,
      nodes,
    };
  },
};
