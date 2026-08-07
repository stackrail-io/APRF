/**
 * ai-spend-limits — COST-M1 / repo-rate-limit-config detector executor.
 *
 * Discovers hard spend ceilings / AI rate limits. Import enforce-on-exceed
 * results under imports/ai-spend-limits/ to unlock PASS.
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

const PLUGIN_ID = "ai-spend-limits";
const RELATED = ["COST-M1"] as const;
const DETECTOR_ID = "repo-rate-limit-config";

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|embedding|token)/i;

const LIMIT_RE =
  /\b(rate[_-]?limit|rpm|tpm|tokens?[_-]?(per|_?min)|spend[_-]?(cap|ceiling|limit)|budget[_-]?(cap|limit|ceiling)|quota|max[_-]?(tokens|requests|cost|spend)|throttle|denial[_-]?of[_-]?wallet)\b/i;

const ENFORCE_RE =
  /\b(deny|throttl|429|quota[_-]?exceed|budget[_-]?exceed|rate[_-]?limit[_-]?exceed|fail[_-]?closed)\b/i;

export interface AiSpendLimitsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  limits: { found: boolean; refs: string[] };
  enforceTests: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    enforcedDenyOrThrottle: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    limitPresent: boolean;
    costM1Satisfied: boolean | null;
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
): AiSpendLimitsReport["importedResults"] {
  const sources: string[] = [];
  let enforcedDenyOrThrottle: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-spend-limits-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      enforcedDenyOrThrottle =
        asBool(data.enforcedDenyOrThrottle) ??
        asBool(data.limitEnforced) ??
        asBool(data.deniedOrThrottledOnExceed) ??
        enforcedDenyOrThrottle;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const results = Array.isArray(data.results)
        ? (data.results as Array<Record<string, unknown>>)
        : Array.isArray(data.tests)
          ? (data.tests as Array<Record<string, unknown>>)
          : Array.isArray(data.events)
            ? (data.events as Array<Record<string, unknown>>)
            : [];
      for (const r of results) {
        const ok =
          r.denied === true ||
          r.throttled === true ||
          r.enforced === true ||
          r.passed === true ||
          String(r.status || "").toLowerCase() === "deny" ||
          String(r.status || "").toLowerCase() === "throttle" ||
          String(r.status || "").toLowerCase() === "429";
        enforcedDenyOrThrottle =
          enforcedDenyOrThrottle === null
            ? ok
            : enforcedDenyOrThrottle && ok;
        const age = asNum(r.ageDays) ?? asNum(r.age_days);
        if (age !== null) ageDays = age;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    enforcedDenyOrThrottle,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSpendLimitsReport(opts: {
  assessedAt: string;
  limits: { found: boolean; refs: string[] };
  enforceTests: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiSpendLimitsReport["importedResults"];
}): AiSpendLimitsReport {
  const notes: string[] = [];
  const limitPresent = opts.limits.found;

  if (!opts.aiSignals && !limitPresent && !opts.imported.found) {
    notes.push(
      "No AI/spend-limit signals — COST-M1 may be NOT_APPLICABLE if there are no production AI workloads.",
    );
  }
  if (limitPresent) {
    notes.push(`Spend/rate limit refs: ${opts.limits.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No hard spend ceiling / AI rate-limit config signals found.");
  }
  if (opts.enforceTests.found) {
    notes.push(`Enforce-test refs: ${opts.enforceTests.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (enforced=${opts.imported.enforcedDenyOrThrottle}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (limitPresent) {
    notes.push(
      "Limit config alone is PARTIAL — import ≤90-day deny/throttle evidence under imports/ai-spend-limits/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const enforcedOk =
    opts.imported.enforcedDenyOrThrottle === true && ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSpendLimitsReport["summary"]["statusHint"];
  let costM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.enforcedDenyOrThrottle === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (!opts.aiSignals && !limitPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    costM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costM1Satisfied = false;
    notes.push(
      "Imported results show limit not enforced on exceed or evidence older than 90 days — COST-M1 fail.",
    );
  } else if (limitPresent && enforcedOk && importFresh) {
    statusHint = "pass";
    costM1Satisfied = true;
  } else if (
    limitPresent ||
    opts.enforceTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costM1Satisfied = false;
    if (opts.imported.found && !enforcedOk) {
      notes.push(
        "Import must show enforcedDenyOrThrottle=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-M1 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costM1Satisfied = null;
    notes.push(
      "AI signals present but no spend/rate-limit config or enforcement evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    limits: opts.limits,
    enforceTests: opts.enforceTests,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      limitPresent,
      costM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSpendLimitsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const limitRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!LIMIT_RE.test(path) && !LIMIT_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          LIMIT_RE.test(path)
        );
      },
    );
    const enforceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture)/i.test(path) &&
        LIMIT_RE.test(text) &&
        ENFORCE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiSpendLimitsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      limits: { found: limitRefs.length > 0, refs: limitRefs },
      enforceTests: { found: enforceRefs.length > 0, refs: enforceRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-spend-limits-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-spend-limits-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-spend-limits",
          "cost-m1",
          DETECTOR_ID,
          ...(report.summary.limitPresent ? ["spend-or-rate-limit"] : []),
          ...(report.summary.costM1Satisfied ? ["cost-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([...limitRefs.slice(0, 4), ...enforceRefs.slice(0, 2)]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-spend-limits-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-M1 status=${report.summary.statusHint} limit=${report.summary.limitPresent} satisfied=${report.summary.costM1Satisfied}; report=imports/${PLUGIN_ID}/ai-spend-limits-report.json`,
      nodes,
    };
  },
};
