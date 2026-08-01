/**
 * ai-trace-replay — OBS-R1 / repo-ai-trace-replay.
 *
 * Discovers secure failed-AI-trace replay tooling + recent drill/real replay.
 * Import restrictedReplayEnvironmentConfigured + replayWithinDocumentedRto +
 * lastDrillOrRealReplayWithin90Days under imports/ai-trace-replay/
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

const PLUGIN_ID = "ai-trace-replay";
const RELATED = ["OBS-R1"] as const;
const DETECTOR_ID = "repo-ai-trace-replay";
const IMPORT_MAX_AGE_DAYS = 90;
const REPLAY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const REPLAY_RE =
  /\b(trace[\s_-]*replay|replay[\s_-]*trace|span[\s_-]*replay|failed[\s_-]*trace[\s_-]*replay|debug[\s_-]*replay)\b/i;

const RESTRICTED_RE =
  /\b(restricted[\s_-]*env|secure[\s_-]*env|secure[\s_-]*replay|break[\s_-]*glass|privileged[\s_-]*debug|isolated[\s_-]*replay)\b/i;

const RTO_RE =
  /\b(rto|recovery[\s_-]*time|time[\s_-]*to[\s_-]*replay|replay[\s_-]*sla|within[\s_-]*\d+\s*(min|minute|m|hour|h))\b/i;

const DRILL_RE =
  /\b(replay[\s_-]*drill|drill[\s_-]*replay|last[\s_-]*replay|replay[\s_-]*session|game[\s_-]*day[\s_-]*replay)\b/i;

export interface AiTraceReplayReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    replay: { found: boolean; refs: string[] };
    restricted: { found: boolean; refs: string[] };
    rto: { found: boolean; refs: string[] };
    drill: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    restrictedReplayEnvironmentConfigured: boolean | null;
    replayWithinDocumentedRto: boolean | null;
    lastDrillOrRealReplayWithin90Days: boolean | null;
    lastReplayAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    replaySignalsPresent: boolean;
    obsR1Satisfied: boolean | null;
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
): AiTraceReplayReport["importedResults"] {
  const sources: string[] = [];
  let restrictedReplayEnvironmentConfigured: boolean | null = null;
  let replayWithinDocumentedRto: boolean | null = null;
  let lastDrillOrRealReplayWithin90Days: boolean | null = null;
  let lastReplayAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-trace-replay-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastReplayAgeDays =
        asNum(data.lastReplayAgeDays) ??
        asNum(data.last_replay_age_days) ??
        lastReplayAgeDays;
      restrictedReplayEnvironmentConfigured =
        asBool(data.restrictedReplayEnvironmentConfigured) ??
        asBool(data.restricted_replay_environment_configured) ??
        asBool(data.secureReplayConfigured) ??
        restrictedReplayEnvironmentConfigured;
      replayWithinDocumentedRto =
        asBool(data.replayWithinDocumentedRto) ??
        asBool(data.replay_within_documented_rto) ??
        replayWithinDocumentedRto;
      lastDrillOrRealReplayWithin90Days =
        asBool(data.lastDrillOrRealReplayWithin90Days) ??
        asBool(data.last_drill_or_real_replay_within_90_days) ??
        lastDrillOrRealReplayWithin90Days;

      if (lastReplayAgeDays !== null) {
        lastDrillOrRealReplayWithin90Days =
          lastDrillOrRealReplayWithin90Days ??
          lastReplayAgeDays <= REPLAY_MAX_AGE_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    restrictedReplayEnvironmentConfigured,
    replayWithinDocumentedRto,
    lastDrillOrRealReplayWithin90Days,
    lastReplayAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTraceReplayReport(opts: {
  assessedAt: string;
  replay: { found: boolean; refs: string[] };
  restricted: { found: boolean; refs: string[] };
  rto: { found: boolean; refs: string[] };
  drill: { found: boolean; refs: string[] };
  imported: AiTraceReplayReport["importedResults"];
}): AiTraceReplayReport {
  const notes: string[] = [];
  const replaySignalsPresent =
    opts.replay.found ||
    opts.restricted.found ||
    opts.rto.found ||
    opts.drill.found;

  if (!replaySignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI trace-replay signals — OBS-R1 may be NOT_APPLICABLE if no production AI tracing/failed traces are in scope.",
    );
  }
  if (opts.replay.found) {
    notes.push(`Replay refs: ${opts.replay.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.restricted.found) {
    notes.push(
      `Restricted-env refs: ${opts.restricted.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (restricted=${opts.imported.restrictedReplayEnvironmentConfigured}, rto=${opts.imported.replayWithinDocumentedRto}, recent=${opts.imported.lastDrillOrRealReplayWithin90Days}, age=${opts.imported.lastReplayAgeDays})`,
    );
  } else if (replaySignalsPresent) {
    notes.push(
      "Replay signals alone are PARTIAL — import restrictedReplayEnvironmentConfigured=true + replayWithinDocumentedRto=true + lastDrillOrRealReplayWithin90Days=true (measuredAt ≤90d) under imports/ai-trace-replay/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const restrictedOk =
    opts.imported.restrictedReplayEnvironmentConfigured === true;
  const rtoOk = opts.imported.replayWithinDocumentedRto === true;
  const recentOk =
    opts.imported.lastDrillOrRealReplayWithin90Days === true ||
    (opts.imported.lastReplayAgeDays !== null &&
      opts.imported.lastReplayAgeDays <= REPLAY_MAX_AGE_DAYS);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiTraceReplayReport["summary"]["statusHint"];
  let obsR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.restrictedReplayEnvironmentConfigured === false ||
      opts.imported.replayWithinDocumentedRto === false ||
      opts.imported.lastDrillOrRealReplayWithin90Days === false ||
      (typeof opts.imported.lastReplayAgeDays === "number" &&
        opts.imported.lastReplayAgeDays > REPLAY_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!replaySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing restricted replay, missed RTO, stale replay (>90d), or evidence older than 90 days — OBS-R1 fail.",
    );
  } else if (
    (replaySignalsPresent || opts.imported.found) &&
    restrictedOk &&
    rtoOk &&
    recentOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsR1Satisfied = true;
  } else if (replaySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsR1Satisfied = false;
    if (opts.imported.found && !restrictedOk) {
      notes.push(
        "Import must show restrictedReplayEnvironmentConfigured=true.",
      );
    }
    if (opts.imported.found && !rtoOk) {
      notes.push("Import must show replayWithinDocumentedRto=true.");
    }
    if (opts.imported.found && !recentOk) {
      notes.push(
        "Import must show lastDrillOrRealReplayWithin90Days=true (or lastReplayAgeDays≤90).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock OBS-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      replay: opts.replay,
      restricted: opts.restricted,
      rto: opts.rto,
      drill: opts.drill,
    },
    importedResults: opts.imported,
    summary: {
      replaySignalsPresent,
      obsR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiTraceReplayCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const replay = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REPLAY_RE.test(path) || REPLAY_RE.test(text),
      10,
    );
    const restricted = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RESTRICTED_RE.test(path) || RESTRICTED_RE.test(text)) &&
        (REPLAY_RE.test(path + text) || /trace|otel|span/i.test(path + text)),
      8,
    );
    const rto = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RTO_RE.test(path) || RTO_RE.test(text)) &&
        (REPLAY_RE.test(path + text) || /replay/i.test(path + text)),
      6,
    );
    const drill = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRILL_RE.test(path) || DRILL_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiTraceReplayReport({
      assessedAt: ctx.assessedAt.toISOString(),
      replay: { found: replay.length > 0, refs: replay },
      restricted: { found: restricted.length > 0, refs: restricted },
      rto: { found: rto.length > 0, refs: rto },
      drill: { found: drill.length > 0, refs: drill },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-trace-replay-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-trace-replay-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-trace-replay",
          "obs-r1",
          DETECTOR_ID,
          ...(report.summary.obsR1Satisfied ? ["obs-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.replay.refs,
        ...report.signals.restricted.refs,
        ...report.signals.rto.refs,
        ...report.signals.drill.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-trace-replay-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-R1 status=${report.summary.statusHint} signals=${report.summary.replaySignalsPresent} satisfied=${report.summary.obsR1Satisfied}; report=imports/${PLUGIN_ID}/ai-trace-replay-report.json`,
      nodes,
    };
  },
};
