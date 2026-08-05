/**
 * eval-human-review — EVL-R2 / repo-eval-human-review.
 *
 * Discovers human preference / expert-review sampling on a defined cadence.
 * Import cadenceAndSampleSizeDefined + lastSampleAgeDays≤90 +
 * productionLikeCoverage + disagreementsMissingAdjudication=0 under
 * imports/eval-human-review/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "eval-human-review";
const RELATED = ["EVL-R2"] as const;
const DETECTOR_ID = "repo-eval-human-review";
const IMPORT_MAX_AGE_DAYS = 90;

const AI_PATH_RE =
  /(eval|evals|review|preference|annotat|label|rater|human)/i;

const PROTOCOL_RE =
  /\b(human[\s_-]*(preference|eval|review)|expert[\s_-]*review|preference[\s_-]*(sampling|label|eval)|inter[\s_-]*rater|sampling[\s_-]*(protocol|cadence|plan))\b/i;

const CADENCE_RE =
  /\b(cadence|sample[\s_-]*size|n\s*=\s*\d+|every[\s_-]*(week|month|sprint)|weekly|monthly|quarterly)\b/i;

const ADJUDICATION_RE =
  /\b(adjudicat|disagreement|tie[\s_-]*break|consensus|rater[\s_-]*agreement|cohen|kappa)\b/i;

export interface EvalHumanReviewReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    protocol: { found: boolean; refs: string[] };
    cadence: { found: boolean; refs: string[] };
    adjudication: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    cadenceAndSampleSizeDefined: boolean | null;
    lastSampleAgeDays: number | null;
    productionLikeCoverage: boolean | null;
    disagreementsMissingAdjudication: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    reviewSignalsPresent: boolean;
    evlR2Satisfied: boolean | null;
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
    ],
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
        /\b(promptfoo|openai|anthropic|llm|eval[\s_-]*suite)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalHumanReviewReport["importedResults"] {
  const sources: string[] = [];
  let cadenceAndSampleSizeDefined: boolean | null = null;
  let lastSampleAgeDays: number | null = null;
  let productionLikeCoverage: boolean | null = null;
  let disagreementsMissingAdjudication: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-human-review-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      cadenceAndSampleSizeDefined =
        asBool(data.cadenceAndSampleSizeDefined) ??
        asBool(data.cadence_and_sample_size_defined) ??
        cadenceAndSampleSizeDefined;
      lastSampleAgeDays =
        asNum(data.lastSampleAgeDays) ??
        asNum(data.last_sample_age_days) ??
        lastSampleAgeDays;
      productionLikeCoverage =
        asBool(data.productionLikeCoverage) ??
        asBool(data.production_like_coverage) ??
        asBool(data.coversProductionLikePrompts) ??
        productionLikeCoverage;
      disagreementsMissingAdjudication =
        asNum(data.disagreementsMissingAdjudication) ??
        asNum(data.disagreements_missing_adjudication) ??
        disagreementsMissingAdjudication;

      if (asBool(data.adjudicationRecorded) === true) {
        disagreementsMissingAdjudication =
          disagreementsMissingAdjudication ?? 0;
      }
      if (
        asBool(data.coversHumanReviewSampling) === true &&
        cadenceAndSampleSizeDefined === null &&
        productionLikeCoverage === null &&
        disagreementsMissingAdjudication === null
      ) {
        cadenceAndSampleSizeDefined = true;
        productionLikeCoverage = true;
        disagreementsMissingAdjudication = 0;
        if (lastSampleAgeDays === null) lastSampleAgeDays = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    cadenceAndSampleSizeDefined,
    lastSampleAgeDays,
    productionLikeCoverage,
    disagreementsMissingAdjudication,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalHumanReviewReport(opts: {
  assessedAt: string;
  protocol: { found: boolean; refs: string[] };
  cadence: { found: boolean; refs: string[] };
  adjudication: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: EvalHumanReviewReport["importedResults"];
}): EvalHumanReviewReport {
  const notes: string[] = [];
  const reviewSignalsPresent =
    opts.protocol.found || opts.cadence.found || opts.adjudication.found;

  if (!opts.aiSignals && !reviewSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI/human-review signals — EVL-R2 may be NOT_APPLICABLE if there are no production AI outputs to sample.",
    );
  }
  if (opts.protocol.found) {
    notes.push(`Protocol refs: ${opts.protocol.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.cadence.found) {
    notes.push(`Cadence refs: ${opts.cadence.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No cadence/sample-size signals found.");
  }
  if (opts.adjudication.found) {
    notes.push(
      `Adjudication refs: ${opts.adjudication.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No adjudication / inter-rater signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (cadence=${opts.imported.cadenceAndSampleSizeDefined}, lastAge=${opts.imported.lastSampleAgeDays}, prodLike=${opts.imported.productionLikeCoverage}, missingAdj=${opts.imported.disagreementsMissingAdjudication})`,
    );
  } else if (reviewSignalsPresent) {
    notes.push(
      "Review signals alone are PARTIAL — import cadenceAndSampleSizeDefined, lastSampleAgeDays≤90, productionLikeCoverage, disagreementsMissingAdjudication=0 (measuredAt ≤90d) under imports/eval-human-review/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const protocolOk = opts.imported.cadenceAndSampleSizeDefined === true;
  const sampleFresh =
    opts.imported.lastSampleAgeDays !== null &&
    opts.imported.lastSampleAgeDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk = opts.imported.productionLikeCoverage === true;
  const adjudicationOk =
    opts.imported.disagreementsMissingAdjudication !== null &&
    opts.imported.disagreementsMissingAdjudication === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalHumanReviewReport["summary"]["statusHint"];
  let evlR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.cadenceAndSampleSizeDefined === false ||
      opts.imported.productionLikeCoverage === false ||
      (opts.imported.disagreementsMissingAdjudication !== null &&
        opts.imported.disagreementsMissingAdjudication > 0) ||
      (opts.imported.lastSampleAgeDays !== null &&
        opts.imported.lastSampleAgeDays > IMPORT_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !reviewSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    evlR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    evlR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing cadence/coverage, unadjudicated disagreements, stale sample, or evidence older than 90 days — EVL-R2 fail.",
    );
  } else if (
    (reviewSignalsPresent || opts.imported.found) &&
    protocolOk &&
    sampleFresh &&
    coverageOk &&
    adjudicationOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlR2Satisfied = true;
  } else if (reviewSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    evlR2Satisfied = false;
    if (opts.imported.found && !protocolOk) {
      notes.push("Import must show cadenceAndSampleSizeDefined=true.");
    }
    if (opts.imported.found && !sampleFresh) {
      notes.push("Import must show lastSampleAgeDays≤90.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show productionLikeCoverage=true.");
    }
    if (opts.imported.found && !adjudicationOk) {
      notes.push(
        "Import must show disagreementsMissingAdjudication=0 (or adjudicationRecorded=true).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-R2 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    evlR2Satisfied = null;
    notes.push(
      "AI signals present but no human preference / expert-review sampling evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      protocol: opts.protocol,
      cadence: opts.cadence,
      adjudication: opts.adjudication,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      reviewSignalsPresent,
      evlR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalHumanReviewCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const protocolRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROTOCOL_RE.test(path) || PROTOCOL_RE.test(text),
      12,
    );
    const cadenceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROTOCOL_RE.test(path) || PROTOCOL_RE.test(text) || AI_PATH_RE.test(path)) &&
        CADENCE_RE.test(text),
      12,
    );
    const adjudicationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ADJUDICATION_RE.test(path) || ADJUDICATION_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEvalHumanReviewReport({
      assessedAt: ctx.assessedAt.toISOString(),
      protocol: { found: protocolRefs.length > 0, refs: protocolRefs },
      cadence: { found: cadenceRefs.length > 0, refs: cadenceRefs },
      adjudication: {
        found: adjudicationRefs.length > 0,
        refs: adjudicationRefs,
      },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-human-review-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/eval-human-review-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-human-review",
          "evl-r2",
          DETECTOR_ID,
          ...(report.summary.evlR2Satisfied ? ["evl-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.protocol.refs,
        ...report.signals.cadence.refs,
        ...report.signals.adjudication.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-human-review-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-R2 status=${report.summary.statusHint} review=${report.summary.reviewSignalsPresent} satisfied=${report.summary.evlR2Satisfied}; report=imports/${PLUGIN_ID}/eval-human-review-report.json`,
      nodes,
    };
  },
};
