/**
 * vendor-model-terms — PRI-R2 / repo-vendor-model-terms detector executor.
 *
 * Discovers third-party model provider inventories and DPA/terms reviews for
 * training use + retention. Import under imports/vendor-model-terms/ to PASS.
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

const PLUGIN_ID = "vendor-model-terms";
const RELATED = ["PRI-R2"] as const;
const DETECTOR_ID = "repo-vendor-model-terms";
/** Spec: review ≤12 months. */
const REVIEW_MAX_AGE_DAYS = 365;
/** Inventory attestation freshness. */
const INVENTORY_MAX_AGE_DAYS = 90;

const VENDOR_PATH_RE =
  /(vendor|provider|dpa|dataprocessing|model[\s_-]*provider|llm[\s_-]*vendor|openai|anthropic|bedrock|vertex)/i;

const TERMS_RE =
  /\b(dpa|data[\s_-]*processing[\s_-]*agreement|vendor[\s_-]*terms|processing[\s_-]*terms|sub[\s_-]*processor)\b/i;

const TRAINING_RE =
  /\b(training[\s_-]*use|train[\s_-]*on[\s_-]*customer|opt[\s_-]*out[\s_-]*of[\s_-]*training|model[\s_-]*training[\s_-]*clause)\b/i;

const RETENTION_RE =
  /\b(retention|retain(?:ed|s)?|data[\s_-]*retention|deletion[\s_-]*period|log[\s_-]*retention)\b/i;

