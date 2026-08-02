/**
 * destructive-tool-dry-run — TOL-R1 / repo-destructive-tool-dry-run.
 *
 * Discovers dry-run/simulation flags for destructive tools.
 * Import coverage under imports/destructive-tool-dry-run/ unlocks PASS
 * (inventory 100% + dry-run 100% + promotion evidence; measuredAt ≤90d).
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

const PLUGIN_ID = "destructive-tool-dry-run";
const RELATED = ["TOL-R1"] as const;
const DETECTOR_ID = "repo-destructive-tool-dry-run";
const IMPORT_MAX_AGE_DAYS = 90;

const DRY_RUN_RE =
  /\b(dry[_-]?run|simulation[_-]?mode|simulate[_-]?tool|dryRun)\b/i;
const DESTRUCTIVE_RE =
  /\b(destructive[_-]?tool|delete[_-]?tool|irreversible.{0,40}tool|destructive.{0,40}catalog)\b/i;

export interface DestructiveToolDryRunReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    dryRun: { found: boolean; refs: string[] };
    destructiveTool: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    destructiveToolsPresent: boolean | null;
    destructiveToolsInventoriedPct: number | null;
    destructiveToolsWithDryRunInNonProdPct: number | null;
    lastDestructivePromotionHasDryRunEvidenceWithin90Days: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolR1Satisfied: boolean | null;
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
): DestructiveToolDryRunReport["importedResults"] {
  const sources: string[] = [];
  let destructiveToolsPresent: boolean | null = null;
  let destructiveToolsInventoriedPct: number | null = null;
  let destructiveToolsWithDryRunInNonProdPct: number | null = null;
  let lastDestructivePromotionHasDryRunEvidenceWithin90Days: boolean | null =
    null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/destructive-tool-dry-run-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      destructiveToolsPresent = mergeOrBool(
        destructiveToolsPresent,
        asBool(data.destructiveToolsPresent) ??
          asBool(data.destructive_tools_present),
      );
      destructiveToolsInventoriedPct = mergeMinNum(
        destructiveToolsInventoriedPct,
        asNum(data.destructiveToolsInventoriedPct) ??
          asNum(data.destructive_tools_inventoried_pct) ??
          asNum(data.inventoryCoveragePct),
      );
      destructiveToolsWithDryRunInNonProdPct = mergeMinNum(
        destructiveToolsWithDryRunInNonProdPct,
        asNum(data.destructiveToolsWithDryRunInNonProdPct) ??
          asNum(data.destructive_tools_with_dry_run_in_non_prod_pct),
      );
      lastDestructivePromotionHasDryRunEvidenceWithin90Days = mergeAndBool(
        lastDestructivePromotionHasDryRunEvidenceWithin90Days,
        asBool(data.lastDestructivePromotionHasDryRunEvidenceWithin90Days) ??
          asBool(
            data.last_destructive_promotion_has_dry_run_evidence_within_90_days,
          ),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    destructiveToolsPresent,
    destructiveToolsInventoriedPct,
    destructiveToolsWithDryRunInNonProdPct,
    lastDestructivePromotionHasDryRunEvidenceWithin90Days,
    measuredAt,
    sources,
  };
}

export function buildDestructiveToolDryRunReport(opts: {
  assessedAt: string;
  dryRun: { found: boolean; refs: string[] };
  destructiveTool: { found: boolean; refs: string[] };
  imported: DestructiveToolDryRunReport["importedResults"];
}): DestructiveToolDryRunReport {
  const notes: string[] = [];
  const gateSignalsPresent = opts.dryRun.found || opts.destructiveTool.found;
  const surfaceProvedForNaOverride =
    opts.dryRun.found || opts.destructiveTool.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No destructive-tool dry-run signals — TOL-R1 remains not demonstrated until inventory/dry-run/promotion coverage or destructiveToolsPresent=false is imported.",
    );
  }
  if (opts.dryRun.found) {
    notes.push(`Dry-run refs: ${opts.dryRun.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.destructiveTool.found) {
    notes.push(
      `Destructive-tool refs: ${opts.destructiveTool.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.destructiveToolsPresent}, inventoriedPct=${opts.imported.destructiveToolsInventoriedPct}, dryRunPct=${opts.imported.destructiveToolsWithDryRunInNonProdPct}, promotionEvidence=${opts.imported.lastDestructivePromotionHasDryRunEvidenceWithin90Days}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import destructiveToolsInventoriedPct=100 + destructiveToolsWithDryRunInNonProdPct=100 + lastDestructivePromotionHasDryRunEvidenceWithin90Days=true (measuredAt ≤90d) under imports/destructive-tool-dry-run/ to PASS. Promotion evidence without destructive-tool inventory ≠ PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.destructiveToolsPresent === true;
  const inventoryOk = opts.imported.destructiveToolsInventoriedPct === 100;
  const dryRunOk = opts.imported.destructiveToolsWithDryRunInNonProdPct === 100;
  const promotionOk =
    opts.imported.lastDestructivePromotionHasDryRunEvidenceWithin90Days ===
    true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.destructiveToolsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.destructiveToolsInventoriedPct !== null &&
      opts.imported.destructiveToolsInventoriedPct < 100) ||
    (opts.imported.destructiveToolsWithDryRunInNonProdPct !== null &&
      opts.imported.destructiveToolsWithDryRunInNonProdPct < 100) ||
    opts.imported.lastDestructivePromotionHasDryRunEvidenceWithin90Days ===
      false;
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: DestructiveToolDryRunReport["summary"]["statusHint"];
  let tolR1Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolR1Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete inventory, dry-run coverage, or missing promotion evidence — TOL-R1 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolR1Satisfied = null;
    notes.push(
      "Imported destructiveToolsPresent=false — TOL-R1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.destructiveToolsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported destructiveToolsPresent=false ignored — in-repo dry-run/destructive signals prove the surface exists.",
    );
    if (
      surfacePresent &&
      inventoryOk &&
      dryRunOk &&
      promotionOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      tolR1Satisfied = true;
    } else {
      statusHint = "partial";
      tolR1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolR1Satisfied = null;
  } else if (
    surfacePresent &&
    inventoryOk &&
    dryRunOk &&
    promotionOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolR1Satisfied = true;
  } else {
    statusHint = "partial";
    tolR1Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      dryRun: opts.dryRun,
      destructiveTool: opts.destructiveTool,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const destructiveToolDryRunCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const dryRunRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DRY_RUN_RE.test(p) || DRY_RUN_RE.test(t),
      10,
    );
    const destructiveRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DESTRUCTIVE_RE.test(p) || DESTRUCTIVE_RE.test(t),
      10,
    );

    const report = buildDestructiveToolDryRunReport({
      assessedAt: ctx.assessedAt.toISOString(),
      dryRun: { found: dryRunRefs.length > 0, refs: dryRunRefs },
      destructiveTool: {
        found: destructiveRefs.length > 0,
        refs: destructiveRefs,
      },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "destructive-tool-dry-run-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-R1 status=${report.summary.statusHint} satisfied=${report.summary.tolR1Satisfied}; report=imports/${PLUGIN_ID}/destructive-tool-dry-run-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/destructive-tool-dry-run-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-r1",
            DETECTOR_ID,
            ...(report.summary.tolR1Satisfied ? ["tol-r1-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
