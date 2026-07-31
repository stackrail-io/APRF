/**
 * ai-canary-progressive-delivery — DEP-R1 / repo-ai-canary-progressive-delivery.
 *
 * Discovers canary/progressive delivery for high-traffic AI changes.
 * Import canaryOrProgressiveConfigured + automatedRollbackCriteriaPresent +
 * lastHighTrafficReleaseHasCanaryMetricsLink under
 * imports/ai-canary-progressive-delivery/ to unlock PASS (measuredAt ≤90d).
 * N/A when highTrafficAiChangeCount=0.
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

const PLUGIN_ID = "ai-canary-progressive-delivery";
const RELATED = ["DEP-R1"] as const;
const DETECTOR_ID = "repo-ai-canary-progressive-delivery";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_CHANGE_RE =
  /(prompt|prompts|model[\s_-]*pin|model[\s_-]*version|tool[\s_-]*catalog|llm|openai|anthropic|bedrock|vertex)/i;

const CANARY_RE =
  /\b(canary|progressive[\s_-]*delivery|progressive[\s_-]*rollout|traffic[\s_-]*split|blue[\s_-]*green|flagger|argo[\s_-]*rollouts|staged[\s_-]*rollout)\b/i;

const ROLLBACK_CRITERIA_RE =
  /\b(automated[\s_-]*rollback|rollback[\s_-]*criteria|auto[\s_-]*rollback|abort[\s_-]*on|fail[\s_-]*on[\s_-]*slo|error[\s_-]*budget[\s_-]*abort)\b/i;

const METRICS_LINK_RE =
  /\b(canary[\s_-]*metrics|metrics[\s_-]*link|grafana|datadog|prometheus|dashboard[\s_-]*url|observability[\s_-]*link)\b/i;

export interface AiCanaryProgressiveDeliveryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    canary: { found: boolean; refs: string[] };
    rollbackCriteria: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highTrafficAiChangeCount: number | null;
    canaryOrProgressiveConfigured: boolean | null;
    automatedRollbackCriteriaPresent: boolean | null;
    lastHighTrafficReleaseHasCanaryMetricsLink: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiChangeSignalsPresent: boolean;
    canarySignalsPresent: boolean;
    depR1Satisfied: boolean | null;
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

function detectAiChangeSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) => AI_CHANGE_RE.test(path) || AI_CHANGE_RE.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiCanaryProgressiveDeliveryReport["importedResults"] {
  const sources: string[] = [];
  let highTrafficAiChangeCount: number | null = null;
  let canaryOrProgressiveConfigured: boolean | null = null;
  let automatedRollbackCriteriaPresent: boolean | null = null;
  let lastHighTrafficReleaseHasCanaryMetricsLink: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-canary-progressive-delivery-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      highTrafficAiChangeCount =
        asNum(data.highTrafficAiChangeCount) ??
        asNum(data.high_traffic_ai_change_count) ??
        highTrafficAiChangeCount;
      canaryOrProgressiveConfigured =
        asBool(data.canaryOrProgressiveConfigured) ??
        asBool(data.canary_or_progressive_configured) ??
        asBool(data.canaryConfigured) ??
        canaryOrProgressiveConfigured;
      automatedRollbackCriteriaPresent =
        asBool(data.automatedRollbackCriteriaPresent) ??
        asBool(data.automated_rollback_criteria_present) ??
        asBool(data.rollbackCriteriaPresent) ??
        automatedRollbackCriteriaPresent;
      lastHighTrafficReleaseHasCanaryMetricsLink =
        asBool(data.lastHighTrafficReleaseHasCanaryMetricsLink) ??
        asBool(data.last_high_traffic_release_has_canary_metrics_link) ??
        asBool(data.canaryMetricsLinkPresent) ??
        lastHighTrafficReleaseHasCanaryMetricsLink;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highTrafficAiChangeCount,
    canaryOrProgressiveConfigured,
    automatedRollbackCriteriaPresent,
    lastHighTrafficReleaseHasCanaryMetricsLink,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiCanaryProgressiveDeliveryReport(opts: {
  assessedAt: string;
  canary: { found: boolean; refs: string[] };
  rollbackCriteria: { found: boolean; refs: string[] };
  aiChangeSignals: boolean;
  imported: AiCanaryProgressiveDeliveryReport["importedResults"];
}): AiCanaryProgressiveDeliveryReport {
  const notes: string[] = [];
  const canarySignalsPresent =
    opts.canary.found || opts.rollbackCriteria.found;

  if (
    !opts.aiChangeSignals &&
    !canarySignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI-change/canary signals — DEP-R1 may be NOT_APPLICABLE if no high-traffic AI changes ship.",
    );
  }
  if (opts.canary.found) {
    notes.push(`Canary refs: ${opts.canary.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.rollbackCriteria.found) {
    notes.push(
      `Rollback-criteria refs: ${opts.rollbackCriteria.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (highTraffic=${opts.imported.highTrafficAiChangeCount}, canary=${opts.imported.canaryOrProgressiveConfigured}, rollbackCriteria=${opts.imported.automatedRollbackCriteriaPresent}, metricsLink=${opts.imported.lastHighTrafficReleaseHasCanaryMetricsLink})`,
    );
  } else if (canarySignalsPresent) {
    notes.push(
      "Canary signals alone are PARTIAL — import canaryOrProgressiveConfigured=true + automatedRollbackCriteriaPresent=true + lastHighTrafficReleaseHasCanaryMetricsLink=true (measuredAt ≤90d) under imports/ai-canary-progressive-delivery/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const canaryOk =
    opts.imported.canaryOrProgressiveConfigured === true || opts.canary.found;
  const rollbackOk =
    opts.imported.automatedRollbackCriteriaPresent === true ||
    opts.rollbackCriteria.found;
  const metricsOk =
    opts.imported.lastHighTrafficReleaseHasCanaryMetricsLink === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const noHighTraffic =
    opts.imported.found && opts.imported.highTrafficAiChangeCount === 0;

  let statusHint: AiCanaryProgressiveDeliveryReport["summary"]["statusHint"] =
    "not_demonstrated";
  let depR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !noHighTraffic &&
    (opts.imported.canaryOrProgressiveConfigured === false ||
      opts.imported.automatedRollbackCriteriaPresent === false ||
      opts.imported.lastHighTrafficReleaseHasCanaryMetricsLink === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (noHighTraffic) {
    statusHint = "not_applicable";
    depR1Satisfied = null;
    notes.push(
      "highTrafficAiChangeCount=0 — DEP-R1 NOT_APPLICABLE (no high-traffic AI changes in window).",
    );
  } else if (
    !opts.aiChangeSignals &&
    !canarySignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    depR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing canary/progressive config, missing automated rollback criteria, missing metrics link, or evidence older than 90 days — DEP-R1 fail.",
    );
  } else if (
    (canarySignalsPresent || opts.imported.found) &&
    canaryOk &&
    rollbackOk &&
    metricsOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depR1Satisfied = true;
  } else if (canarySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depR1Satisfied = false;
    if (opts.imported.found && !canaryOk) {
      notes.push("Import must show canaryOrProgressiveConfigured=true.");
    }
    if (opts.imported.found && !rollbackOk) {
      notes.push("Import must show automatedRollbackCriteriaPresent=true.");
    }
    if (opts.imported.found && !metricsOk) {
      notes.push(
        "Import must show lastHighTrafficReleaseHasCanaryMetricsLink=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DEP-R1 PASS.",
      );
    }
  } else if (opts.aiChangeSignals) {
    statusHint = "not_demonstrated";
    depR1Satisfied = null;
    notes.push(
      "AI change signals present but no canary / progressive-delivery evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      canary: opts.canary,
      rollbackCriteria: opts.rollbackCriteria,
    },
    importedResults: opts.imported,
    summary: {
      aiChangeSignalsPresent: opts.aiChangeSignals,
      canarySignalsPresent,
      depR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiCanaryProgressiveDeliveryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiChangeSignals = detectAiChangeSignals(ctx.targetPath, maxFiles);

    const canaryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CANARY_RE.test(path) ||
        ((AI_CHANGE_RE.test(path) || AI_CHANGE_RE.test(text)) &&
          CANARY_RE.test(text)),
      12,
    );
    const rollbackRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        ROLLBACK_CRITERIA_RE.test(path) ||
        ROLLBACK_CRITERIA_RE.test(text) ||
        (CANARY_RE.test(text) && METRICS_LINK_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiCanaryProgressiveDeliveryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      canary: { found: canaryRefs.length > 0, refs: canaryRefs },
      rollbackCriteria: {
        found: rollbackRefs.length > 0,
        refs: rollbackRefs,
      },
      aiChangeSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-canary-progressive-delivery-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-canary-progressive-delivery-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-canary-progressive-delivery",
          "dep-r1",
          DETECTOR_ID,
          ...(report.summary.depR1Satisfied ? ["dep-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.canary.refs,
        ...report.signals.rollbackCriteria.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-canary-progressive-delivery-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-R1 status=${report.summary.statusHint} canary=${report.summary.canarySignalsPresent} satisfied=${report.summary.depR1Satisfied}; report=imports/${PLUGIN_ID}/ai-canary-progressive-delivery-report.json`,
      nodes,
    };
  },
};
