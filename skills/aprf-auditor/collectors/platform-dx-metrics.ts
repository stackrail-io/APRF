/**
 * platform-dx-metrics — DX-R3 / repo-dx-metrics detector executor.
 *
 * Discovers time-to-safe-production + bypass-rate metric signals.
 * Import formulas + ≥30d series + bypass alert/owner under
 * imports/platform-dx-metrics/ to unlock PASS.
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

const PLUGIN_ID = "platform-dx-metrics";
const RELATED = ["DX-R3"] as const;
const DETECTOR_ID = "repo-dx-metrics";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PLATFORM_RE =
  /(ai[\s_-]*platform|paved[\s_-]*road|golden[\s_-]*path|platform[\s_-]*dx|devtools|inner[\s_-]*loop)/i;

const TTSP_RE =
  /\b(time[\s_-]*to[\s_-]*safe[\s_-]*production|ttsp|time[\s_-]*to[\s_-]*(prod|production)[\s_-]*safe|safe[\s_-]*path[\s_-]*lead[\s_-]*time)\b/i;

const BYPASS_RE =
  /\b(policy[\s_-]*bypass|bypass[\s_-]*rate|paved[\s_-]*road[\s_-]*bypass|golden[\s_-]*path[\s_-]*bypass|escape[\s_-]*hatch[\s_-]*rate)\b/i;

const FORMULA_RE =
  /\b(formula|definition|numerator|denominator|calculated[\s_-]*as|metric[\s_-]*def)\b/i;

const SERIES_RE =
  /\b(dashboard|grafana|datadog|weekly[\s_-]*report|time[\s_-]*series|last[\s_-]*30[\s_-]*days|30[\s_-]*day)\b/i;

const ALERT_RE =
  /\b(alert|threshold|slo|review[\s_-]*threshold|pager|on[\s_-]*call)\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|accountable|metric[\s_-]*owner|steward)\b/i;

export interface PlatformDxMetricsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  metrics: {
    timeToSafeProduction: { found: boolean; refs: string[] };
    bypassRate: { found: boolean; refs: string[] };
    formulas: { found: boolean; refs: string[] };
    series: { found: boolean; refs: string[] };
    bypassAlert: { found: boolean; refs: string[] };
    bypassOwner: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    ttspFormulaDefined: boolean | null;
    bypassFormulaDefined: boolean | null;
    publishedConsecutiveDays: number | null;
    publishedFor30Days: boolean | null;
    bypassHasAlertOrThreshold: boolean | null;
    bypassOwnerNamed: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiPlatformSignalsPresent: boolean;
    bothMetricsPresent: boolean;
    dxR3Satisfied: boolean | null;
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

function detectPlatformSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PLATFORM_RE.test(path) ||
        AI_PLATFORM_RE.test(text) ||
        TTSP_RE.test(text) ||
        BYPASS_RE.test(text),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): PlatformDxMetricsReport["importedResults"] {
  const sources: string[] = [];
  let ttspFormulaDefined: boolean | null = null;
  let bypassFormulaDefined: boolean | null = null;
  let publishedConsecutiveDays: number | null = null;
  let publishedFor30Days: boolean | null = null;
  let bypassHasAlertOrThreshold: boolean | null = null;
  let bypassOwnerNamed: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-dx-metrics-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ttspFormulaDefined =
        asBool(data.ttspFormulaDefined) ??
        asBool(data.timeToSafeProductionDefined) ??
        asBool(data.hasTtspFormula) ??
        ttspFormulaDefined;
      bypassFormulaDefined =
        asBool(data.bypassFormulaDefined) ??
        asBool(data.bypassRateDefined) ??
        asBool(data.hasBypassFormula) ??
        bypassFormulaDefined;
      publishedConsecutiveDays =
        asNum(data.publishedConsecutiveDays) ??
        asNum(data.consecutiveDays) ??
        publishedConsecutiveDays;
      publishedFor30Days =
        asBool(data.publishedFor30Days) ??
        asBool(data.has30DaySeries) ??
        publishedFor30Days;
      if (
        publishedFor30Days == null &&
        publishedConsecutiveDays !== null
      ) {
        publishedFor30Days = publishedConsecutiveDays >= 30;
      }
      bypassHasAlertOrThreshold =
        asBool(data.bypassHasAlertOrThreshold) ??
        asBool(data.hasBypassAlert) ??
        asBool(data.bypassThresholdConfigured) ??
        bypassHasAlertOrThreshold;
      bypassOwnerNamed =
        asBool(data.bypassOwnerNamed) ??
        asBool(data.hasBypassOwner) ??
        bypassOwnerNamed;
      if (typeof data.bypassOwner === "string" && data.bypassOwner.trim()) {
        bypassOwnerNamed = true;
      }
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    ttspFormulaDefined,
    bypassFormulaDefined,
    publishedConsecutiveDays,
    publishedFor30Days,
    bypassHasAlertOrThreshold,
    bypassOwnerNamed,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformDxMetricsReport(opts: {
  assessedAt: string;
  metrics: PlatformDxMetricsReport["metrics"];
  aiPlatformSignals: boolean;
  imported: PlatformDxMetricsReport["importedResults"];
}): PlatformDxMetricsReport {
  const notes: string[] = [];
  const bothFromRepo =
    opts.metrics.timeToSafeProduction.found && opts.metrics.bypassRate.found;
  const bothFromImport =
    opts.imported.ttspFormulaDefined === true &&
    opts.imported.bypassFormulaDefined === true;
  const bothMetricsPresent = bothFromRepo || bothFromImport;

  if (!opts.aiPlatformSignals && !bothMetricsPresent && !opts.imported.found) {
    notes.push(
      "No AI-platform DX metric signals — DX-R3 may be NOT_APPLICABLE if there is no paved-road surface to measure.",
    );
  }
  if (opts.metrics.timeToSafeProduction.found) {
    notes.push(
      `TTSP refs: ${opts.metrics.timeToSafeProduction.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No time-to-safe-production metric signals found.");
  }
  if (opts.metrics.bypassRate.found) {
    notes.push(
      `Bypass-rate refs: ${opts.metrics.bypassRate.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No policy-bypass rate metric signals found.");
  }
  if (opts.metrics.formulas.found) {
    notes.push(
      `Formula refs: ${opts.metrics.formulas.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.metrics.series.found) {
    notes.push(
      `Series/dashboard refs: ${opts.metrics.series.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (ttsp=${opts.imported.ttspFormulaDefined}, bypass=${opts.imported.bypassFormulaDefined}, days=${opts.imported.publishedConsecutiveDays}, published30=${opts.imported.publishedFor30Days}, alert=${opts.imported.bypassHasAlertOrThreshold}, owner=${opts.imported.bypassOwnerNamed}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (bothMetricsPresent) {
    notes.push(
      "Metric name signals alone are PARTIAL — import formulas + ≥30d series + bypass alert/owner ≤90d under imports/platform-dx-metrics/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const seriesOk =
    opts.imported.publishedFor30Days === true ||
    (opts.imported.publishedConsecutiveDays !== null &&
      opts.imported.publishedConsecutiveDays >= 30);
  const passOk =
    opts.imported.ttspFormulaDefined === true &&
    opts.imported.bypassFormulaDefined === true &&
    seriesOk &&
    opts.imported.bypassHasAlertOrThreshold === true &&
    opts.imported.bypassOwnerNamed === true &&
    ageOk &&
    importFresh;

  let statusHint: PlatformDxMetricsReport["summary"]["statusHint"];
  let dxR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.ttspFormulaDefined === false ||
      opts.imported.bypassFormulaDefined === false ||
      opts.imported.publishedFor30Days === false ||
      (opts.imported.publishedConsecutiveDays !== null &&
        opts.imported.publishedConsecutiveDays < 30) ||
      opts.imported.bypassHasAlertOrThreshold === false ||
      opts.imported.bypassOwnerNamed === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiPlatformSignals &&
    !opts.metrics.timeToSafeProduction.found &&
    !opts.metrics.bypassRate.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dxR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxR3Satisfied = false;
    notes.push(
      "Imported results show missing formulas/series/alert/owner or evidence older than 90 days — DX-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxR3Satisfied = true;
  } else if (
    opts.metrics.timeToSafeProduction.found ||
    opts.metrics.bypassRate.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dxR3Satisfied = false;
    if (opts.imported.found) {
      if (
        opts.imported.ttspFormulaDefined !== true ||
        opts.imported.bypassFormulaDefined !== true
      ) {
        notes.push(
          "Import must show ttspFormulaDefined and bypassFormulaDefined=true.",
        );
      }
      if (!seriesOk) {
        notes.push(
          "Import must show publishedFor30Days=true or publishedConsecutiveDays≥30.",
        );
      }
      if (opts.imported.bypassHasAlertOrThreshold !== true) {
        notes.push("Import must show bypassHasAlertOrThreshold=true.");
      }
      if (opts.imported.bypassOwnerNamed !== true) {
        notes.push("Import must show bypassOwnerNamed=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DX-R3 PASS.",
        );
      }
    }
  } else if (opts.aiPlatformSignals) {
    statusHint = "not_demonstrated";
    dxR3Satisfied = null;
    notes.push(
      "AI-platform signals present but no TTSP/bypass DX metrics found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    metrics: opts.metrics,
    importedResults: opts.imported,
    summary: {
      aiPlatformSignalsPresent: opts.aiPlatformSignals,
      bothMetricsPresent,
      dxR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformDxMetricsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiPlatformSignals = detectPlatformSignals(ctx.targetPath, maxFiles);

    const inDxContext = (path: string, text: string) =>
      AI_PLATFORM_RE.test(path) ||
      AI_PLATFORM_RE.test(text) ||
      /metric|dashboard|dx|bypass|ttsp/i.test(path);

    const ttspRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TTSP_RE.test(path) || TTSP_RE.test(text)) && inDxContext(path, text),
    );
    const bypassRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (BYPASS_RE.test(path) || BYPASS_RE.test(text)) &&
        inDxContext(path, text),
    );
    const formulaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FORMULA_RE.test(path) || FORMULA_RE.test(text)) &&
        (TTSP_RE.test(text) || BYPASS_RE.test(text) || inDxContext(path, text)),
      12,
    );
    const seriesRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SERIES_RE.test(path) || SERIES_RE.test(text)) &&
        inDxContext(path, text),
      12,
    );
    const alertRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ALERT_RE.test(path) || ALERT_RE.test(text)) &&
        (BYPASS_RE.test(text) || inDxContext(path, text)),
      12,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) &&
        (BYPASS_RE.test(text) || TTSP_RE.test(text) || inDxContext(path, text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPlatformDxMetricsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      metrics: {
        timeToSafeProduction: {
          found: ttspRefs.length > 0,
          refs: ttspRefs,
        },
        bypassRate: { found: bypassRefs.length > 0, refs: bypassRefs },
        formulas: { found: formulaRefs.length > 0, refs: formulaRefs },
        series: { found: seriesRefs.length > 0, refs: seriesRefs },
        bypassAlert: { found: alertRefs.length > 0, refs: alertRefs },
        bypassOwner: { found: ownerRefs.length > 0, refs: ownerRefs },
      },
      aiPlatformSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-dx-metrics-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/platform-dx-metrics-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-dx-metrics",
          "dx-r3",
          DETECTOR_ID,
          ...(report.summary.bothMetricsPresent ? ["ttsp-and-bypass"] : []),
          ...(report.summary.dxR3Satisfied ? ["dx-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...ttspRefs.slice(0, 2),
        ...bypassRefs.slice(0, 2),
        ...seriesRefs.slice(0, 2),
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
        signals: ["platform-dx-metrics-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-R3 status=${report.summary.statusHint} both=${report.summary.bothMetricsPresent} satisfied=${report.summary.dxR3Satisfied}; report=imports/${PLUGIN_ID}/platform-dx-metrics-report.json`,
      nodes,
    };
  },
};
