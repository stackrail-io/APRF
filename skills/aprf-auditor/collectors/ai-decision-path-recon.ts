/**
 * ai-decision-path-recon — EXP-M2 / repo-ai-decision-path-recon.
 *
 * Discovers operator decision-path reconstruction procedures + timed drills.
 * Import reconstructionProcedureDocumented +
 * reconstructedSampleCount≥3 +
 * allSamplesWithinDocumentedTimeBudget under imports/ai-decision-path-recon/
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

const PLUGIN_ID = "ai-decision-path-recon";
const RELATED = ["EXP-M2"] as const;
const DETECTOR_ID = "repo-ai-decision-path-recon";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_SAMPLES = 3;

const PROCEDURE_RE =
  /\b(decision[_-]?path|reconstruct(ion|able)?|explainability[_-]?runbook|operator[_-]?(explain|recon)|trace[_-]?walk(through)?|model.+retriev.+outcome)\b/i;

const DRILL_RE =
  /\b(recon(struction)?[_-]?(drill|exercise|timed)|timed[_-]?(drill|recon)|operator[_-]?drill|explainability[_-]?drill)\b/i;

const TRACE_SAMPLE_RE =
  /\b(sampled[_-]?(trace|outcome|request)|production[_-]?trace[_-]?sample|trace[_-]?sample|3[_-]?of[_-]?3|three[_-]?traces)\b/i;

export interface AiDecisionPathReconReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    procedure: { found: boolean; refs: string[] };
    drill: { found: boolean; refs: string[] };
    samples: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    reconstructionProcedureDocumented: boolean | null;
    reconstructedSampleCount: number | null;
    allSamplesWithinDocumentedTimeBudget: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    reconSignalsPresent: boolean;
    expM2Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".pdf"],
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
): AiDecisionPathReconReport["importedResults"] {
  const sources: string[] = [];
  let reconstructionProcedureDocumented: boolean | null = null;
  let reconstructedSampleCount: number | null = null;
  let allSamplesWithinDocumentedTimeBudget: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-decision-path-recon-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      reconstructionProcedureDocumented =
        asBool(data.reconstructionProcedureDocumented) ??
        asBool(data.reconstruction_procedure_documented) ??
        asBool(data.procedureDocumented) ??
        asBool(data.decisionPathProcedureDocumented) ??
        reconstructionProcedureDocumented;
      reconstructedSampleCount =
        asNum(data.reconstructedSampleCount) ??
        asNum(data.reconstructed_sample_count) ??
        asNum(data.sampledTracesReconstructed) ??
        asNum(data.sampleCount) ??
        reconstructedSampleCount;
      allSamplesWithinDocumentedTimeBudget =
        asBool(data.allSamplesWithinDocumentedTimeBudget) ??
        asBool(data.all_samples_within_documented_time_budget) ??
        asBool(data.withinTimeBudget) ??
        asBool(data.reconstructionWithinTimeBudget) ??
        allSamplesWithinDocumentedTimeBudget;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    reconstructionProcedureDocumented,
    reconstructedSampleCount,
    allSamplesWithinDocumentedTimeBudget,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDecisionPathReconReport(opts: {
  assessedAt: string;
  procedure: { found: boolean; refs: string[] };
  drill: { found: boolean; refs: string[] };
  samples: { found: boolean; refs: string[] };
  imported: AiDecisionPathReconReport["importedResults"];
}): AiDecisionPathReconReport {
  const notes: string[] = [];
  const reconSignalsPresent =
    opts.procedure.found || opts.drill.found || opts.samples.found;

  if (!reconSignalsPresent && !opts.imported.found) {
    notes.push(
      "No decision-path reconstruction signals — EXP-M2 may be NOT_APPLICABLE if there are no production AI outcomes to reconstruct.",
    );
  }
  if (opts.procedure.found) {
    notes.push(
      `Procedure refs: ${opts.procedure.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.drill.found) {
    notes.push(`Drill refs: ${opts.drill.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.samples.found) {
    notes.push(`Sample refs: ${opts.samples.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (procedure=${opts.imported.reconstructionProcedureDocumented}, samples=${opts.imported.reconstructedSampleCount}, withinBudget=${opts.imported.allSamplesWithinDocumentedTimeBudget})`,
    );
  } else if (reconSignalsPresent) {
    notes.push(
      "Reconstruction signals alone are PARTIAL — import reconstructionProcedureDocumented=true + reconstructedSampleCount≥3 + allSamplesWithinDocumentedTimeBudget=true (measuredAt ≤90d) under imports/ai-decision-path-recon/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const procedureOk = opts.imported.reconstructionProcedureDocumented === true;
  const samplesOk =
    opts.imported.reconstructedSampleCount !== null &&
    opts.imported.reconstructedSampleCount >= MIN_SAMPLES;
  const budgetOk = opts.imported.allSamplesWithinDocumentedTimeBudget === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiDecisionPathReconReport["summary"]["statusHint"];
  let expM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.reconstructionProcedureDocumented === false ||
      (opts.imported.reconstructedSampleCount !== null &&
        opts.imported.reconstructedSampleCount < MIN_SAMPLES) ||
      opts.imported.allSamplesWithinDocumentedTimeBudget === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!reconSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing reconstruction procedure, fewer than 3 samples, samples outside time budget, or attest older than 90 days — EXP-M2 fail.",
    );
  } else if (
    (reconSignalsPresent || opts.imported.found) &&
    procedureOk &&
    samplesOk &&
    budgetOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expM2Satisfied = true;
  } else if (reconSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expM2Satisfied = false;
    if (opts.imported.found && !procedureOk) {
      notes.push("Import must show reconstructionProcedureDocumented=true.");
    }
    if (opts.imported.found && !samplesOk) {
      notes.push(`Import must show reconstructedSampleCount≥${MIN_SAMPLES}.`);
    }
    if (opts.imported.found && !budgetOk) {
      notes.push(
        "Import must show allSamplesWithinDocumentedTimeBudget=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      procedure: opts.procedure,
      drill: opts.drill,
      samples: opts.samples,
    },
    importedResults: opts.imported,
    summary: {
      reconSignalsPresent,
      expM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDecisionPathReconCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const procedureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROCEDURE_RE.test(path) || PROCEDURE_RE.test(text),
      10,
    );
    const drillRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        DRILL_RE.test(path) ||
        (/(drill|exercise|runbook|report)/i.test(path) && DRILL_RE.test(text)),
      8,
    );
    const sampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        TRACE_SAMPLE_RE.test(path) || TRACE_SAMPLE_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiDecisionPathReconReport({
      assessedAt: ctx.assessedAt.toISOString(),
      procedure: { found: procedureRefs.length > 0, refs: procedureRefs },
      drill: { found: drillRefs.length > 0, refs: drillRefs },
      samples: { found: sampleRefs.length > 0, refs: sampleRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-decision-path-recon-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-decision-path-recon-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-decision-path-recon",
          "exp-m2",
          DETECTOR_ID,
          ...(report.summary.expM2Satisfied ? ["exp-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.procedure.refs,
        ...report.signals.drill.refs,
        ...report.signals.samples.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-decision-path-recon-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-M2 status=${report.summary.statusHint} signals=${report.summary.reconSignalsPresent} satisfied=${report.summary.expM2Satisfied}; report=imports/${PLUGIN_ID}/ai-decision-path-recon-report.json`,
      nodes,
    };
  },
};
