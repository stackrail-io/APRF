/**
 * ai-trace-quality-annotations — OBS-R2 / repo-ai-trace-quality-annotations.
 *
 * Discovers secure quality-label tooling on production traces + closed-loop feed.
 * Import qualityAnnotationToolingConfigured + annotationsLast90Days≥50 +
 * annotationsFeedEvalOrReviewLoop under imports/ai-trace-quality-annotations/
 * to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-trace-quality-annotations";
const RELATED = ["OBS-R2"] as const;
const DETECTOR_ID = "repo-ai-trace-quality-annotations";
const IMPORT_MAX_AGE_DAYS = 90;
const ANNOTATION_MIN = 50;

const ANNOTATION_RE =
  /\b(trace[\s_-]*annotat|span[\s_-]*annotat|quality[\s_-]*label|annotat(?:e|ion|or).{0,40}(trace|span)|label[\s_-]*span)\b/i;

const SCHEMA_TOOL_RE =
  /\b(annotation[\s_-]*schema|label[\s_-]*schema|annotat(?:ion)?[\s_-]*tool|human[\s_-]*feedback[\s_-]*trace|secure[\s_-]*annotat)\b/i;

const EVAL_LOOP_RE =
  /\b(closed[\s_-]*loop|eval[\s_-]*loop|review[\s_-]*loop|annotat.{0,30}(eval|review)|feed(?:s|ing)?.{0,20}(eval|review))\b/i;

export interface AiTraceQualityAnnotationsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    annotation: { found: boolean; refs: string[] };
    schemaTool: { found: boolean; refs: string[] };
    evalLoop: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    qualityAnnotationToolingConfigured: boolean | null;
    annotationsLast90Days: number | null;
    annotationsFeedEvalOrReviewLoop: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    annotationSignalsPresent: boolean;
    obsR2Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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
): AiTraceQualityAnnotationsReport["importedResults"] {
  const sources: string[] = [];
  let qualityAnnotationToolingConfigured: boolean | null = null;
  let annotationsLast90Days: number | null = null;
  let annotationsFeedEvalOrReviewLoop: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-trace-quality-annotations-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      annotationsLast90Days =
        asNum(data.annotationsLast90Days) ??
        asNum(data.annotations_last_90_days) ??
        asNum(data.annotationCountLast90Days) ??
        annotationsLast90Days;
      qualityAnnotationToolingConfigured =
        asBool(data.qualityAnnotationToolingConfigured) ??
        asBool(data.quality_annotation_tooling_configured) ??
        asBool(data.secureAnnotationToolingConfigured) ??
        qualityAnnotationToolingConfigured;
      annotationsFeedEvalOrReviewLoop =
        asBool(data.annotationsFeedEvalOrReviewLoop) ??
        asBool(data.annotations_feed_eval_or_review_loop) ??
        asBool(data.feedsEvalOrReviewLoop) ??
        annotationsFeedEvalOrReviewLoop;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    qualityAnnotationToolingConfigured,
    annotationsLast90Days,
    annotationsFeedEvalOrReviewLoop,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTraceQualityAnnotationsReport(opts: {
  assessedAt: string;
  annotation: { found: boolean; refs: string[] };
  schemaTool: { found: boolean; refs: string[] };
  evalLoop: { found: boolean; refs: string[] };
  imported: AiTraceQualityAnnotationsReport["importedResults"];
}): AiTraceQualityAnnotationsReport {
  const notes: string[] = [];
  const annotationSignalsPresent =
    opts.annotation.found || opts.schemaTool.found || opts.evalLoop.found;

  if (!annotationSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI trace quality-annotation signals — OBS-R2 may be NOT_APPLICABLE if no production AI traces are in scope.",
    );
  }
  if (opts.annotation.found) {
    notes.push(
      `Annotation refs: ${opts.annotation.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.schemaTool.found) {
    notes.push(
      `Schema/tool refs: ${opts.schemaTool.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (tooling=${opts.imported.qualityAnnotationToolingConfigured}, count90d=${opts.imported.annotationsLast90Days}, feedsLoop=${opts.imported.annotationsFeedEvalOrReviewLoop})`,
    );
  } else if (annotationSignalsPresent) {
    notes.push(
      "Annotation signals alone are PARTIAL — import qualityAnnotationToolingConfigured=true + annotationsLast90Days≥50 + annotationsFeedEvalOrReviewLoop=true (measuredAt ≤90d) under imports/ai-trace-quality-annotations/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const toolingOk = opts.imported.qualityAnnotationToolingConfigured === true;
  const countOk =
    opts.imported.annotationsLast90Days !== null &&
    opts.imported.annotationsLast90Days >= ANNOTATION_MIN;
  const loopOk = opts.imported.annotationsFeedEvalOrReviewLoop === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiTraceQualityAnnotationsReport["summary"]["statusHint"];
  let obsR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.qualityAnnotationToolingConfigured === false ||
      (typeof opts.imported.annotationsLast90Days === "number" &&
        opts.imported.annotationsLast90Days < ANNOTATION_MIN) ||
      opts.imported.annotationsFeedEvalOrReviewLoop === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!annotationSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing secure annotation tooling, <50 annotations in 90 days, no eval/review feed, or evidence older than 90 days — OBS-R2 fail.",
    );
  } else if (
    (annotationSignalsPresent || opts.imported.found) &&
    toolingOk &&
    countOk &&
    loopOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsR2Satisfied = true;
  } else if (annotationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsR2Satisfied = false;
    if (opts.imported.found && !toolingOk) {
      notes.push(
        "Import must show qualityAnnotationToolingConfigured=true.",
      );
    }
    if (opts.imported.found && !countOk) {
      notes.push("Import must show annotationsLast90Days≥50.");
    }
    if (opts.imported.found && !loopOk) {
      notes.push("Import must show annotationsFeedEvalOrReviewLoop=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock OBS-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      annotation: opts.annotation,
      schemaTool: opts.schemaTool,
      evalLoop: opts.evalLoop,
    },
    importedResults: opts.imported,
    summary: {
      annotationSignalsPresent,
      obsR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiTraceQualityAnnotationsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const annotation = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ANNOTATION_RE.test(path) || ANNOTATION_RE.test(text),
      10,
    );
    const schemaTool = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCHEMA_TOOL_RE.test(path) || SCHEMA_TOOL_RE.test(text),
      8,
    );
    const evalLoop = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (EVAL_LOOP_RE.test(path) || EVAL_LOOP_RE.test(text)) &&
        (ANNOTATION_RE.test(path + text) || /annotat|label/i.test(path + text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiTraceQualityAnnotationsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      annotation: { found: annotation.length > 0, refs: annotation },
      schemaTool: { found: schemaTool.length > 0, refs: schemaTool },
      evalLoop: { found: evalLoop.length > 0, refs: evalLoop },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-trace-quality-annotations-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-trace-quality-annotations-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-trace-quality-annotations",
          "obs-r2",
          DETECTOR_ID,
          ...(report.summary.obsR2Satisfied ? ["obs-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.annotation.refs,
        ...report.signals.schemaTool.refs,
        ...report.signals.evalLoop.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-trace-quality-annotations-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-R2 status=${report.summary.statusHint} signals=${report.summary.annotationSignalsPresent} satisfied=${report.summary.obsR2Satisfied}; report=imports/${PLUGIN_ID}/ai-trace-quality-annotations-report.json`,
      nodes,
    };
  },
};
