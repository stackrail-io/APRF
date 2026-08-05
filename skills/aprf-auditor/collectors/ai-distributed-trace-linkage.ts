/**
 * ai-distributed-trace-linkage — OBS-M1 / repo-ai-distributed-trace-linkage.
 *
 * Discovers request→model→tool→outcome tracing instrumentation.
 * Import linkedTracePct≥95 (+ optional sampleWindowHours≥24) under
 * imports/ai-distributed-trace-linkage/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-distributed-trace-linkage";
const RELATED = ["OBS-M1"] as const;
const DETECTOR_ID = "repo-ai-distributed-trace-linkage";
const IMPORT_MAX_AGE_DAYS = 90;
const LINKED_PCT_MIN = 95;
const SAMPLE_WINDOW_HOURS_MIN = 24;

const TRACE_CONFIG_RE =
  /\b(opentelemetry|otel|otlp|tracer[\s_-]*provider|distributed[\s_-]*trac|trace[\s_-]*parent|propagation)\b/i;

const MODEL_SPAN_RE =
  /\b(llm[\s_-]*span|model[\s_-]*span|gen[\s_-]*ai|openai|anthropic|completion[\s_-]*span|chat[\s_-]*span|embedding[\s_-]*span)\b/i;

const TOOL_SPAN_RE =
  /\b(tool[\s_-]*span|tool[\s_-]*call|function[\s_-]*call|mcp[\s_-]*span|agent[\s_-]*tool)\b/i;

const OUTCOME_RE =
  /\b(outcome|response[\s_-]*span|request[\s_-]*id|traceparent|parent[\s_-]*span|end[\s_-]*to[\s_-]*end)\b/i;

export interface AiDistributedTraceLinkageReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    traceConfig: { found: boolean; refs: string[] };
    modelSpans: { found: boolean; refs: string[] };
    toolSpans: { found: boolean; refs: string[] };
    outcomeLinkage: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    linkedTracePct: number | null;
    sampleWindowHours: number | null;
    coversModelToolOutcome: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    linkageSignalsPresent: boolean;
    obsM1Satisfied: boolean | null;
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
    extensions: [
      ".ts",
      ".js",
      ".py",
      ".go",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".tf",
    ],
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
): AiDistributedTraceLinkageReport["importedResults"] {
  const sources: string[] = [];
  let linkedTracePct: number | null = null;
  let sampleWindowHours: number | null = null;
  let coversModelToolOutcome: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-distributed-trace-linkage-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      linkedTracePct =
        asNum(data.linkedTracePct) ??
        asNum(data.linked_trace_pct) ??
        asNum(data.canaryLinkedTracePct) ??
        linkedTracePct;
      sampleWindowHours =
        asNum(data.sampleWindowHours) ??
        asNum(data.sample_window_hours) ??
        sampleWindowHours;
      coversModelToolOutcome =
        asBool(data.coversModelToolOutcome) ??
        asBool(data.covers_model_tool_outcome) ??
        asBool(data.requestModelToolOutcomeLinked) ??
        coversModelToolOutcome;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    linkedTracePct,
    sampleWindowHours,
    coversModelToolOutcome,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDistributedTraceLinkageReport(opts: {
  assessedAt: string;
  traceConfig: { found: boolean; refs: string[] };
  modelSpans: { found: boolean; refs: string[] };
  toolSpans: { found: boolean; refs: string[] };
  outcomeLinkage: { found: boolean; refs: string[] };
  imported: AiDistributedTraceLinkageReport["importedResults"];
}): AiDistributedTraceLinkageReport {
  const notes: string[] = [];
  const linkageSignalsPresent =
    opts.traceConfig.found ||
    opts.modelSpans.found ||
    opts.toolSpans.found ||
    opts.outcomeLinkage.found;

  if (!linkageSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI distributed-trace linkage signals — OBS-M1 may be NOT_APPLICABLE if no production AI request path is in scope.",
    );
  }
  if (opts.traceConfig.found) {
    notes.push(`Trace config refs: ${opts.traceConfig.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.modelSpans.found) {
    notes.push(`Model span refs: ${opts.modelSpans.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.toolSpans.found) {
    notes.push(`Tool span refs: ${opts.toolSpans.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.outcomeLinkage.found) {
    notes.push(
      `Outcome/linkage refs: ${opts.outcomeLinkage.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (linkedPct=${opts.imported.linkedTracePct}, windowH=${opts.imported.sampleWindowHours}, covers=${opts.imported.coversModelToolOutcome})`,
    );
  } else if (linkageSignalsPresent) {
    notes.push(
      "Trace signals alone are PARTIAL — import linkedTracePct≥95 (and preferably sampleWindowHours≥24 + coversModelToolOutcome=true) with measuredAt ≤90d under imports/ai-distributed-trace-linkage/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const pctOk =
    opts.imported.linkedTracePct !== null &&
    opts.imported.linkedTracePct >= LINKED_PCT_MIN;
  const windowOk =
    opts.imported.sampleWindowHours !== null &&
    opts.imported.sampleWindowHours >= SAMPLE_WINDOW_HOURS_MIN;
  const coversOk = opts.imported.coversModelToolOutcome === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiDistributedTraceLinkageReport["summary"]["statusHint"];
  let obsM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((typeof opts.imported.linkedTracePct === "number" &&
      opts.imported.linkedTracePct < LINKED_PCT_MIN) ||
      (typeof opts.imported.sampleWindowHours === "number" &&
        opts.imported.sampleWindowHours < SAMPLE_WINDOW_HOURS_MIN) ||
      opts.imported.coversModelToolOutcome === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!linkageSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsM1Satisfied = false;
    notes.push(
      "Imported evidence shows linkedTracePct<95, sample window <24h, missing model/tool/outcome coverage, or evidence older than 90 days — OBS-M1 fail.",
    );
  } else if (
    (linkageSignalsPresent || opts.imported.found) &&
    pctOk &&
    windowOk &&
    coversOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsM1Satisfied = true;
  } else if (linkageSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsM1Satisfied = false;
    if (opts.imported.found && !pctOk) {
      notes.push("Import must show linkedTracePct≥95.");
    }
    if (opts.imported.found && !windowOk) {
      notes.push("Import must show sampleWindowHours≥24.");
    }
    if (opts.imported.found && !coversOk) {
      notes.push("Import must show coversModelToolOutcome=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock OBS-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      traceConfig: opts.traceConfig,
      modelSpans: opts.modelSpans,
      toolSpans: opts.toolSpans,
      outcomeLinkage: opts.outcomeLinkage,
    },
    importedResults: opts.imported,
    summary: {
      linkageSignalsPresent,
      obsM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDistributedTraceLinkageCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const traceConfig = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TRACE_CONFIG_RE.test(path) || TRACE_CONFIG_RE.test(text),
      10,
    );
    const modelSpans = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MODEL_SPAN_RE.test(path) || MODEL_SPAN_RE.test(text),
      10,
    );
    const toolSpans = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TOOL_SPAN_RE.test(path) || TOOL_SPAN_RE.test(text),
      10,
    );
    const outcomeLinkage = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OUTCOME_RE.test(path) || OUTCOME_RE.test(text)) &&
        (TRACE_CONFIG_RE.test(path + text) ||
          MODEL_SPAN_RE.test(path + text) ||
          /request[\s_-]*id|traceparent/i.test(path + text)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiDistributedTraceLinkageReport({
      assessedAt: ctx.assessedAt.toISOString(),
      traceConfig: { found: traceConfig.length > 0, refs: traceConfig },
      modelSpans: { found: modelSpans.length > 0, refs: modelSpans },
      toolSpans: { found: toolSpans.length > 0, refs: toolSpans },
      outcomeLinkage: {
        found: outcomeLinkage.length > 0,
        refs: outcomeLinkage,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-distributed-trace-linkage-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-distributed-trace-linkage-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-distributed-trace-linkage",
          "obs-m1",
          DETECTOR_ID,
          ...(report.summary.obsM1Satisfied ? ["obs-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.traceConfig.refs,
        ...report.signals.modelSpans.refs,
        ...report.signals.toolSpans.refs,
        ...report.signals.outcomeLinkage.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-distributed-trace-linkage-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-M1 status=${report.summary.statusHint} signals=${report.summary.linkageSignalsPresent} satisfied=${report.summary.obsM1Satisfied}; report=imports/${PLUGIN_ID}/ai-distributed-trace-linkage-report.json`,
      nodes,
    };
  },
};
