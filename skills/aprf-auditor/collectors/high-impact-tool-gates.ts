/**
 * high-impact-tool-gates — TOL-M3 / repo-high-impact-tool-gates.
 *
 * Discovers impact-tiered tool inventories and approval/dual/policy gates.
 * Import coverage under imports/high-impact-tool-gates/ unlocks PASS
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

const PLUGIN_ID = "high-impact-tool-gates";
const RELATED = ["TOL-M3"] as const;
const DETECTOR_ID = "repo-high-impact-tool-gates";
const IMPORT_MAX_AGE_DAYS = 90;

const IMPACT_TIER_RE =
  /\b(impact[_-]?(tier|level)|high[_-]?impact[_-]?tool|write[_-]?tool|irreversible|financial[_-]?tool)\b/i;
const GATE_RE =
  /\b(approval[_-]?gate|dual[_-]?control|policy[_-]?engine|human[_-]?approval.{0,40}tool|tool[_-]?gate|ungated[_-]?execution)\b/i;

export interface HighImpactToolGatesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    impactTier: { found: boolean; refs: string[] };
    gateConfig: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highImpactToolsPresent: boolean | null;
    highImpactToolsWithConfiguredGatePct: number | null;
    ungatedExecutionImpossibleInTests: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolM3Satisfied: boolean | null;
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
): HighImpactToolGatesReport["importedResults"] {
  const sources: string[] = [];
  let highImpactToolsPresent: boolean | null = null;
  let highImpactToolsWithConfiguredGatePct: number | null = null;
  let ungatedExecutionImpossibleInTests: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/high-impact-tool-gates-report\.json$/i.test(f)) continue;
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
      highImpactToolsWithConfiguredGatePct = mergeMinNum(
        highImpactToolsWithConfiguredGatePct,
        asNum(data.highImpactToolsWithConfiguredGatePct) ??
          asNum(data.high_impact_tools_with_configured_gate_pct),
      );
      ungatedExecutionImpossibleInTests = mergeAndBool(
        ungatedExecutionImpossibleInTests,
        asBool(data.ungatedExecutionImpossibleInTests) ??
          asBool(data.ungated_execution_impossible_in_tests),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highImpactToolsPresent,
    highImpactToolsWithConfiguredGatePct,
    ungatedExecutionImpossibleInTests,
    measuredAt,
    sources,
  };
}

export function buildHighImpactToolGatesReport(opts: {
  assessedAt: string;
  impactTier: { found: boolean; refs: string[] };
  gateConfig: { found: boolean; refs: string[] };
  imported: HighImpactToolGatesReport["importedResults"];
}): HighImpactToolGatesReport {
  const notes: string[] = [];
  const gateSignalsPresent = opts.impactTier.found || opts.gateConfig.found;
  const surfaceProvedForNaOverride =
    opts.impactTier.found || opts.gateConfig.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No high-impact tool gate signals — TOL-M3 remains not demonstrated until gate coverage or highImpactToolsPresent=false is imported.",
    );
  }
  if (opts.impactTier.found) {
    notes.push(
      `Impact-tier refs: ${opts.impactTier.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.gateConfig.found) {
    notes.push(`Gate-config refs: ${opts.gateConfig.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.highImpactToolsPresent}, gatePct=${opts.imported.highImpactToolsWithConfiguredGatePct}, ungatedImpossible=${opts.imported.ungatedExecutionImpossibleInTests}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import highImpactToolsWithConfiguredGatePct=100 + ungatedExecutionImpossibleInTests=true (measuredAt ≤90d) under imports/high-impact-tool-gates/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride || opts.imported.highImpactToolsPresent === true;
  const gateOk = opts.imported.highImpactToolsWithConfiguredGatePct === 100;
  const bypassOk = opts.imported.ungatedExecutionImpossibleInTests === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.highImpactToolsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.highImpactToolsWithConfiguredGatePct !== null &&
      opts.imported.highImpactToolsWithConfiguredGatePct < 100) ||
    opts.imported.ungatedExecutionImpossibleInTests === false;
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: HighImpactToolGatesReport["summary"]["statusHint"];
  let tolM3Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolM3Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete gate coverage or ungated execution possible — TOL-M3 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolM3Satisfied = null;
    notes.push(
      "Imported highImpactToolsPresent=false — TOL-M3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.highImpactToolsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported highImpactToolsPresent=false ignored — in-repo impact/gate signals prove the surface exists.",
    );
    if (surfacePresent && gateOk && bypassOk && importFresh && opts.imported.found) {
      statusHint = "pass";
      tolM3Satisfied = true;
    } else {
      statusHint = "partial";
      tolM3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolM3Satisfied = null;
  } else if (
    surfacePresent &&
    gateOk &&
    bypassOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolM3Satisfied = true;
  } else {
    statusHint = "partial";
    tolM3Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      impactTier: opts.impactTier,
      gateConfig: opts.gateConfig,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const highImpactToolGatesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const tierRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => IMPACT_TIER_RE.test(p) || IMPACT_TIER_RE.test(t),
      10,
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => GATE_RE.test(p) || GATE_RE.test(t),
      10,
    );

    const report = buildHighImpactToolGatesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      impactTier: { found: tierRefs.length > 0, refs: tierRefs },
      gateConfig: { found: gateRefs.length > 0, refs: gateRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "high-impact-tool-gates-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M3 status=${report.summary.statusHint} satisfied=${report.summary.tolM3Satisfied}; report=imports/${PLUGIN_ID}/high-impact-tool-gates-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/high-impact-tool-gates-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-m3",
            DETECTOR_ID,
            ...(report.summary.tolM3Satisfied ? ["tol-m3-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
