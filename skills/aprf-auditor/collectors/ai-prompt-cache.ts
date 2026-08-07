/**
 * ai-prompt-cache — COST-R1 / repo-prompt-cache-config detector executor.
 *
 * Discovers prompt/response cache config + exclusions. Import ≥30-day
 * hit-rate/savings report under imports/ai-prompt-cache/ to unlock PASS.
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

const PLUGIN_ID = "ai-prompt-cache";
const RELATED = ["COST-R1"] as const;
const DETECTOR_ID = "repo-prompt-cache-config";

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|prompt|embedding|litellm)/i;

const CACHE_RE =
  /\b(prompt[_-]?cache|response[_-]?cache|semantic[_-]?cache|llm[_-]?cache|completion[_-]?cache|cache[_-]?(prompt|completion|llm)|CachedContent|promptCaching)\b/i;

const EXCLUSION_RE =
  /\b(cache[_-]?(exclu|bypass|skip|deny|allowlist|block)|no[_-]?cache|uncached|sensitive|personaliz|pii|per[_-]?user|per[_-]?tenant)\b/i;

export interface AiPromptCacheReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  cacheConfig: { found: boolean; refs: string[] };
  exclusions: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    cacheEnabled: boolean | null;
    exclusionsDocumented: boolean | null;
    hitRateReported: boolean | null;
    savingsReported: boolean | null;
    reportWindowDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    cacheConfigPresent: boolean;
    costR1Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".tf"],
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): AiPromptCacheReport["importedResults"] {
  const sources: string[] = [];
  let cacheEnabled: boolean | null = null;
  let exclusionsDocumented: boolean | null = null;
  let hitRateReported: boolean | null = null;
  let savingsReported: boolean | null = null;
  let reportWindowDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-prompt-cache-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      cacheEnabled =
        asBool(data.cacheEnabled) ??
        asBool(data.enabled) ??
        asBool(data.promptCacheEnabled) ??
        cacheEnabled;
      exclusionsDocumented =
        asBool(data.exclusionsDocumented) ??
        asBool(data.safetyExclusions) ??
        asBool(data.sensitiveExcluded) ??
        exclusionsDocumented;
      const hitRate = asNum(data.hitRatePct) ?? asNum(data.hit_rate_pct);
      hitRateReported =
        asBool(data.hitRateReported) ??
        (hitRate !== null ? true : null) ??
        asBool(data.hasHitRate) ??
        hitRateReported;
      savingsReported =
        asBool(data.savingsReported) ??
        asBool(data.hasSavings) ??
        (asNum(data.savingsUsd) !== null || asNum(data.tokensSaved) !== null
          ? true
          : null) ??
        savingsReported;
      reportWindowDays =
        asNum(data.reportWindowDays) ??
        asNum(data.windowDays) ??
        asNum(data.daysCovered) ??
        reportWindowDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    cacheEnabled,
    exclusionsDocumented,
    hitRateReported,
    savingsReported,
    reportWindowDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiPromptCacheReport(opts: {
  assessedAt: string;
  cache: { found: boolean; refs: string[] };
  exclusions: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiPromptCacheReport["importedResults"];
}): AiPromptCacheReport {
  const notes: string[] = [];
  const cacheConfigPresent =
    opts.cache.found || opts.imported.cacheEnabled === true;

  if (
    !opts.aiSignals &&
    !cacheConfigPresent &&
    !opts.exclusions.found &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI/prompt-cache signals — COST-R1 may be NOT_APPLICABLE if there are no cacheable production prompts.",
    );
  }
  if (opts.cache.found) {
    notes.push(`Cache config refs: ${opts.cache.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No prompt/response cache config signals found.");
  }
  if (opts.exclusions.found) {
    notes.push(`Exclusion refs: ${opts.exclusions.refs.slice(0, 3).join(", ")}`);
  } else if (opts.cache.found) {
    notes.push(
      "Cache found but no clear sensitive/personalized exclusion signals — attest exclusions in import.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (enabled=${opts.imported.cacheEnabled}, exclusions=${opts.imported.exclusionsDocumented}, hitRate=${opts.imported.hitRateReported}, savings=${opts.imported.savingsReported}, windowDays=${opts.imported.reportWindowDays})`,
    );
  } else if (cacheConfigPresent) {
    notes.push(
      "Cache config alone is PARTIAL — import ≥30-day hit-rate/savings under imports/ai-prompt-cache/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const windowOk =
    opts.imported.reportWindowDays !== null &&
    opts.imported.reportWindowDays >= 30;
  const reportOk =
    opts.imported.hitRateReported === true &&
    opts.imported.savingsReported === true &&
    windowOk &&
    ageOk;
  const exclusionsOk =
    opts.exclusions.found || opts.imported.exclusionsDocumented === true;
  const enabledOk =
    opts.cache.found || opts.imported.cacheEnabled === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiPromptCacheReport["summary"]["statusHint"];
  let costR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.cacheEnabled === false ||
      opts.imported.exclusionsDocumented === false ||
      opts.imported.hitRateReported === false ||
      opts.imported.savingsReported === false ||
      (opts.imported.reportWindowDays !== null &&
        opts.imported.reportWindowDays < 30) ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.cache.found &&
    !opts.exclusions.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    costR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costR1Satisfied = false;
    notes.push(
      "Imported results show cache disabled, missing exclusions/report, window <30 days, or stale evidence — COST-R1 fail.",
    );
  } else if (enabledOk && exclusionsOk && reportOk && importFresh) {
    statusHint = "pass";
    costR1Satisfied = true;
  } else if (
    opts.cache.found ||
    opts.exclusions.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costR1Satisfied = false;
    if (opts.imported.found && !enabledOk) {
      notes.push("Import/repo must show cache enabled for idempotent paths.");
    }
    if (opts.imported.found && !exclusionsOk) {
      notes.push(
        "Need exclusionsDocumented=true (or repo exclusion signals) for sensitive/personalized prompts.",
      );
    }
    if (opts.imported.found && !reportOk) {
      notes.push(
        "Import must show hitRateReported + savingsReported with reportWindowDays ≥30 and ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-R1 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costR1Satisfied = null;
    notes.push(
      "AI signals present but no prompt-cache config or hit-rate report found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    cacheConfig: opts.cache,
    exclusions: opts.exclusions,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      cacheConfigPresent,
      costR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiPromptCacheCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const cacheRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!CACHE_RE.test(path) && !CACHE_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          CACHE_RE.test(path)
        );
      },
    );
    const exclusionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!EXCLUSION_RE.test(path) && !EXCLUSION_RE.test(text)) return false;
        return (
          CACHE_RE.test(path) ||
          CACHE_RE.test(text) ||
          /\b(prompt|llm|completion|cache)\b/i.test(path + "\n" + text)
        );
      },
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiPromptCacheReport({
      assessedAt: ctx.assessedAt.toISOString(),
      cache: { found: cacheRefs.length > 0, refs: cacheRefs },
      exclusions: { found: exclusionRefs.length > 0, refs: exclusionRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-prompt-cache-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-prompt-cache-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-prompt-cache",
          "cost-r1",
          DETECTOR_ID,
          ...(report.summary.cacheConfigPresent ? ["prompt-cache-config"] : []),
          ...(report.summary.costR1Satisfied ? ["cost-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([...cacheRefs.slice(0, 4), ...exclusionRefs.slice(0, 2)]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-prompt-cache-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-R1 status=${report.summary.statusHint} cache=${report.summary.cacheConfigPresent} satisfied=${report.summary.costR1Satisfied}; report=imports/${PLUGIN_ID}/ai-prompt-cache-report.json`,
      nodes,
    };
  },
};
