/**
 * eval-shadow-cutover — EVL-M4 / repo-eval-shadow-cutover.
 *
 * Discovers shadow/canary eval comparison before full cutover for high-risk AI.
 * Import highRiskCutoversMissingShadowComparison=0 +
 * promotionCriteriaMetBeforeFullTraffic + measuredAt ≤90d under
 * imports/eval-shadow-cutover/ to unlock PASS. highRiskCutoverCount=0 → N/A.
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

const PLUGIN_ID = "eval-shadow-cutover";
const RELATED = ["EVL-M4"] as const;
const DETECTOR_ID = "repo-eval-shadow-cutover";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(eval|evals|prompt|model|llm|canary|shadow|cutover|deploy|release)/i;

const SHADOW_CANARY_RE =
  /\b(shadow[\s_-]*(deploy|traffic|eval|mode)|canary[\s_-]*(deploy|release|eval|traffic)|dark[\s_-]*launch|mirror[\s_-]*traffic)\b/i;

const COMPARISON_RE =
  /\b(eval[\s_-]*compar|compar(e|ison)[\s_-]*(eval|metric|report)|promotion[\s_-]*criteria|non[\s_-]*inferior|cutover[\s_-]*gate|promote[\s_-]*to[\s_-]*(full|100))\b/i;

const HIGH_RISK_RE =
  /\b(high[\s_-]*risk|production[\s_-]*cutover|model[\s_-]*cutover|prompt[\s_-]*cutover|full[\s_-]*traffic|100%[\s_-]*traffic)\b/i;

export interface EvalShadowCutoverReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    shadowCanary: { found: boolean; refs: string[] };
    comparison: { found: boolean; refs: string[] };
    highRisk: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highRiskCutoverCount: number | null;
    highRiskCutoversMissingShadowComparison: number | null;
    promotionCriteriaMetBeforeFullTraffic: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    cutoverSignalsPresent: boolean;
    evlM4Satisfied: boolean | null;
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

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(promptfoo|openai|anthropic|llm|model[\s_-]*deploy)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalShadowCutoverReport["importedResults"] {
  const sources: string[] = [];
  let highRiskCutoverCount: number | null = null;
  let highRiskCutoversMissingShadowComparison: number | null = null;
  let promotionCriteriaMetBeforeFullTraffic: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-shadow-cutover-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      highRiskCutoverCount =
        asNum(data.highRiskCutoverCount) ??
        asNum(data.high_risk_cutover_count) ??
        highRiskCutoverCount;
      highRiskCutoversMissingShadowComparison =
        asNum(data.highRiskCutoversMissingShadowComparison) ??
        asNum(data.high_risk_cutovers_missing_shadow_comparison) ??
        highRiskCutoversMissingShadowComparison;
      promotionCriteriaMetBeforeFullTraffic =
        asBool(data.promotionCriteriaMetBeforeFullTraffic) ??
        asBool(data.promotion_criteria_met_before_full_traffic) ??
        asBool(data.criteriaMetBeforeFullTraffic) ??
        promotionCriteriaMetBeforeFullTraffic;

      if (
        asBool(data.lastHighRiskCutoverHadShadowOrCanary) === true &&
        highRiskCutoversMissingShadowComparison === null
      ) {
        highRiskCutoversMissingShadowComparison = 0;
        if (highRiskCutoverCount === null) highRiskCutoverCount = 1;
      }
      if (
        asBool(data.noHighRiskCutoversInScope) === true &&
        highRiskCutoverCount === null
      ) {
        highRiskCutoverCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highRiskCutoverCount,
    highRiskCutoversMissingShadowComparison,
    promotionCriteriaMetBeforeFullTraffic,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalShadowCutoverReport(opts: {
  assessedAt: string;
  shadowCanary: { found: boolean; refs: string[] };
  comparison: { found: boolean; refs: string[] };
  highRisk: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: EvalShadowCutoverReport["importedResults"];
}): EvalShadowCutoverReport {
  const notes: string[] = [];
  const cutoverSignalsPresent =
    opts.shadowCanary.found || opts.comparison.found || opts.highRisk.found;

  if (!opts.aiSignals && !cutoverSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI/cutover signals — EVL-M4 may be NOT_APPLICABLE if there are no high-risk AI cutovers.",
    );
  }
  if (opts.shadowCanary.found) {
    notes.push(
      `Shadow/canary refs: ${opts.shadowCanary.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.comparison.found) {
    notes.push(
      `Comparison/promotion refs: ${opts.comparison.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No eval-comparison / promotion-criteria signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (cutovers=${opts.imported.highRiskCutoverCount}, missingShadow=${opts.imported.highRiskCutoversMissingShadowComparison}, criteriaMet=${opts.imported.promotionCriteriaMetBeforeFullTraffic})`,
    );
  } else if (cutoverSignalsPresent) {
    notes.push(
      "Cutover signals alone are PARTIAL — import highRiskCutoversMissingShadowComparison=0, promotionCriteriaMetBeforeFullTraffic=true (measuredAt ≤90d) under imports/eval-shadow-cutover/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const noCutovers = opts.imported.highRiskCutoverCount === 0;
  const coverageOk =
    opts.imported.highRiskCutoversMissingShadowComparison !== null &&
    opts.imported.highRiskCutoversMissingShadowComparison === 0;
  const criteriaOk =
    opts.imported.promotionCriteriaMetBeforeFullTraffic === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalShadowCutoverReport["summary"]["statusHint"];
  let evlM4Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    !noCutovers &&
    ((opts.imported.highRiskCutoversMissingShadowComparison !== null &&
      opts.imported.highRiskCutoversMissingShadowComparison > 0) ||
      opts.imported.promotionCriteriaMetBeforeFullTraffic === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    (!opts.aiSignals && !cutoverSignalsPresent && !opts.imported.found) ||
    noCutovers
  ) {
    statusHint = "not_applicable";
    evlM4Satisfied = null;
    if (noCutovers) {
      notes.push(
        "Imported highRiskCutoverCount=0 — EVL-M4 NOT_APPLICABLE (no high-risk AI cutovers in scope).",
      );
    }
  } else if (measuredFail) {
    statusHint = "fail";
    evlM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing shadow/canary comparison, promotion before criteria, or evidence older than 90 days — EVL-M4 fail.",
    );
  } else if (
    (cutoverSignalsPresent || opts.imported.found) &&
    coverageOk &&
    criteriaOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlM4Satisfied = true;
  } else if (cutoverSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    evlM4Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show highRiskCutoversMissingShadowComparison=0 (or lastHighRiskCutoverHadShadowOrCanary=true).",
      );
    }
    if (opts.imported.found && !criteriaOk) {
      notes.push(
        "Import must show promotionCriteriaMetBeforeFullTraffic=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-M4 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    evlM4Satisfied = null;
    notes.push(
      "AI signals present but no shadow/canary cutover comparison evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      shadowCanary: opts.shadowCanary,
      comparison: opts.comparison,
      highRisk: opts.highRisk,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      cutoverSignalsPresent,
      evlM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalShadowCutoverCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const shadowRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SHADOW_CANARY_RE.test(path) || SHADOW_CANARY_RE.test(text),
      12,
    );
    const comparisonRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => COMPARISON_RE.test(path) || COMPARISON_RE.test(text),
      12,
    );
    const highRiskRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SHADOW_CANARY_RE.test(path) ||
          SHADOW_CANARY_RE.test(text) ||
          COMPARISON_RE.test(text)) &&
        HIGH_RISK_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildEvalShadowCutoverReport({
      assessedAt: ctx.assessedAt.toISOString(),
      shadowCanary: { found: shadowRefs.length > 0, refs: shadowRefs },
      comparison: { found: comparisonRefs.length > 0, refs: comparisonRefs },
      highRisk: { found: highRiskRefs.length > 0, refs: highRiskRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-shadow-cutover-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/eval-shadow-cutover-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-shadow-cutover",
          "evl-m4",
          DETECTOR_ID,
          ...(report.summary.evlM4Satisfied ? ["evl-m4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.shadowCanary.refs,
        ...report.signals.comparison.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-shadow-cutover-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-M4 status=${report.summary.statusHint} cutover=${report.summary.cutoverSignalsPresent} satisfied=${report.summary.evlM4Satisfied}; report=imports/${PLUGIN_ID}/eval-shadow-cutover-report.json`,
      nodes,
    };
  },
};
