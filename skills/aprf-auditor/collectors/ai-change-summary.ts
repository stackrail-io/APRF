/**
 * ai-change-summary — EXP-R3 / repo-ai-change-summary.
 *
 * Discovers change/counterfactual summaries for material model/prompt promotions.
 * Import changeOrCounterfactualSummaryToolingConfigured +
 * lastMaterialPromotionHasRetainedSummary under imports/ai-change-summary/
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
  SCAN_EXTENSIONS_DOCS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-change-summary";
const RELATED = ["EXP-R3"] as const;
const DETECTOR_ID = "repo-ai-change-summary";
const IMPORT_MAX_AGE_DAYS = 90;

const SUMMARY_RE =
  /\b(change[_-]?summary|counterfactual[_-]?(summary|diff|analysis)|promotion[_-]?summary|release[_-]?notes[_-]?(model|prompt)|model[_-]?diff[_-]?summary|prompt[_-]?diff[_-]?summary|behavioral[_-]?impact[_-]?summary)\b/i;

const PROMOTION_RE =
  /\b(model[_-]?promotion|prompt[_-]?promotion|material[_-]?(model|prompt)[_-]?(change|diff|promotion)|promote[_-]?(model|prompt)|version[_-]?diff)\b/i;

const RETAINED_RE =
  /\b(retained[_-]?summary|summary[_-]?(artifact|record|attached)|promotion[_-]?changelog|diff[_-]?narrative)\b/i;

export interface AiChangeSummaryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    summary: { found: boolean; refs: string[] };
    promotion: { found: boolean; refs: string[] };
    retained: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    changeOrCounterfactualSummaryToolingConfigured: boolean | null;
    lastMaterialPromotionHasRetainedSummary: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    changeSummarySignalsPresent: boolean;
    expR3Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS_DOCS, ".pdf"],
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
): AiChangeSummaryReport["importedResults"] {
  const sources: string[] = [];
  let changeOrCounterfactualSummaryToolingConfigured: boolean | null = null;
  let lastMaterialPromotionHasRetainedSummary: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-change-summary-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      changeOrCounterfactualSummaryToolingConfigured =
        asBool(data.changeOrCounterfactualSummaryToolingConfigured) ??
        asBool(data.change_or_counterfactual_summary_tooling_configured) ??
        asBool(data.changeSummaryToolingConfigured) ??
        asBool(data.summaryToolingConfigured) ??
        changeOrCounterfactualSummaryToolingConfigured;
      lastMaterialPromotionHasRetainedSummary =
        asBool(data.lastMaterialPromotionHasRetainedSummary) ??
        asBool(data.last_material_promotion_has_retained_summary) ??
        asBool(data.lastPromotionHasSummary) ??
        asBool(data.retainedSummaryForLastPromotion) ??
        lastMaterialPromotionHasRetainedSummary;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    changeOrCounterfactualSummaryToolingConfigured,
    lastMaterialPromotionHasRetainedSummary,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiChangeSummaryReport(opts: {
  assessedAt: string;
  summary: { found: boolean; refs: string[] };
  promotion: { found: boolean; refs: string[] };
  retained: { found: boolean; refs: string[] };
  imported: AiChangeSummaryReport["importedResults"];
}): AiChangeSummaryReport {
  const notes: string[] = [];
  const changeSummarySignalsPresent =
    opts.summary.found || opts.promotion.found || opts.retained.found;

  if (!changeSummarySignalsPresent && !opts.imported.found) {
    notes.push(
      "No change/counterfactual summary signals — EXP-R3 may be NOT_APPLICABLE if there are no material model/prompt promotions.",
    );
  }
  if (opts.summary.found) {
    notes.push(`Summary refs: ${opts.summary.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.promotion.found) {
    notes.push(
      `Promotion refs: ${opts.promotion.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.retained.found) {
    notes.push(`Retained refs: ${opts.retained.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (tooling=${opts.imported.changeOrCounterfactualSummaryToolingConfigured}, lastPromotionSummary=${opts.imported.lastMaterialPromotionHasRetainedSummary})`,
    );
  } else if (changeSummarySignalsPresent) {
    notes.push(
      "Change-summary signals alone are PARTIAL — import changeOrCounterfactualSummaryToolingConfigured=true + lastMaterialPromotionHasRetainedSummary=true (measuredAt ≤90d) under imports/ai-change-summary/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const toolingOk =
    opts.imported.changeOrCounterfactualSummaryToolingConfigured === true;
  const retainedOk =
    opts.imported.lastMaterialPromotionHasRetainedSummary === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiChangeSummaryReport["summary"]["statusHint"];
  let expR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.changeOrCounterfactualSummaryToolingConfigured === false ||
      opts.imported.lastMaterialPromotionHasRetainedSummary === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!changeSummarySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing change-summary tooling, no retained summary for the last material promotion, or attest older than 90 days — EXP-R3 fail.",
    );
  } else if (
    (changeSummarySignalsPresent || opts.imported.found) &&
    toolingOk &&
    retainedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expR3Satisfied = true;
  } else if (changeSummarySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expR3Satisfied = false;
    if (opts.imported.found && !toolingOk) {
      notes.push(
        "Import must show changeOrCounterfactualSummaryToolingConfigured=true.",
      );
    }
    if (opts.imported.found && !retainedOk) {
      notes.push(
        "Import must show lastMaterialPromotionHasRetainedSummary=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      summary: opts.summary,
      promotion: opts.promotion,
      retained: opts.retained,
    },
    importedResults: opts.imported,
    summary: {
      changeSummarySignalsPresent,
      expR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiChangeSummaryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const summaryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SUMMARY_RE.test(path) || SUMMARY_RE.test(text),
      10,
    );
    const promotionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROMOTION_RE.test(path) || PROMOTION_RE.test(text),
      10,
    );
    const retainedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        RETAINED_RE.test(path) ||
        (/(promotion|release|changelog|artifact)/i.test(path) &&
          (RETAINED_RE.test(text) || SUMMARY_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiChangeSummaryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      summary: { found: summaryRefs.length > 0, refs: summaryRefs },
      promotion: { found: promotionRefs.length > 0, refs: promotionRefs },
      retained: { found: retainedRefs.length > 0, refs: retainedRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-change-summary-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-change-summary-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-change-summary",
          "exp-r3",
          DETECTOR_ID,
          ...(report.summary.expR3Satisfied ? ["exp-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.summary.refs,
        ...report.signals.promotion.refs,
        ...report.signals.retained.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-change-summary-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-R3 status=${report.summary.statusHint} signals=${report.summary.changeSummarySignalsPresent} satisfied=${report.summary.expR3Satisfied}; report=imports/${PLUGIN_ID}/ai-change-summary-report.json`,
      nodes,
    };
  },
};
