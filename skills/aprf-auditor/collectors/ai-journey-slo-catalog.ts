/**
 * ai-journey-slo-catalog — PERF-M1 / repo-ai-journey-slo-catalog.
 *
 * Discovers SLO catalog for critical AI journeys (availability + latency).
 * Import sloCatalogConfigured + criticalAiJourneyCount≥1 +
 * journeysWithAvailabilityAndLatencyTargetsPct=100 under
 * imports/ai-journey-slo-catalog/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-journey-slo-catalog";
const RELATED = ["PERF-M1"] as const;
const DETECTOR_ID = "repo-ai-journey-slo-catalog";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CATALOG_RE =
  /\b(slo[\s_-]*catalog|service[\s_-]*level[\s_-]*objective|journey[\s_-]*slo|critical[\s_-]*journey|slo[\s_-]*registry)\b/i;

const AVAILABILITY_RE =
  /\b(availability[\s_-]*(slo|target|%)|uptime[\s_-]*(slo|target)|99\.\d+%|error[\s_-]*budget)\b/i;

const LATENCY_RE =
  /\b(latency[\s_-]*(slo|target|p95|p99)|p95|p99|ttft|time[\s_-]*to[\s_-]*first[\s_-]*token)\b/i;

const CRITICAL_JOURNEY_RE =
  /\b(critical[\s_-]*(ai[\s_-]*)?journey|tier[\s_-]*0[\s_-]*journey|user[\s_-]*journey[\s_-]*slo|ai[\s_-]*journey)\b/i;

export interface AiJourneySloCatalogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    catalog: { found: boolean; refs: string[] };
    availability: { found: boolean; refs: string[] };
    latency: { found: boolean; refs: string[] };
    criticalJourney: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sloCatalogConfigured: boolean | null;
    criticalAiJourneyCount: number | null;
    journeysWithAvailabilityAndLatencyTargetsPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    catalogSignalsPresent: boolean;
    perfM1Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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

function loadImported(
  ctx: CollectorContext,
): AiJourneySloCatalogReport["importedResults"] {
  const sources: string[] = [];
  let sloCatalogConfigured: boolean | null = null;
  let criticalAiJourneyCount: number | null = null;
  let journeysWithAvailabilityAndLatencyTargetsPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-journey-slo-catalog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      sloCatalogConfigured =
        asBool(data.sloCatalogConfigured) ??
        asBool(data.slo_catalog_configured) ??
        asBool(data.catalogConfigured) ??
        sloCatalogConfigured;
      criticalAiJourneyCount =
        asNum(data.criticalAiJourneyCount) ??
        asNum(data.critical_ai_journey_count) ??
        asNum(data.criticalJourneyCount) ??
        criticalAiJourneyCount;
      journeysWithAvailabilityAndLatencyTargetsPct =
        asNum(data.journeysWithAvailabilityAndLatencyTargetsPct) ??
        asNum(data.journeys_with_availability_and_latency_targets_pct) ??
        asNum(data.criticalJourneyCoveragePct) ??
        journeysWithAvailabilityAndLatencyTargetsPct;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sloCatalogConfigured,
    criticalAiJourneyCount,
    journeysWithAvailabilityAndLatencyTargetsPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiJourneySloCatalogReport(opts: {
  assessedAt: string;
  catalog: { found: boolean; refs: string[] };
  availability: { found: boolean; refs: string[] };
  latency: { found: boolean; refs: string[] };
  criticalJourney: { found: boolean; refs: string[] };
  imported: AiJourneySloCatalogReport["importedResults"];
}): AiJourneySloCatalogReport {
  const notes: string[] = [];
  const catalogSignalsPresent =
    opts.catalog.found ||
    opts.availability.found ||
    opts.latency.found ||
    opts.criticalJourney.found;

  if (!catalogSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI journey SLO-catalog signals — PERF-M1 may be NOT_APPLICABLE if no critical AI journeys are in scope.",
    );
  }
  if (opts.catalog.found) {
    notes.push(`Catalog refs: ${opts.catalog.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.criticalJourney.found) {
    notes.push(
      `Critical-journey refs: ${opts.criticalJourney.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (catalog=${opts.imported.sloCatalogConfigured}, journeys=${opts.imported.criticalAiJourneyCount}, coveragePct=${opts.imported.journeysWithAvailabilityAndLatencyTargetsPct})`,
    );
  } else if (catalogSignalsPresent) {
    notes.push(
      "Catalog signals alone are PARTIAL — import sloCatalogConfigured=true + criticalAiJourneyCount≥1 + journeysWithAvailabilityAndLatencyTargetsPct=100 (measuredAt ≤90d) under imports/ai-journey-slo-catalog/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const catalogOk = opts.imported.sloCatalogConfigured === true;
  const journeyOk =
    opts.imported.criticalAiJourneyCount !== null &&
    opts.imported.criticalAiJourneyCount >= 1;
  const coverageOk =
    opts.imported.journeysWithAvailabilityAndLatencyTargetsPct !== null &&
    opts.imported.journeysWithAvailabilityAndLatencyTargetsPct >=
      COVERAGE_PCT_MIN;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiJourneySloCatalogReport["summary"]["statusHint"];
  let perfM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.sloCatalogConfigured === false ||
      (typeof opts.imported.criticalAiJourneyCount === "number" &&
        opts.imported.criticalAiJourneyCount < 1) ||
      (typeof opts.imported.journeysWithAvailabilityAndLatencyTargetsPct ===
        "number" &&
        opts.imported.journeysWithAvailabilityAndLatencyTargetsPct <
          COVERAGE_PCT_MIN) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!catalogSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing SLO catalog, zero critical journeys, coverage <100%, or evidence older than 90 days — PERF-M1 fail.",
    );
  } else if (
    (catalogSignalsPresent || opts.imported.found) &&
    catalogOk &&
    journeyOk &&
    coverageOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfM1Satisfied = true;
  } else if (catalogSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfM1Satisfied = false;
    if (opts.imported.found && !catalogOk) {
      notes.push("Import must show sloCatalogConfigured=true.");
    }
    if (opts.imported.found && !journeyOk) {
      notes.push("Import must show criticalAiJourneyCount≥1.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show journeysWithAvailabilityAndLatencyTargetsPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      catalog: opts.catalog,
      availability: opts.availability,
      latency: opts.latency,
      criticalJourney: opts.criticalJourney,
    },
    importedResults: opts.imported,
    summary: {
      catalogSignalsPresent,
      perfM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiJourneySloCatalogCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const catalog = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CATALOG_RE.test(path) || CATALOG_RE.test(text),
      10,
    );
    const availability = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AVAILABILITY_RE.test(path) || AVAILABILITY_RE.test(text)) &&
        (CATALOG_RE.test(path + text) ||
          CRITICAL_JOURNEY_RE.test(path + text) ||
          /slo|journey/i.test(path + text)),
      8,
    );
    const latency = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LATENCY_RE.test(path) || LATENCY_RE.test(text)) &&
        (CATALOG_RE.test(path + text) ||
          CRITICAL_JOURNEY_RE.test(path + text) ||
          /slo|journey|ai|llm/i.test(path + text)),
      8,
    );
    const criticalJourney = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CRITICAL_JOURNEY_RE.test(path) || CRITICAL_JOURNEY_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiJourneySloCatalogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      catalog: { found: catalog.length > 0, refs: catalog },
      availability: { found: availability.length > 0, refs: availability },
      latency: { found: latency.length > 0, refs: latency },
      criticalJourney: {
        found: criticalJourney.length > 0,
        refs: criticalJourney,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-journey-slo-catalog-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-journey-slo-catalog-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-journey-slo-catalog",
          "perf-m1",
          DETECTOR_ID,
          ...(report.summary.perfM1Satisfied ? ["perf-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.catalog.refs,
        ...report.signals.availability.refs,
        ...report.signals.latency.refs,
        ...report.signals.criticalJourney.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-journey-slo-catalog-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-M1 status=${report.summary.statusHint} signals=${report.summary.catalogSignalsPresent} satisfied=${report.summary.perfM1Satisfied}; report=imports/${PLUGIN_ID}/ai-journey-slo-catalog-report.json`,
      nodes,
    };
  },
};
