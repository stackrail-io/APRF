/**
 * model-license-provenance — MOD-R3 / repo-model-license-provenance.
 *
 * Discovers license+provenance reviews for open-weight/fine-tuned models.
 * Import openWeightOrFineTunedMissingReview=0 +
 * reviewsOlderThan12Months=0 + blockedLicensesMissingException=0 under
 * imports/model-license-provenance/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "model-license-provenance";
const RELATED = ["MOD-R3"] as const;
const DETECTOR_ID = "repo-model-license-provenance";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MODEL_PATH_RE =
  /(model|llm|weights|huggingface|hf|fine[\s_-]*tun|lora|adapter|checkpoint)/i;

const OPEN_WEIGHT_RE =
  /\b(open[\s_-]*weight\w*|open[\s_-]*source[\s_-]*model\w*|self[\s_-]*hosted[\s_-]*model\w*|huggingface|gguf|safetensors|fine[\s_-]*tun\w*|lora)\b/i;

const LICENSE_RE =
  /\b(model[\s_-]*license\w*|license[\s_-]*review\w*|weights[\s_-]*license\w*|apache[\s_-]*2|llama[\s_-]*license|acceptable[\s_-]*use[\s_-]*policy)\b/i;

const PROVENANCE_RE =
  /\b(model[\s_-]*provenance\w*|weight[\s_-]*provenance\w*|training[\s_-]*data[\s_-]*source\w*|model[\s_-]*card\w*|provenance[\s_-]*review\w*)\b/i;

const REVIEW_RE =
  /\b(license[\s_-]*provenance[\s_-]*review\w*|model[\s_-]*license[\s_-]*review\w*|review[\s_-]*checklist\w*|reviewed[\s_-]*at|review[\s_-]*date)\b/i;

export interface ModelLicenseProvenanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    openWeight: { found: boolean; refs: string[] };
    license: { found: boolean; refs: string[] };
    provenance: { found: boolean; refs: string[] };
    review: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    openWeightOrFineTunedMissingReview: number | null;
    reviewsOlderThan12Months: number | null;
    blockedLicensesMissingException: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    reviewSignalsPresent: boolean;
    modR3Satisfied: boolean | null;
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

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
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
    extensions: [
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".tf",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectModelSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        MODEL_PATH_RE.test(path) ||
        OPEN_WEIGHT_RE.test(path) ||
        OPEN_WEIGHT_RE.test(text) ||
        /\b(openai|anthropic|bedrock|vertexai|llm)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ModelLicenseProvenanceReport["importedResults"] {
  const sources: string[] = [];
  let openWeightOrFineTunedMissingReview: number | null = null;
  let reviewsOlderThan12Months: number | null = null;
  let blockedLicensesMissingException: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-license-provenance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      openWeightOrFineTunedMissingReview =
        asNum(data.openWeightOrFineTunedMissingReview) ??
        asNum(data.open_weight_or_fine_tuned_missing_review) ??
        openWeightOrFineTunedMissingReview;
      reviewsOlderThan12Months =
        asNum(data.reviewsOlderThan12Months) ??
        asNum(data.reviews_older_than_12_months) ??
        reviewsOlderThan12Months;
      blockedLicensesMissingException =
        asNum(data.blockedLicensesMissingException) ??
        asNum(data.blocked_licenses_missing_exception) ??
        blockedLicensesMissingException;

      if (asBool(data.allOpenWeightReviewed) === true) {
        openWeightOrFineTunedMissingReview =
          openWeightOrFineTunedMissingReview ?? 0;
        reviewsOlderThan12Months = reviewsOlderThan12Months ?? 0;
      }
      if (asBool(data.blockedLicensesHaveExceptions) === true) {
        blockedLicensesMissingException =
          blockedLicensesMissingException ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    openWeightOrFineTunedMissingReview,
    reviewsOlderThan12Months,
    blockedLicensesMissingException,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelLicenseProvenanceReport(opts: {
  assessedAt: string;
  openWeight: { found: boolean; refs: string[] };
  license: { found: boolean; refs: string[] };
  provenance: { found: boolean; refs: string[] };
  review: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelLicenseProvenanceReport["importedResults"];
}): ModelLicenseProvenanceReport {
  const notes: string[] = [];
  const reviewSignalsPresent =
    opts.openWeight.found ||
    opts.license.found ||
    opts.provenance.found ||
    opts.review.found;

  if (!opts.modelSignals && !reviewSignalsPresent && !opts.imported.found) {
    notes.push(
      "No open-weight/fine-tune/license signals — MOD-R3 may be NOT_APPLICABLE if production uses only hosted proprietary APIs.",
    );
  }
  if (opts.openWeight.found) {
    notes.push(
      `Open-weight/fine-tune refs: ${opts.openWeight.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.license.found) {
    notes.push(`License refs: ${opts.license.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.provenance.found) {
    notes.push(
      `Provenance refs: ${opts.provenance.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.review.found) {
    notes.push(`Review refs: ${opts.review.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingReview=${opts.imported.openWeightOrFineTunedMissingReview}, stale=${opts.imported.reviewsOlderThan12Months}, blockedMissingExc=${opts.imported.blockedLicensesMissingException})`,
    );
  } else if (reviewSignalsPresent) {
    notes.push(
      "Review signals alone are PARTIAL — import openWeightOrFineTunedMissingReview=0, reviewsOlderThan12Months=0, blockedLicensesMissingException=0 (measuredAt ≤90d) under imports/model-license-provenance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.openWeightOrFineTunedMissingReview !== null &&
    opts.imported.openWeightOrFineTunedMissingReview === 0;
  const freshOk =
    opts.imported.reviewsOlderThan12Months !== null &&
    opts.imported.reviewsOlderThan12Months === 0;
  const exceptionOk =
    opts.imported.blockedLicensesMissingException !== null &&
    opts.imported.blockedLicensesMissingException === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelLicenseProvenanceReport["summary"]["statusHint"] =
    "not_demonstrated";
  let modR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.openWeightOrFineTunedMissingReview !== null &&
      opts.imported.openWeightOrFineTunedMissingReview > 0) ||
      (opts.imported.reviewsOlderThan12Months !== null &&
        opts.imported.reviewsOlderThan12Months > 0) ||
      (opts.imported.blockedLicensesMissingException !== null &&
        opts.imported.blockedLicensesMissingException > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.modelSignals && !reviewSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    modR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing/stale reviews, blocked licenses without exceptions, or evidence older than 90 days — MOD-R3 fail.",
    );
  } else if (
    (reviewSignalsPresent || opts.imported.found) &&
    coverageOk &&
    freshOk &&
    exceptionOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modR3Satisfied = true;
  } else if (reviewSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modR3Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show openWeightOrFineTunedMissingReview=0.");
    }
    if (opts.imported.found && !freshOk) {
      notes.push("Import must show reviewsOlderThan12Months=0.");
    }
    if (opts.imported.found && !exceptionOk) {
      notes.push("Import must show blockedLicensesMissingException=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-R3 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modR3Satisfied = null;
    notes.push(
      "Model signals present but no open-weight/fine-tune license+provenance review evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      openWeight: opts.openWeight,
      license: opts.license,
      provenance: opts.provenance,
      review: opts.review,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      reviewSignalsPresent,
      modR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelLicenseProvenanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const openWeightRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => OPEN_WEIGHT_RE.test(path) || OPEN_WEIGHT_RE.test(text),
      12,
    );
    const licenseRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => LICENSE_RE.test(path) || LICENSE_RE.test(text),
      12,
    );
    const provenanceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROVENANCE_RE.test(path) || PROVENANCE_RE.test(text),
      12,
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REVIEW_RE.test(path) || REVIEW_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelLicenseProvenanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      openWeight: { found: openWeightRefs.length > 0, refs: openWeightRefs },
      license: { found: licenseRefs.length > 0, refs: licenseRefs },
      provenance: { found: provenanceRefs.length > 0, refs: provenanceRefs },
      review: { found: reviewRefs.length > 0, refs: reviewRefs },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-license-provenance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-license-provenance-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-license-provenance",
          "mod-r3",
          DETECTOR_ID,
          ...(report.summary.modR3Satisfied ? ["mod-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.openWeight.refs,
        ...report.signals.license.refs,
        ...report.signals.provenance.refs,
        ...report.signals.review.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-license-provenance-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-R3 status=${report.summary.statusHint} review=${report.summary.reviewSignalsPresent} satisfied=${report.summary.modR3Satisfied}; report=imports/${PLUGIN_ID}/model-license-provenance-report.json`,
      nodes,
    };
  },
};
