/**
 * model-payload-redaction — PRI-R1 / repo-model-payload-redaction.
 *
 * Discovers pre-model tokenization/redaction for high-sensitivity fields.
 * Import sample evidence under imports/model-payload-redaction/ to unlock PASS.
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

const PLUGIN_ID = "model-payload-redaction";
const RELATED = ["PRI-R1"] as const;
const DETECTOR_ID = "repo-model-payload-redaction";
const INVENTORY_MAX_AGE_DAYS = 90;
const MIN_SAMPLE = 50;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(tokeniz|redact|mask(?:ing)?|pii[\s_-]*scrub|pre[\s_-]*model|payload[\s_-]*scrub)/i;

const FIELD_INV_RE =
  /\b(high[\s_-]*sensitivity|sensitive[\s_-]*field|field[\s_-]*inventory|pii[\s_-]*field|tokeniz(?:e|ation)[\s_-]*field)\b/i;

const PIPELINE_RE =
  /\b(pre[\s_-]*model|before[\s_-]*model|tokeniz(?:e|ation)|redact(?:ion)?[\s_-]*pipeline|mask[\s_-]*before[\s_-]*send)\b/i;

const FAIL_CLOSED_RE =
  /\b(fail[\s_-]*closed|block[\s_-]*on[\s_-]*redact|abort[\s_-]*on[\s_-]*error|deny[\s_-]*on[\s_-]*redaction[\s_-]*fail)\b/i;

export interface ModelPayloadRedactionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    fieldInventory: { found: boolean; refs: string[] };
    pipeline: { found: boolean; refs: string[] };
    failClosed: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highSensitivityFieldsDocumented: boolean | null;
    pipelineFailClosed: boolean | null;
    sampleSize: number | null;
    cleartextHits: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    redactionSignalsPresent: boolean;
    priR1Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): ModelPayloadRedactionReport["importedResults"] {
  const sources: string[] = [];
  let highSensitivityFieldsDocumented: boolean | null = null;
  let pipelineFailClosed: boolean | null = null;
  let sampleSize: number | null = null;
  let cleartextHits: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-payload-redaction-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      highSensitivityFieldsDocumented =
        asBool(data.highSensitivityFieldsDocumented) ??
        asBool(data.fieldsDocumented) ??
        highSensitivityFieldsDocumented;
      pipelineFailClosed =
        asBool(data.pipelineFailClosed) ??
        asBool(data.failClosedOnRedactionError) ??
        asBool(data.failClosed) ??
        pipelineFailClosed;
      sampleSize =
        asNum(data.sampleSize) ??
        asNum(data.sampledCalls) ??
        asNum(data.sample_size) ??
        sampleSize;
      cleartextHits =
        asNum(data.cleartextHits) ??
        asNum(data.cleartextHitCount) ??
        asNum(data.cleartext_hits) ??
        cleartextHits;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.priR1Complete) === true) {
        highSensitivityFieldsDocumented =
          highSensitivityFieldsDocumented ?? true;
        pipelineFailClosed = pipelineFailClosed ?? true;
        sampleSize = sampleSize ?? MIN_SAMPLE;
        cleartextHits = cleartextHits ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highSensitivityFieldsDocumented,
    pipelineFailClosed,
    sampleSize,
    cleartextHits,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelPayloadRedactionReport(opts: {
  assessedAt: string;
  signals: ModelPayloadRedactionReport["signals"];
  modelTrafficSignals: boolean;
  imported: ModelPayloadRedactionReport["importedResults"];
}): ModelPayloadRedactionReport {
  const notes: string[] = [];
  const redactionSignalsPresent =
    opts.signals.pipeline.found ||
    (opts.signals.fieldInventory.found && opts.signals.failClosed.found);

  if (
    !opts.modelTrafficSignals &&
    !redactionSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No pre-model redaction signals — PRI-R1 may be NOT_APPLICABLE if no production model traffic with high-sensitivity fields.",
    );
  }
  if (opts.signals.pipeline.found) {
    notes.push(
      `Pipeline refs: ${opts.signals.pipeline.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (fields=${opts.imported.highSensitivityFieldsDocumented}, failClosed=${opts.imported.pipelineFailClosed}, sample=${opts.imported.sampleSize}, cleartextHits=${opts.imported.cleartextHits}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (redactionSignalsPresent) {
    notes.push(
      "Redaction signals alone are PARTIAL — import ≥50-sample clean audit (measuredAt ≤90d) under imports/model-payload-redaction/ to PASS.",
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
  const sampleOk =
    opts.imported.sampleSize !== null &&
    opts.imported.sampleSize >= MIN_SAMPLE;
  const cleanSample =
    opts.imported.cleartextHits !== null && opts.imported.cleartextHits === 0;
  const passOk =
    opts.imported.highSensitivityFieldsDocumented === true &&
    opts.imported.pipelineFailClosed === true &&
    sampleOk &&
    cleanSample &&
    ageOk &&
    importFresh;

  let statusHint: ModelPayloadRedactionReport["summary"]["statusHint"];
  let priR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.highSensitivityFieldsDocumented === false ||
      opts.imported.pipelineFailClosed === false ||
      (opts.imported.cleartextHits !== null &&
        opts.imported.cleartextHits > 0) ||
      (opts.imported.sampleSize !== null &&
        opts.imported.sampleSize < MIN_SAMPLE) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.modelTrafficSignals &&
    !opts.signals.pipeline.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priR1Satisfied = false;
    notes.push(
      "Imported sample shows missing fields/fail-closed, cleartext hits, undersized sample, or evidence older than 90 days — PRI-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priR1Satisfied = true;
  } else if (
    opts.signals.pipeline.found ||
    opts.signals.fieldInventory.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priR1Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.highSensitivityFieldsDocumented !== true) {
        notes.push(
          "Import must show highSensitivityFieldsDocumented=true.",
        );
      }
      if (opts.imported.pipelineFailClosed !== true) {
        notes.push("Import must show pipelineFailClosed=true.");
      }
      if (!sampleOk) {
        notes.push(`Import must show sampleSize≥${MIN_SAMPLE}.`);
      }
      if (!cleanSample) {
        notes.push("Import must show cleartextHits=0.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-R1 PASS.",
        );
      }
    }
  } else if (opts.modelTrafficSignals) {
    statusHint = "not_demonstrated";
    priR1Satisfied = null;
    notes.push(
      "Model/privacy signals present but no pre-model tokenization/redaction pipeline found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priR1Satisfied = null;
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
      redactionSignalsPresent,
      priR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelPayloadRedactionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelTrafficSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) =>
          PATH_RE.test(path) ||
          /\b(model[\s_-]*request|prompt[\s_-]*payload|llm[\s_-]*input|openai|anthropic)\b/i.test(
            text,
          ),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) || PATH_RE.test(text) || PIPELINE_RE.test(text);

    const fieldRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FIELD_INV_RE.test(path) || FIELD_INV_RE.test(text)) &&
        inCtx(path, text),
    );
    const pipelineRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PIPELINE_RE.test(path) || PIPELINE_RE.test(text)) &&
        inCtx(path, text),
    );
    const failClosedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FAIL_CLOSED_RE.test(path) || FAIL_CLOSED_RE.test(text)) &&
        inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelPayloadRedactionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        fieldInventory: { found: fieldRefs.length > 0, refs: fieldRefs },
        pipeline: { found: pipelineRefs.length > 0, refs: pipelineRefs },
        failClosed: { found: failClosedRefs.length > 0, refs: failClosedRefs },
      },
      modelTrafficSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-payload-redaction-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/model-payload-redaction-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "model-payload-redaction",
          "pri-r1",
          DETECTOR_ID,
          ...(report.summary.redactionSignalsPresent
            ? ["redaction-signals"]
            : []),
          ...(report.summary.priR1Satisfied ? ["pri-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...pipelineRefs.slice(0, 2),
        ...fieldRefs.slice(0, 1),
        ...failClosedRefs.slice(0, 1),
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
        signals: ["model-payload-redaction-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-R1 status=${report.summary.statusHint} redaction=${report.summary.redactionSignalsPresent} satisfied=${report.summary.priR1Satisfied}; report=imports/${PLUGIN_ID}/model-payload-redaction-report.json`,
      nodes,
    };
  },
};
