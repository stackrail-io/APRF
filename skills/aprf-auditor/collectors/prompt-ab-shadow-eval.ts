/**
 * prompt-ab-shadow-eval — PRM-R3 / repo-prompt-ab-shadow-eval.
 *
 * Discovers A/B or shadow eval for high-traffic prompt changes.
 * Import lastHighTrafficPromptChangeUsedAbOrShadow +
 * preRegisteredMetricsPresent + promotionRequiredNonInferiority under
 * imports/prompt-ab-shadow-eval/ to unlock PASS (measuredAt ≤90d).
 * highTrafficPromptChangeCount=0 → NOT_APPLICABLE.
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

const PLUGIN_ID = "prompt-ab-shadow-eval";
const RELATED = ["PRM-R3"] as const;
const DETECTOR_ID = "repo-prompt-ab-shadow-eval";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const AB_SHADOW_RE =
  /\b(a[\s/_-]*b[\s_-]*(test|eval|experiment)|shadow[\s_-]*(eval|prompt|traffic)|prompt[\s_-]*(ab|a[\s/_-]*b|shadow)|canary[\s_-]*prompt)\b/i;

const METRICS_RE =
  /\b(pre[\s_-]*registered[\s_-]*metric\w*|success[\s_-]*metric\w*|primary[\s_-]*quality|safety[\s_-]*sli|quality[\s_-]*sli|experiment[\s_-]*metric\w*)\b/i;

const NON_INFERIOR_RE =
  /\b(non[\s_-]*inferiorit\w*|not[\s_-]*worse|promote[\s_-]*only[\s_-]*if|promotion[\s_-]*criteri\w*|safety[\s_-]*and[\s_-]*quality)\b/i;

const HIGH_TRAFFIC_RE =
  /\b(high[\s_-]*traffic|top[\s_-]*prompt|critical[\s_-]*prompt|production[\s_-]*prompt[\s_-]*change)\b/i;

export interface PromptAbShadowEvalReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    abShadow: { found: boolean; refs: string[] };
    metrics: { found: boolean; refs: string[] };
    nonInferiority: { found: boolean; refs: string[] };
    highTraffic: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highTrafficPromptChangeCount: number | null;
    lastHighTrafficPromptChangeUsedAbOrShadow: boolean | null;
    preRegisteredMetricsPresent: boolean | null;
    promotionRequiredNonInferiority: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    experimentSignalsPresent: boolean;
    prmR3Satisfied: boolean | null;
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

function detectPromptSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMPT_PATH_RE.test(path) ||
        /\b(system[\s_-]*prompt|prompt[\s_-]*template)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptAbShadowEvalReport["importedResults"] {
  const sources: string[] = [];
  let highTrafficPromptChangeCount: number | null = null;
  let lastHighTrafficPromptChangeUsedAbOrShadow: boolean | null = null;
  let preRegisteredMetricsPresent: boolean | null = null;
  let promotionRequiredNonInferiority: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-ab-shadow-eval-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      highTrafficPromptChangeCount =
        asNum(data.highTrafficPromptChangeCount) ??
        asNum(data.high_traffic_prompt_change_count) ??
        highTrafficPromptChangeCount;
      lastHighTrafficPromptChangeUsedAbOrShadow =
        asBool(data.lastHighTrafficPromptChangeUsedAbOrShadow) ??
        asBool(data.last_high_traffic_prompt_change_used_ab_or_shadow) ??
        asBool(data.usedAbOrShadow) ??
        lastHighTrafficPromptChangeUsedAbOrShadow;
      preRegisteredMetricsPresent =
        asBool(data.preRegisteredMetricsPresent) ??
        asBool(data.pre_registered_metrics_present) ??
        asBool(data.metricsPreRegistered) ??
        preRegisteredMetricsPresent;
      promotionRequiredNonInferiority =
        asBool(data.promotionRequiredNonInferiority) ??
        asBool(data.promotion_required_non_inferiority) ??
        asBool(data.nonInferiorityGate) ??
        promotionRequiredNonInferiority;

      const missing =
        asNum(data.highTrafficPromptChangesMissingAbOrShadow) ??
        asNum(data.high_traffic_prompt_changes_missing_ab_or_shadow);
      if (
        lastHighTrafficPromptChangeUsedAbOrShadow === null &&
        missing !== null
      ) {
        lastHighTrafficPromptChangeUsedAbOrShadow = missing === 0;
      }
      // Affirmative gate evidence overrides earlier false.
      if (asBool(data.nonInferiorityRequiredOnPromote) === true) {
        promotionRequiredNonInferiority = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highTrafficPromptChangeCount,
    lastHighTrafficPromptChangeUsedAbOrShadow,
    preRegisteredMetricsPresent,
    promotionRequiredNonInferiority,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptAbShadowEvalReport(opts: {
  assessedAt: string;
  abShadow: { found: boolean; refs: string[] };
  metrics: { found: boolean; refs: string[] };
  nonInferiority: { found: boolean; refs: string[] };
  highTraffic: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptAbShadowEvalReport["importedResults"];
}): PromptAbShadowEvalReport {
  const notes: string[] = [];
  const experimentSignalsPresent =
    opts.abShadow.found ||
    opts.metrics.found ||
    opts.nonInferiority.found ||
    opts.highTraffic.found;

  if (!opts.promptSignals && !experimentSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/A-B/shadow signals — PRM-R3 may be NOT_APPLICABLE if there are no production prompts.",
    );
  }
  if (opts.abShadow.found) {
    notes.push(`A/B-shadow refs: ${opts.abShadow.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.metrics.found) {
    notes.push(`Metrics refs: ${opts.metrics.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.nonInferiority.found) {
    notes.push(
      `Non-inferiority refs: ${opts.nonInferiority.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.highTraffic.found) {
    notes.push(
      `High-traffic refs: ${opts.highTraffic.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (count=${opts.imported.highTrafficPromptChangeCount}, usedAb=${opts.imported.lastHighTrafficPromptChangeUsedAbOrShadow}, metrics=${opts.imported.preRegisteredMetricsPresent}, gate=${opts.imported.promotionRequiredNonInferiority})`,
    );
  } else if (experimentSignalsPresent) {
    notes.push(
      "Experiment signals alone are PARTIAL — import lastHighTrafficPromptChangeUsedAbOrShadow=true + preRegisteredMetricsPresent=true + promotionRequiredNonInferiority=true (measuredAt ≤90d) under imports/prompt-ab-shadow-eval/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const usedOk =
    opts.imported.lastHighTrafficPromptChangeUsedAbOrShadow === true;
  const metricsOk = opts.imported.preRegisteredMetricsPresent === true;
  const gateOk = opts.imported.promotionRequiredNonInferiority === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const noHighTraffic =
    opts.imported.highTrafficPromptChangeCount !== null &&
    opts.imported.highTrafficPromptChangeCount === 0;

  let statusHint: PromptAbShadowEvalReport["summary"]["statusHint"];
  let prmR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    !noHighTraffic &&
    (opts.imported.lastHighTrafficPromptChangeUsedAbOrShadow === false ||
      opts.imported.preRegisteredMetricsPresent === false ||
      opts.imported.promotionRequiredNonInferiority === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (noHighTraffic) {
    statusHint = "not_applicable";
    prmR3Satisfied = null;
    notes.push(
      "Imported highTrafficPromptChangeCount=0 — PRM-R3 NOT_APPLICABLE.",
    );
  } else if (
    !opts.promptSignals &&
    !experimentSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    prmR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing A/B/shadow, metrics, non-inferiority gate, or evidence older than 90 days — PRM-R3 fail.",
    );
  } else if (
    (experimentSignalsPresent || opts.imported.found) &&
    usedOk &&
    metricsOk &&
    gateOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmR3Satisfied = true;
  } else if (experimentSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmR3Satisfied = false;
    if (opts.imported.found && !usedOk) {
      notes.push(
        "Import must show lastHighTrafficPromptChangeUsedAbOrShadow=true.",
      );
    }
    if (opts.imported.found && !metricsOk) {
      notes.push("Import must show preRegisteredMetricsPresent=true.");
    }
    if (opts.imported.found && !gateOk) {
      notes.push("Import must show promotionRequiredNonInferiority=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-R3 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmR3Satisfied = null;
    notes.push(
      "Prompt signals present but no A/B or shadow-eval evidence for high-traffic prompt changes found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      abShadow: opts.abShadow,
      metrics: opts.metrics,
      nonInferiority: opts.nonInferiority,
      highTraffic: opts.highTraffic,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      experimentSignalsPresent,
      prmR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptAbShadowEvalCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const abShadowRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => AB_SHADOW_RE.test(path) || AB_SHADOW_RE.test(text),
      12,
    );
    const metricsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AB_SHADOW_RE.test(path) ||
          AB_SHADOW_RE.test(text) ||
          METRICS_RE.test(path)) &&
        METRICS_RE.test(text),
      12,
    );
    const nonInferiorityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AB_SHADOW_RE.test(path) || AB_SHADOW_RE.test(text)) &&
        NON_INFERIOR_RE.test(text),
      12,
    );
    const highTrafficRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        HIGH_TRAFFIC_RE.test(path) ||
        (PROMPT_PATH_RE.test(path) && HIGH_TRAFFIC_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptAbShadowEvalReport({
      assessedAt: ctx.assessedAt.toISOString(),
      abShadow: { found: abShadowRefs.length > 0, refs: abShadowRefs },
      metrics: { found: metricsRefs.length > 0, refs: metricsRefs },
      nonInferiority: {
        found: nonInferiorityRefs.length > 0,
        refs: nonInferiorityRefs,
      },
      highTraffic: {
        found: highTrafficRefs.length > 0,
        refs: highTrafficRefs,
      },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-ab-shadow-eval-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-ab-shadow-eval-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-ab-shadow-eval",
          "prm-r3",
          DETECTOR_ID,
          ...(report.summary.prmR3Satisfied ? ["prm-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.abShadow.refs,
        ...report.signals.metrics.refs,
        ...report.signals.nonInferiority.refs,
        ...report.signals.highTraffic.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-ab-shadow-eval-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-R3 status=${report.summary.statusHint} experiment=${report.summary.experimentSignalsPresent} satisfied=${report.summary.prmR3Satisfied}; report=imports/${PLUGIN_ID}/prompt-ab-shadow-eval-report.json`,
      nodes,
    };
  },
};
