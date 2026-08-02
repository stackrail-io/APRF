/**
 * tool-rate-limits — TOL-R2 / repo-tool-rate-limits.
 *
 * Discovers per-tool rate-limit and blast-radius budget configs.
 * Import coverage under imports/tool-rate-limits/ unlocks PASS
 * (measuredAt ≤90d).
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import { ensureDir, listImportFiles, readText, redact } from "./lib/fs.ts";
import { asNum, collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "tool-rate-limits";
const RELATED = ["TOL-R2"] as const;
const DETECTOR_ID = "repo-tool-rate-limits";
const IMPORT_MAX_AGE_DAYS = 90;

const RATE_LIMIT_RE =
  /\b(rate[_-]?limit|qps|requests[_-]?per[_-]?second|tool[_-]?rate|per[_-]?tool[_-]?limit)\b/i;
const BLAST_RE =
  /\b(blast[_-]?radius|max[_-]?affected|entity[_-]?budget|daily[_-]?cap|maxAffectedEntities)\b/i;

export interface ToolRateLimitsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    rateLimit: { found: boolean; refs: string[] };
    blastRadius: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highImpactToolsPresent: boolean | null;
    highImpactToolsWithRateAndBlastBudgetPct: number | null;
    enforcementProvenWithin30Days: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolR2Satisfied: boolean | null;
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

function loadImported(
  ctx: CollectorContext,
): ToolRateLimitsReport["importedResults"] {
  const sources: string[] = [];
  let highImpactToolsPresent: boolean | null = null;
  let highImpactToolsWithRateAndBlastBudgetPct: number | null = null;
  let enforcementProvenWithin30Days: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/tool-rate-limits-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      highImpactToolsPresent = mergeOrBool(
        highImpactToolsPresent,
        asBool(data.highImpactToolsPresent) ??
          asBool(data.high_impact_tools_present),
      );
      highImpactToolsWithRateAndBlastBudgetPct = mergeMinNum(
        highImpactToolsWithRateAndBlastBudgetPct,
        asNum(data.highImpactToolsWithRateAndBlastBudgetPct) ??
          asNum(data.high_impact_tools_with_rate_and_blast_budget_pct),
      );
      enforcementProvenWithin30Days = mergeAndBool(
        enforcementProvenWithin30Days,
        asBool(data.enforcementProvenWithin30Days) ??
          asBool(data.enforcement_proven_within_30_days),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highImpactToolsPresent,
    highImpactToolsWithRateAndBlastBudgetPct,
    enforcementProvenWithin30Days,
    measuredAt,
    sources,
  };
}

export function buildToolRateLimitsReport(opts: {
  assessedAt: string;
  rateLimit: { found: boolean; refs: string[] };
  blastRadius: { found: boolean; refs: string[] };
  imported: ToolRateLimitsReport["importedResults"];
}): ToolRateLimitsReport {
  const notes: string[] = [];
  const gateSignalsPresent = opts.rateLimit.found || opts.blastRadius.found;
  const surfaceProvedForNaOverride =
    opts.rateLimit.found || opts.blastRadius.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No tool-rate-limit signals — TOL-R2 remains not demonstrated until rate/blast coverage or highImpactToolsPresent=false is imported.",
    );
  }
  if (opts.rateLimit.found) {
    notes.push(
      `Rate-limit refs: ${opts.rateLimit.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.blastRadius.found) {
    notes.push(
      `Blast-radius refs: ${opts.blastRadius.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.highImpactToolsPresent}, budgetPct=${opts.imported.highImpactToolsWithRateAndBlastBudgetPct}, enforcement30d=${opts.imported.enforcementProvenWithin30Days}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import highImpactToolsWithRateAndBlastBudgetPct=100 + enforcementProvenWithin30Days=true (measuredAt ≤90d) under imports/tool-rate-limits/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.highImpactToolsPresent === true;
  const budgetOk =
    opts.imported.highImpactToolsWithRateAndBlastBudgetPct === 100;
  const enforcementOk = opts.imported.enforcementProvenWithin30Days === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.highImpactToolsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.highImpactToolsWithRateAndBlastBudgetPct !== null &&
      opts.imported.highImpactToolsWithRateAndBlastBudgetPct < 100) ||
    opts.imported.enforcementProvenWithin30Days === false;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: ToolRateLimitsReport["summary"]["statusHint"];
  let tolR2Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolR2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete rate/blast budgets or missing ≤30d enforcement proof — TOL-R2 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolR2Satisfied = null;
    notes.push(
      "Imported highImpactToolsPresent=false — TOL-R2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.highImpactToolsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported highImpactToolsPresent=false ignored — in-repo rate/blast signals prove the surface exists.",
    );
    if (
      surfacePresent &&
      budgetOk &&
      enforcementOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      tolR2Satisfied = true;
    } else {
      statusHint = "partial";
      tolR2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolR2Satisfied = null;
  } else if (
    surfacePresent &&
    budgetOk &&
    enforcementOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolR2Satisfied = true;
  } else {
    statusHint = "partial";
    tolR2Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      rateLimit: opts.rateLimit,
      blastRadius: opts.blastRadius,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const toolRateLimitsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const rateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => RATE_LIMIT_RE.test(p) || RATE_LIMIT_RE.test(t),
      10,
    );
    const blastRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => BLAST_RE.test(p) || BLAST_RE.test(t),
      10,
    );

    const report = buildToolRateLimitsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      rateLimit: { found: rateRefs.length > 0, refs: rateRefs },
      blastRadius: { found: blastRefs.length > 0, refs: blastRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "tool-rate-limits-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-R2 status=${report.summary.statusHint} satisfied=${report.summary.tolR2Satisfied}; report=imports/${PLUGIN_ID}/tool-rate-limits-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/tool-rate-limits-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-r2",
            DETECTOR_ID,
            ...(report.summary.tolR2Satisfied ? ["tol-r2-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
