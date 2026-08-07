/**
 * ai-streaming-slis — PERF-R3 / repo-ai-streaming-slis.
 *
 * Discovers TTFT + inter-token latency SLIs for streaming AI surfaces.
 * Import ttftSliConfiguredForStreamingSurfaces +
 * interTokenLatencySliConfiguredForStreamingSurfaces +
 * streamingSliAlertsConfigured + streamingSeriesRetainedAtLeast30Days
 * under imports/ai-streaming-slis/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-streaming-slis";
const RELATED = ["PERF-R3"] as const;
const DETECTOR_ID = "repo-ai-streaming-slis";
const IMPORT_MAX_AGE_DAYS = 90;
const RETENTION_MIN_DAYS = 30;

const STREAMING_RE =
  /\b(streaming|sse|server[\s_-]*sent|websocket|token[\s_-]*stream|chat[\s_-]*stream|stream[\s_-]*completion)\b/i;

const TTFT_RE =
  /\b(ttft|time[\s_-]*to[\s_-]*first[\s_-]*token|first[\s_-]*token[\s_-]*latency|time[\s_-]*to[\s_-]*first[\s_-]*byte)\b/i;

const INTER_TOKEN_RE =
  /\b(inter[\s_-]*token|time[\s_-]*between[\s_-]*tokens|token[\s_-]*latency|tokens[\s_-]*per[\s_-]*second|tps|decode[\s_-]*latency)\b/i;

const ALERT_RE =
  /\b(ttft[\s_-]*alert|streaming[\s_-]*alert|inter[\s_-]*token[\s_-]*alert|alert.{0,30}(ttft|streaming|inter[\s_-]*token))\b/i;

const RETENTION_RE =
  /\b(retention|retain.{0,20}(30|thirty)[\s_-]*day|metric[\s_-]*retention|series[\s_-]*retention)\b/i;

export interface AiStreamingSlisReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    streaming: { found: boolean; refs: string[] };
    ttft: { found: boolean; refs: string[] };
    interToken: { found: boolean; refs: string[] };
    alert: { found: boolean; refs: string[] };
    retention: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    ttftSliConfiguredForStreamingSurfaces: boolean | null;
    interTokenLatencySliConfiguredForStreamingSurfaces: boolean | null;
    streamingSliAlertsConfigured: boolean | null;
    streamingSeriesRetainedAtLeast30Days: boolean | null;
    streamingSeriesRetentionDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    streamingSignalsPresent: boolean;
    perfR3Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS_DOCS],
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
): AiStreamingSlisReport["importedResults"] {
  const sources: string[] = [];
  let ttftSliConfiguredForStreamingSurfaces: boolean | null = null;
  let interTokenLatencySliConfiguredForStreamingSurfaces: boolean | null =
    null;
  let streamingSliAlertsConfigured: boolean | null = null;
  let streamingSeriesRetainedAtLeast30Days: boolean | null = null;
  let streamingSeriesRetentionDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-streaming-slis-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      streamingSeriesRetentionDays =
        asNum(data.streamingSeriesRetentionDays) ??
        asNum(data.streaming_series_retention_days) ??
        asNum(data.retentionDays) ??
        streamingSeriesRetentionDays;
      ttftSliConfiguredForStreamingSurfaces =
        asBool(data.ttftSliConfiguredForStreamingSurfaces) ??
        asBool(data.ttft_sli_configured_for_streaming_surfaces) ??
        asBool(data.ttftSliConfigured) ??
        ttftSliConfiguredForStreamingSurfaces;
      interTokenLatencySliConfiguredForStreamingSurfaces =
        asBool(data.interTokenLatencySliConfiguredForStreamingSurfaces) ??
        asBool(data.inter_token_latency_sli_configured_for_streaming_surfaces) ??
        asBool(data.interTokenSliConfigured) ??
        interTokenLatencySliConfiguredForStreamingSurfaces;
      streamingSliAlertsConfigured =
        asBool(data.streamingSliAlertsConfigured) ??
        asBool(data.streaming_sli_alerts_configured) ??
        asBool(data.streamingAlertsConfigured) ??
        streamingSliAlertsConfigured;
      streamingSeriesRetainedAtLeast30Days =
        asBool(data.streamingSeriesRetainedAtLeast30Days) ??
        asBool(data.streaming_series_retained_at_least_30_days) ??
        streamingSeriesRetainedAtLeast30Days;

      if (streamingSeriesRetentionDays !== null) {
        streamingSeriesRetainedAtLeast30Days =
          streamingSeriesRetainedAtLeast30Days ??
          streamingSeriesRetentionDays >= RETENTION_MIN_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    ttftSliConfiguredForStreamingSurfaces,
    interTokenLatencySliConfiguredForStreamingSurfaces,
    streamingSliAlertsConfigured,
    streamingSeriesRetainedAtLeast30Days,
    streamingSeriesRetentionDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiStreamingSlisReport(opts: {
  assessedAt: string;
  streaming: { found: boolean; refs: string[] };
  ttft: { found: boolean; refs: string[] };
  interToken: { found: boolean; refs: string[] };
  alert: { found: boolean; refs: string[] };
  retention: { found: boolean; refs: string[] };
  imported: AiStreamingSlisReport["importedResults"];
}): AiStreamingSlisReport {
  const notes: string[] = [];
  const streamingSignalsPresent =
    opts.streaming.found ||
    opts.ttft.found ||
    opts.interToken.found ||
    opts.alert.found ||
    opts.retention.found;

  if (!streamingSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI streaming-SLI signals — PERF-R3 may be NOT_APPLICABLE if no streaming AI surfaces are in scope.",
    );
  }
  if (opts.ttft.found) {
    notes.push(`TTFT refs: ${opts.ttft.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (ttft=${opts.imported.ttftSliConfiguredForStreamingSurfaces}, interToken=${opts.imported.interTokenLatencySliConfiguredForStreamingSurfaces}, alerts=${opts.imported.streamingSliAlertsConfigured}, retention30d=${opts.imported.streamingSeriesRetainedAtLeast30Days}, retentionDays=${opts.imported.streamingSeriesRetentionDays})`,
    );
  } else if (streamingSignalsPresent) {
    notes.push(
      "Streaming signals alone are PARTIAL — import ttftSliConfiguredForStreamingSurfaces=true + interTokenLatencySliConfiguredForStreamingSurfaces=true + streamingSliAlertsConfigured=true + streamingSeriesRetainedAtLeast30Days=true (measuredAt ≤90d) under imports/ai-streaming-slis/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const ttftOk = opts.imported.ttftSliConfiguredForStreamingSurfaces === true;
  const interOk =
    opts.imported.interTokenLatencySliConfiguredForStreamingSurfaces === true;
  const alertOk = opts.imported.streamingSliAlertsConfigured === true;
  const retentionOk =
    opts.imported.streamingSeriesRetainedAtLeast30Days === true ||
    (opts.imported.streamingSeriesRetentionDays !== null &&
      opts.imported.streamingSeriesRetentionDays >= RETENTION_MIN_DAYS);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiStreamingSlisReport["summary"]["statusHint"];
  let perfR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.ttftSliConfiguredForStreamingSurfaces === false ||
      opts.imported.interTokenLatencySliConfiguredForStreamingSurfaces ===
        false ||
      opts.imported.streamingSliAlertsConfigured === false ||
      opts.imported.streamingSeriesRetainedAtLeast30Days === false ||
      (typeof opts.imported.streamingSeriesRetentionDays === "number" &&
        opts.imported.streamingSeriesRetentionDays < RETENTION_MIN_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!streamingSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing TTFT/inter-token SLIs, missing alerts, retention <30d, or evidence older than 90 days — PERF-R3 fail.",
    );
  } else if (
    (streamingSignalsPresent || opts.imported.found) &&
    ttftOk &&
    interOk &&
    alertOk &&
    retentionOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfR3Satisfied = true;
  } else if (streamingSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfR3Satisfied = false;
    if (opts.imported.found && !ttftOk) {
      notes.push(
        "Import must show ttftSliConfiguredForStreamingSurfaces=true.",
      );
    }
    if (opts.imported.found && !interOk) {
      notes.push(
        "Import must show interTokenLatencySliConfiguredForStreamingSurfaces=true.",
      );
    }
    if (opts.imported.found && !alertOk) {
      notes.push("Import must show streamingSliAlertsConfigured=true.");
    }
    if (opts.imported.found && !retentionOk) {
      notes.push(
        "Import must show streamingSeriesRetainedAtLeast30Days=true (or streamingSeriesRetentionDays≥30).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      streaming: opts.streaming,
      ttft: opts.ttft,
      interToken: opts.interToken,
      alert: opts.alert,
      retention: opts.retention,
    },
    importedResults: opts.imported,
    summary: {
      streamingSignalsPresent,
      perfR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiStreamingSlisCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const streaming = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => STREAMING_RE.test(path) || STREAMING_RE.test(text),
      10,
    );
    const ttft = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TTFT_RE.test(path) || TTFT_RE.test(text),
      8,
    );
    const interToken = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INTER_TOKEN_RE.test(path) || INTER_TOKEN_RE.test(text),
      8,
    );
    const alert = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ALERT_RE.test(path) || ALERT_RE.test(text),
      6,
    );
    const retention = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RETENTION_RE.test(path) || RETENTION_RE.test(text)) &&
        (STREAMING_RE.test(path + text) ||
          TTFT_RE.test(path + text) ||
          /metric|sli|stream/i.test(path + text)),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiStreamingSlisReport({
      assessedAt: ctx.assessedAt.toISOString(),
      streaming: { found: streaming.length > 0, refs: streaming },
      ttft: { found: ttft.length > 0, refs: ttft },
      interToken: { found: interToken.length > 0, refs: interToken },
      alert: { found: alert.length > 0, refs: alert },
      retention: { found: retention.length > 0, refs: retention },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-streaming-slis-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-streaming-slis-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-streaming-slis",
          "perf-r3",
          DETECTOR_ID,
          ...(report.summary.perfR3Satisfied ? ["perf-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.streaming.refs,
        ...report.signals.ttft.refs,
        ...report.signals.interToken.refs,
        ...report.signals.alert.refs,
        ...report.signals.retention.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-streaming-slis-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-R3 status=${report.summary.statusHint} signals=${report.summary.streamingSignalsPresent} satisfied=${report.summary.perfR3Satisfied}; report=imports/${PLUGIN_ID}/ai-streaming-slis-report.json`,
      nodes,
    };
  },
};
