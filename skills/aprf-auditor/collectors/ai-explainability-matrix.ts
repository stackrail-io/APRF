/**
 * ai-explainability-matrix — EXP-R2 / repo-ai-explainability-matrix.
 *
 * Discovers regulated-feature explainability requirements matrices + reviews.
 * Import explainabilityMatrixConfigured +
 * regulatedFeaturesWithExplanationRequirementPct=100 +
 * matrixReviewedWithin12MonthsWithNamedOwner under
 * imports/ai-explainability-matrix/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-explainability-matrix";
const RELATED = ["EXP-R2"] as const;
const DETECTOR_ID = "repo-ai-explainability-matrix";
const IMPORT_MAX_AGE_DAYS = 90;

const MATRIX_RE =
  /\b(explainability[_-]?(matrix|requirements)|explanation[_-]?requirements[_-]?matrix|feature[_-]?(x|×|by)[_-]?(regulation|obligation)|regulated[_-]?feature[_-]?explain)\b/i;

const REGULATED_RE =
  /\b(regulated[_-]?(ai|feature|system)|compliance[_-]?(obligation|control)|eu[_-]?ai[_-]?act|high[_-]?risk[_-]?ai)\b/i;

const REVIEW_RE =
  /\b(matrix[_-]?review|compliance[_-]?review|reviewed[_-]?(at|on|by)|review[_-]?owner|annual[_-]?review)\b/i;

export interface AiExplainabilityMatrixReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    matrix: { found: boolean; refs: string[] };
    regulated: { found: boolean; refs: string[] };
    review: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    explainabilityMatrixConfigured: boolean | null;
    regulatedFeaturesWithExplanationRequirementPct: number | null;
    matrixReviewedWithin12MonthsWithNamedOwner: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    matrixSignalsPresent: boolean;
    expR2Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".pdf", ".csv"],
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

function loadImported(
  ctx: CollectorContext,
): AiExplainabilityMatrixReport["importedResults"] {
  const sources: string[] = [];
  let explainabilityMatrixConfigured: boolean | null = null;
  let regulatedFeaturesWithExplanationRequirementPct: number | null = null;
  let matrixReviewedWithin12MonthsWithNamedOwner: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-explainability-matrix-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      explainabilityMatrixConfigured =
        asBool(data.explainabilityMatrixConfigured) ??
        asBool(data.explainability_matrix_configured) ??
        asBool(data.matrixConfigured) ??
        asBool(data.requirementsMatrixConfigured) ??
        explainabilityMatrixConfigured;
      regulatedFeaturesWithExplanationRequirementPct =
        asNum(data.regulatedFeaturesWithExplanationRequirementPct) ??
        asNum(data.regulated_features_with_explanation_requirement_pct) ??
        asNum(data.regulatedFeatureCoveragePct) ??
        asNum(data.matrixCoveragePct) ??
        regulatedFeaturesWithExplanationRequirementPct;
      matrixReviewedWithin12MonthsWithNamedOwner =
        asBool(data.matrixReviewedWithin12MonthsWithNamedOwner) ??
        asBool(data.matrix_reviewed_within_12_months_with_named_owner) ??
        asBool(data.matrixReviewedWithin12Months) ??
        asBool(data.reviewFreshWithOwner) ??
        matrixReviewedWithin12MonthsWithNamedOwner;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    explainabilityMatrixConfigured,
    regulatedFeaturesWithExplanationRequirementPct,
    matrixReviewedWithin12MonthsWithNamedOwner,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiExplainabilityMatrixReport(opts: {
  assessedAt: string;
  matrix: { found: boolean; refs: string[] };
  regulated: { found: boolean; refs: string[] };
  review: { found: boolean; refs: string[] };
  imported: AiExplainabilityMatrixReport["importedResults"];
}): AiExplainabilityMatrixReport {
  const notes: string[] = [];
  const matrixSignalsPresent =
    opts.matrix.found || opts.regulated.found || opts.review.found;

  if (!matrixSignalsPresent && !opts.imported.found) {
    notes.push(
      "No explainability-matrix signals — EXP-R2 may be NOT_APPLICABLE if there are no regulated AI features.",
    );
  }
  if (opts.matrix.found) {
    notes.push(`Matrix refs: ${opts.matrix.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.regulated.found) {
    notes.push(
      `Regulated-feature refs: ${opts.regulated.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.review.found) {
    notes.push(`Review refs: ${opts.review.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (matrix=${opts.imported.explainabilityMatrixConfigured}, coveragePct=${opts.imported.regulatedFeaturesWithExplanationRequirementPct}, reviewed=${opts.imported.matrixReviewedWithin12MonthsWithNamedOwner})`,
    );
  } else if (matrixSignalsPresent) {
    notes.push(
      "Matrix signals alone are PARTIAL — import explainabilityMatrixConfigured=true + regulatedFeaturesWithExplanationRequirementPct=100 + matrixReviewedWithin12MonthsWithNamedOwner=true (measuredAt ≤90d) under imports/ai-explainability-matrix/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const matrixOk = opts.imported.explainabilityMatrixConfigured === true;
  const coverageOk =
    opts.imported.regulatedFeaturesWithExplanationRequirementPct === 100;
  const reviewOk =
    opts.imported.matrixReviewedWithin12MonthsWithNamedOwner === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiExplainabilityMatrixReport["summary"]["statusHint"];
  let expR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.explainabilityMatrixConfigured === false ||
      (opts.imported.regulatedFeaturesWithExplanationRequirementPct !==
        null &&
        opts.imported.regulatedFeaturesWithExplanationRequirementPct < 100) ||
      opts.imported.matrixReviewedWithin12MonthsWithNamedOwner === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!matrixSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing matrix, coverage <100%, review older than 12 months / missing owner, or attest older than 90 days — EXP-R2 fail.",
    );
  } else if (
    (matrixSignalsPresent || opts.imported.found) &&
    matrixOk &&
    coverageOk &&
    reviewOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expR2Satisfied = true;
  } else if (matrixSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expR2Satisfied = false;
    if (opts.imported.found && !matrixOk) {
      notes.push("Import must show explainabilityMatrixConfigured=true.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show regulatedFeaturesWithExplanationRequirementPct=100.",
      );
    }
    if (opts.imported.found && !reviewOk) {
      notes.push(
        "Import must show matrixReviewedWithin12MonthsWithNamedOwner=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      matrix: opts.matrix,
      regulated: opts.regulated,
      review: opts.review,
    },
    importedResults: opts.imported,
    summary: {
      matrixSignalsPresent,
      expR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiExplainabilityMatrixCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const matrixRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MATRIX_RE.test(path) || MATRIX_RE.test(text),
      10,
    );
    const regulatedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REGULATED_RE.test(path) || REGULATED_RE.test(text),
      10,
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        REVIEW_RE.test(path) ||
        (/(review|compliance|audit)/i.test(path) &&
          (REVIEW_RE.test(text) || MATRIX_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiExplainabilityMatrixReport({
      assessedAt: ctx.assessedAt.toISOString(),
      matrix: { found: matrixRefs.length > 0, refs: matrixRefs },
      regulated: { found: regulatedRefs.length > 0, refs: regulatedRefs },
      review: { found: reviewRefs.length > 0, refs: reviewRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-explainability-matrix-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-explainability-matrix-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-explainability-matrix",
          "exp-r2",
          DETECTOR_ID,
          ...(report.summary.expR2Satisfied ? ["exp-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.matrix.refs,
        ...report.signals.regulated.refs,
        ...report.signals.review.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-explainability-matrix-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-R2 status=${report.summary.statusHint} signals=${report.summary.matrixSignalsPresent} satisfied=${report.summary.expR2Satisfied}; report=imports/${PLUGIN_ID}/ai-explainability-matrix-report.json`,
      nodes,
    };
  },
};
