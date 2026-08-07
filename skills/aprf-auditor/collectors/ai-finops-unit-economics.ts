/**
 * ai-finops-unit-economics — COST-R3 / repo-finops-unit-economics executor.
 *
 * Discovers unit-cost / FinOps product economics signals. Import quarterly
 * metrics + review minutes under imports/ai-finops-unit-economics/ to PASS.
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

const PLUGIN_ID = "ai-finops-unit-economics";
const RELATED = ["COST-R3"] as const;
const DETECTOR_ID = "repo-finops-unit-economics";

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|finops|token)/i;

const UNIT_ECON_RE =
  /\b(unit[_-]?econ|cost[_-]?per[_-]?(task|journey|request|session|success)|cost[_-]?per[_-]?successful|ai[_-]?unit[_-]?cost|product[_-]?unit[_-]?cost|finops)\b/i;

const REVIEW_RE =
  /\b(finops[_-]?review|cost[_-]?review|unit[_-]?econ(?:omics)?[_-]?review|quarterly[_-]?cost|outlier[_-]?(owner|threshold))\b/i;

export interface AiFinopsUnitEconomicsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  unitMetrics: { found: boolean; refs: string[] };
  reviewSignals: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    unitMetricsPresent: boolean | null;
    coversCustomerFacingProducts: boolean | null;
    reviewOccurred: boolean | null;
    outliersHaveOwners: boolean | null;
    quarterCovered: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    metricsPresent: boolean;
    costR3Satisfied: boolean | null;
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
): AiFinopsUnitEconomicsReport["importedResults"] {
  const sources: string[] = [];
  let unitMetricsPresent: boolean | null = null;
  let coversCustomerFacingProducts: boolean | null = null;
  let reviewOccurred: boolean | null = null;
  let outliersHaveOwners: boolean | null = null;
  let quarterCovered: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-finops-unit-economics-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      unitMetricsPresent =
        asBool(data.unitMetricsPresent) ??
        asBool(data.hasUnitMetrics) ??
        asBool(data.unitEconomicsPresent) ??
        unitMetricsPresent;
      coversCustomerFacingProducts =
        asBool(data.coversCustomerFacingProducts) ??
        asBool(data.coversAllProducts) ??
        asBool(data.allProductsCovered) ??
        coversCustomerFacingProducts;
      reviewOccurred =
        asBool(data.reviewOccurred) ??
        asBool(data.finopsReviewOk) ??
        asBool(data.reviewComplete) ??
        reviewOccurred;
      outliersHaveOwners =
        asBool(data.outliersHaveOwners) ??
        asBool(data.outlierOwnersAssigned) ??
        asBool(data.ownersForOutliers) ??
        outliersHaveOwners;
      quarterCovered =
        asBool(data.quarterCovered) ??
        asBool(data.lastQuarterMetrics) ??
        (asNum(data.daysCovered) !== null &&
        (asNum(data.daysCovered) as number) >= 90
          ? true
          : null) ??
        quarterCovered;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (Array.isArray(data.products) && data.products.length > 0) {
        unitMetricsPresent = unitMetricsPresent ?? true;
        const products = data.products as Array<Record<string, unknown>>;
        const allHaveMetric = products.every(
          (p) =>
            asNum(p.costPerTask) !== null ||
            asNum(p.costPerJourney) !== null ||
            asNum(p.unitCost) !== null ||
            asBool(p.hasUnitMetric) === true,
        );
        if (allHaveMetric) unitMetricsPresent = true;
        coversCustomerFacingProducts =
          coversCustomerFacingProducts ?? allHaveMetric;
      }
      if (Array.isArray(data.outliers)) {
        const outliers = data.outliers as Array<Record<string, unknown>>;
        if (outliers.length === 0) {
          outliersHaveOwners = outliersHaveOwners ?? true;
        } else {
          outliersHaveOwners = outliers.every(
            (o) =>
              typeof o.owner === "string" &&
              (o.owner as string).trim().length > 0,
          );
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    unitMetricsPresent,
    coversCustomerFacingProducts,
    reviewOccurred,
    outliersHaveOwners,
    quarterCovered,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiFinopsUnitEconomicsReport(opts: {
  assessedAt: string;
  metrics: { found: boolean; refs: string[] };
  reviews: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiFinopsUnitEconomicsReport["importedResults"];
}): AiFinopsUnitEconomicsReport {
  const notes: string[] = [];
  const metricsPresent =
    opts.metrics.found || opts.imported.unitMetricsPresent === true;

  if (
    !opts.aiSignals &&
    !metricsPresent &&
    !opts.reviews.found &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI/FinOps unit-economics signals — COST-R3 may be NOT_APPLICABLE if there are no customer-facing AI products.",
    );
  }
  if (opts.metrics.found) {
    notes.push(`Unit-metrics refs: ${opts.metrics.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No unit-cost / FinOps metrics signals found.");
  }
  if (opts.reviews.found) {
    notes.push(`Review-signal refs: ${opts.reviews.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (metrics=${opts.imported.unitMetricsPresent}, products=${opts.imported.coversCustomerFacingProducts}, review=${opts.imported.reviewOccurred}, owners=${opts.imported.outliersHaveOwners}, quarter=${opts.imported.quarterCovered}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (metricsPresent || opts.reviews.found) {
    notes.push(
      "Metrics/review signals alone are PARTIAL — import quarterly report + FinOps minutes under imports/ai-finops-unit-economics/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const reportOk =
    opts.imported.unitMetricsPresent === true &&
    opts.imported.coversCustomerFacingProducts === true &&
    opts.imported.quarterCovered === true &&
    opts.imported.reviewOccurred === true &&
    opts.imported.outliersHaveOwners === true &&
    ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiFinopsUnitEconomicsReport["summary"]["statusHint"];
  let costR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.unitMetricsPresent === false ||
      opts.imported.coversCustomerFacingProducts === false ||
      opts.imported.quarterCovered === false ||
      opts.imported.reviewOccurred === false ||
      opts.imported.outliersHaveOwners === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.metrics.found &&
    !opts.reviews.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    costR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costR3Satisfied = false;
    notes.push(
      "Imported results show missing unit metrics, incomplete product coverage, no review, missing outlier owners, or stale evidence — COST-R3 fail.",
    );
  } else if (reportOk && importFresh) {
    statusHint = "pass";
    costR3Satisfied = true;
  } else if (
    opts.metrics.found ||
    opts.reviews.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costR3Satisfied = false;
    if (opts.imported.found && !reportOk) {
      notes.push(
        "Import must set unitMetricsPresent, coversCustomerFacingProducts, quarterCovered, reviewOccurred, outliersHaveOwners=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-R3 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costR3Satisfied = null;
    notes.push(
      "AI signals present but no unit-economics metrics or FinOps review evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    unitMetrics: opts.metrics,
    reviewSignals: opts.reviews,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      metricsPresent,
      costR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiFinopsUnitEconomicsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const metricRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!UNIT_ECON_RE.test(path) && !UNIT_ECON_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          UNIT_ECON_RE.test(path)
        );
      },
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        REVIEW_RE.test(path) ||
        (REVIEW_RE.test(text) &&
          (UNIT_ECON_RE.test(text) || AI_PATH_RE.test(text))),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiFinopsUnitEconomicsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      metrics: { found: metricRefs.length > 0, refs: metricRefs },
      reviews: { found: reviewRefs.length > 0, refs: reviewRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-finops-unit-economics-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-finops-unit-economics-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-finops-unit-economics",
          "cost-r3",
          DETECTOR_ID,
          ...(report.summary.metricsPresent ? ["unit-economics-metrics"] : []),
          ...(report.summary.costR3Satisfied ? ["cost-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([...metricRefs.slice(0, 4), ...reviewRefs.slice(0, 2)]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-finops-unit-economics-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-R3 status=${report.summary.statusHint} metrics=${report.summary.metricsPresent} satisfied=${report.summary.costR3Satisfied}; report=imports/${PLUGIN_ID}/ai-finops-unit-economics-report.json`,
      nodes,
    };
  },
};
