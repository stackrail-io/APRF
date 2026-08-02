/**
 * signed-tool-catalog — TOL-M5 / repo-signed-tool-catalog.
 *
 * Discovers signed tool-catalog / verify-on-load signals.
 * Import coverage under imports/signed-tool-catalog/ unlocks PASS
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
import { collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "signed-tool-catalog";
const RELATED = ["TOL-M5"] as const;
const DETECTOR_ID = "repo-signed-tool-catalog";
const IMPORT_MAX_AGE_DAYS = 90;

const SIGNED_CATALOG_RE =
  /\b(signed[_-]?(tool[_-]?)?catalog|catalog[_-]?sign|mcp[_-]?catalog[_-]?sign|tool[_-]?catalog[_-]?signature)\b/i;
const VERIFY_LOAD_RE =
  /\b(verify[_-]?on[_-]?load|reject[_-]?unsigned|unsigned[_-]?catalog|integrity[_-]?verif.*catalog|unapproved[_-]?catalog)\b/i;

export interface SignedToolCatalogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    signedCatalog: { found: boolean; refs: string[] };
    verifyOnLoad: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionToolCatalogsPresent: boolean | null;
    unsignedOrUnapprovedCatalogsRejected: boolean | null;
    supplyChainReviewWithin90DaysOrSinceLastChange: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolM5Satisfied: boolean | null;
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
): SignedToolCatalogReport["importedResults"] {
  const sources: string[] = [];
  let productionToolCatalogsPresent: boolean | null = null;
  let unsignedOrUnapprovedCatalogsRejected: boolean | null = null;
  let supplyChainReviewWithin90DaysOrSinceLastChange: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/signed-tool-catalog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionToolCatalogsPresent = mergeOrBool(
        productionToolCatalogsPresent,
        asBool(data.productionToolCatalogsPresent) ??
          asBool(data.production_tool_catalogs_present),
      );
      unsignedOrUnapprovedCatalogsRejected = mergeAndBool(
        unsignedOrUnapprovedCatalogsRejected,
        asBool(data.unsignedOrUnapprovedCatalogsRejected) ??
          asBool(data.unsigned_or_unapproved_catalogs_rejected),
      );
      supplyChainReviewWithin90DaysOrSinceLastChange = mergeAndBool(
        supplyChainReviewWithin90DaysOrSinceLastChange,
        asBool(data.supplyChainReviewWithin90DaysOrSinceLastChange) ??
          asBool(data.supply_chain_review_within_90_days_or_since_last_change),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionToolCatalogsPresent,
    unsignedOrUnapprovedCatalogsRejected,
    supplyChainReviewWithin90DaysOrSinceLastChange,
    measuredAt,
    sources,
  };
}

export function buildSignedToolCatalogReport(opts: {
  assessedAt: string;
  signedCatalog: { found: boolean; refs: string[] };
  verifyOnLoad: { found: boolean; refs: string[] };
  imported: SignedToolCatalogReport["importedResults"];
}): SignedToolCatalogReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.signedCatalog.found || opts.verifyOnLoad.found;
  const surfaceProvedForNaOverride =
    opts.signedCatalog.found || opts.verifyOnLoad.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No signed-tool-catalog signals — TOL-M5 remains not demonstrated until reject/review coverage or productionToolCatalogsPresent=false is imported.",
    );
  }
  if (opts.signedCatalog.found) {
    notes.push(
      `Signed-catalog refs: ${opts.signedCatalog.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.verifyOnLoad.found) {
    notes.push(
      `Verify-on-load refs: ${opts.verifyOnLoad.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionToolCatalogsPresent}, rejectUnsigned=${opts.imported.unsignedOrUnapprovedCatalogsRejected}, reviewOk=${opts.imported.supplyChainReviewWithin90DaysOrSinceLastChange}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import unsignedOrUnapprovedCatalogsRejected=true + supplyChainReviewWithin90DaysOrSinceLastChange=true (measuredAt ≤90d) under imports/signed-tool-catalog/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.productionToolCatalogsPresent === true;
  const rejectOk = opts.imported.unsignedOrUnapprovedCatalogsRejected === true;
  const reviewOk =
    opts.imported.supplyChainReviewWithin90DaysOrSinceLastChange === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionToolCatalogsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    opts.imported.unsignedOrUnapprovedCatalogsRejected === false ||
    opts.imported.supplyChainReviewWithin90DaysOrSinceLastChange === false;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: SignedToolCatalogReport["summary"]["statusHint"];
  let tolM5Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolM5Satisfied = false;
    notes.push(
      "Imported evidence shows unsigned catalogs accepted or stale supply-chain review — TOL-M5 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolM5Satisfied = null;
    notes.push(
      "Imported productionToolCatalogsPresent=false — TOL-M5 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionToolCatalogsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionToolCatalogsPresent=false ignored — in-repo signed/verify signals prove the surface exists.",
    );
    if (surfacePresent && rejectOk && reviewOk && importFresh && opts.imported.found) {
      statusHint = "pass";
      tolM5Satisfied = true;
    } else {
      statusHint = "partial";
      tolM5Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolM5Satisfied = null;
  } else if (
    surfacePresent &&
    rejectOk &&
    reviewOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolM5Satisfied = true;
  } else {
    statusHint = "partial";
    tolM5Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      signedCatalog: opts.signedCatalog,
      verifyOnLoad: opts.verifyOnLoad,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolM5Satisfied,
      statusHint,
    },
    notes,
  };
}

export const signedToolCatalogCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const signedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SIGNED_CATALOG_RE.test(p) || SIGNED_CATALOG_RE.test(t),
      10,
    );
    const verifyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => VERIFY_LOAD_RE.test(p) || VERIFY_LOAD_RE.test(t),
      10,
    );

    const report = buildSignedToolCatalogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signedCatalog: { found: signedRefs.length > 0, refs: signedRefs },
      verifyOnLoad: { found: verifyRefs.length > 0, refs: verifyRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "signed-tool-catalog-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M5 status=${report.summary.statusHint} satisfied=${report.summary.tolM5Satisfied}; report=imports/${PLUGIN_ID}/signed-tool-catalog-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/signed-tool-catalog-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-m5",
            DETECTOR_ID,
            ...(report.summary.tolM5Satisfied ? ["tol-m5-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