export interface VendorModelTermsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    inventoryOrTerms: { found: boolean; refs: string[] };
    trainingUse: { found: boolean; refs: string[] };
    retention: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    providerCount: number | null;
    coversAllProductionProviders: boolean | null;
    unreviewedProviderCount: number | null;
    staleReviewCount: number | null;
    missingTrainingUseCount: number | null;
    missingRetentionCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    providerSignalsPresent: boolean;
    termsSignalsPresent: boolean;
    priR2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectProviderSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        VENDOR_PATH_RE.test(path) ||
        TERMS_RE.test(text) ||
        /\b(openai|anthropic|bedrock|vertex[\s_-]*ai|azure[\s_-]*openai)\b/i.test(
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
): VendorModelTermsReport["importedResults"] {
  const sources: string[] = [];
  let providerCount: number | null = null;
  let coversAllProductionProviders: boolean | null = null;
  let unreviewedProviderCount: number | null = null;
  let staleReviewCount: number | null = null;
  let missingTrainingUseCount: number | null = null;
  let missingRetentionCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/vendor-model-terms-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      providerCount =
        asNum(data.providerCount) ?? asNum(data.vendorCount) ?? providerCount;
      coversAllProductionProviders =
        asBool(data.coversAllProductionProviders) ??
        asBool(data.coversAllProviders) ??
        coversAllProductionProviders;
      unreviewedProviderCount =
        asNum(data.unreviewedProviderCount) ??
        asNum(data.unreviewedCount) ??
        unreviewedProviderCount;
      staleReviewCount =
        asNum(data.staleReviewCount) ??
        asNum(data.reviewsOlderThan12MonthsCount) ??
        staleReviewCount;
      missingTrainingUseCount =
        asNum(data.missingTrainingUseCount) ?? missingTrainingUseCount;
      missingRetentionCount =
        asNum(data.missingRetentionCount) ?? missingRetentionCount;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const providers = Array.isArray(data.providers)
        ? (data.providers as Array<Record<string, unknown>>)
        : Array.isArray(data.vendors)
          ? (data.vendors as Array<Record<string, unknown>>)
          : [];
      if (providers.length > 0) {
        providerCount = providers.length;
        let unreviewed = 0;
        let stale = 0;
        let missTrain = 0;
        let missRet = 0;
        for (const p of providers) {
          const reviewedFlag =
            asBool(p.reviewed) ?? asBool(p.hasReview);
          const reviewedAt = parseMeasuredAt({
            measuredAt: p.reviewedAt ?? p.reviewDate ?? p.lastReviewed,
          } as Record<string, unknown>);
          const reviewed =
            reviewedFlag === true ||
            (reviewedFlag == null && !!reviewedAt) ||
            (reviewedFlag == null &&
              typeof p.reviewDate === "string" &&
              !!p.reviewDate.trim());
          const training =
            asBool(p.trainingUseCovered) ??
            asBool(p.coversTrainingUse) ??
            (typeof p.trainingUse === "string" && !!p.trainingUse.trim());
          const retention =
            asBool(p.retentionCovered) ??
            asBool(p.coversRetention) ??
            (typeof p.retention === "string" && !!p.retention.trim());
          if (!reviewed) unreviewed += 1;
          if (!training) missTrain += 1;
          if (!retention) missRet += 1;

          const within12 =
            asBool(p.reviewedWithin12Months) ?? asBool(p.reviewWithin12Months);
          const freshReview =
            within12 === true ||
            (within12 == null &&
              !!reviewedAt &&
              measuredAtFresh(reviewedAt, new Date(), REVIEW_MAX_AGE_DAYS));
          // Unknown or stale review date counts as stale for reviewed providers.
          if (reviewed && (within12 === false || p.stale === true || !freshReview)) {
            stale += 1;
          }
        }
        unreviewedProviderCount = unreviewed;
        staleReviewCount = stale;
        missingTrainingUseCount = missTrain;
        missingRetentionCount = missRet;
        if (coversAllProductionProviders == null) {
          coversAllProductionProviders = true;
        }
      }

      if (
        asBool(data.allProvidersReviewedFresh) === true &&
        unreviewedProviderCount == null
      ) {
        unreviewedProviderCount = 0;
        staleReviewCount = 0;
        missingTrainingUseCount = 0;
        missingRetentionCount = 0;
        coversAllProductionProviders =
          coversAllProductionProviders ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    providerCount,
    coversAllProductionProviders,
    unreviewedProviderCount,
    staleReviewCount,
    missingTrainingUseCount,
    missingRetentionCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildVendorModelTermsReport(opts: {
  assessedAt: string;
  signals: VendorModelTermsReport["signals"];
  providerSignals: boolean;
  imported: VendorModelTermsReport["importedResults"];
}): VendorModelTermsReport {
  const notes: string[] = [];
  const termsSignalsPresent =
    opts.signals.inventoryOrTerms.found ||
    (opts.signals.trainingUse.found && opts.signals.retention.found);

  if (!opts.providerSignals && !termsSignalsPresent && !opts.imported.found) {
    notes.push(
      "No third-party model-provider signals — PRI-R2 may be NOT_APPLICABLE if all models are self-hosted with no vendor processing.",
    );
  }
  if (opts.signals.inventoryOrTerms.found) {
    notes.push(
      `Terms/inventory refs: ${opts.signals.inventoryOrTerms.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (providers=${opts.imported.providerCount}, coversAll=${opts.imported.coversAllProductionProviders}, unreviewed=${opts.imported.unreviewedProviderCount}, stale=${opts.imported.staleReviewCount}, missTrain=${opts.imported.missingTrainingUseCount}, missRet=${opts.imported.missingRetentionCount}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (termsSignalsPresent) {
    notes.push(
      "Terms signals alone are PARTIAL — import complete provider inventory (training+retention reviews ≤12mo) under imports/vendor-model-terms/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= INVENTORY_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    INVENTORY_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.coversAllProductionProviders === true &&
    opts.imported.unreviewedProviderCount === 0 &&
    opts.imported.staleReviewCount === 0 &&
    opts.imported.missingTrainingUseCount === 0 &&
    opts.imported.missingRetentionCount === 0 &&
    ageOk &&
    importFresh;

  let statusHint: VendorModelTermsReport["summary"]["statusHint"];
  let priR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllProductionProviders === false ||
      (opts.imported.unreviewedProviderCount !== null &&
        opts.imported.unreviewedProviderCount > 0) ||
      (opts.imported.staleReviewCount !== null &&
        opts.imported.staleReviewCount > 0) ||
      (opts.imported.missingTrainingUseCount !== null &&
        opts.imported.missingTrainingUseCount > 0) ||
      (opts.imported.missingRetentionCount !== null &&
        opts.imported.missingRetentionCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.providerSignals &&
    !opts.signals.inventoryOrTerms.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priR2Satisfied = false;
    notes.push(
      "Imported inventory shows unreviewed/stale providers, missing training/retention coverage, or inventory older than 90 days — PRI-R2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priR2Satisfied = true;
    if ((opts.imported.providerCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllProductionProviders with zero providers — confirm no third-party model processing.",
      );
    }
  } else if (
    opts.signals.inventoryOrTerms.found ||
    opts.signals.trainingUse.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priR2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllProductionProviders !== true) {
        notes.push("Import must show coversAllProductionProviders=true.");
      }
      if (opts.imported.unreviewedProviderCount !== 0) {
        notes.push("Import must show unreviewedProviderCount=0.");
      }
      if (opts.imported.staleReviewCount !== 0) {
        notes.push("Import must show staleReviewCount=0 (reviews ≤12 months).");
      }
      if (
        opts.imported.missingTrainingUseCount !== 0 ||
        opts.imported.missingRetentionCount !== 0
      ) {
        notes.push(
          "Import must show missingTrainingUseCount and missingRetentionCount = 0.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-R2 PASS.",
        );
      }
    }
  } else if (opts.providerSignals) {
    statusHint = "not_demonstrated";
    priR2Satisfied = null;
    notes.push(
      "Provider signals present but no DPA/terms review covering training use and retention found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      providerSignalsPresent: opts.providerSignals,
      termsSignalsPresent,
      priR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const vendorModelTermsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const providerSignals = detectProviderSignals(ctx.targetPath, maxFiles);

    const inVendorContext = (path: string, text: string) =>
      VENDOR_PATH_RE.test(path) ||
      TERMS_RE.test(path) ||
      TERMS_RE.test(text) ||
      VENDOR_PATH_RE.test(text);

    const termsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TERMS_RE.test(path) || TERMS_RE.test(text) || VENDOR_PATH_RE.test(path)) &&
        inVendorContext(path, text),
    );
    const trainingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TRAINING_RE.test(path) || TRAINING_RE.test(text)) &&
        inVendorContext(path, text),
      12,
    );
    const retentionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RETENTION_RE.test(path) || RETENTION_RE.test(text)) &&
        inVendorContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildVendorModelTermsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        inventoryOrTerms: {
          found: termsRefs.length > 0,
          refs: termsRefs,
        },
        trainingUse: {
          found: trainingRefs.length > 0,
          refs: trainingRefs,
        },
        retention: {
          found: retentionRefs.length > 0,
          refs: retentionRefs,
        },
      },
      providerSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "vendor-model-terms-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/vendor-model-terms-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "vendor-model-terms",
          "pri-r2",
          DETECTOR_ID,
          ...(report.summary.termsSignalsPresent ? ["vendor-terms-signals"] : []),
          ...(report.summary.priR2Satisfied ? ["pri-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...termsRefs.slice(0, 2),
        ...trainingRefs.slice(0, 1),
        ...retentionRefs.slice(0, 1),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["vendor-model-terms-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-R2 status=${report.summary.statusHint} terms=${report.summary.termsSignalsPresent} satisfied=${report.summary.priR2Satisfied}; report=imports/${PLUGIN_ID}/vendor-model-terms-report.json`,
      nodes,
    };
  },
};
