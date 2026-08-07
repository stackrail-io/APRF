/**
 * ai-continuity-options — REL-R3 / repo-ai-continuity-options.
 *
 * Discovers continuity-options docs for critical AI-dependent processes.
 * Import continuityOptionsDocumented + criticalAiProcessCount≥1 +
 * criticalAiProcessesWithOwnedContinuityOptionPct=100 under
 * imports/ai-continuity-options/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-continuity-options";
const RELATED = ["REL-R3"] as const;
const DETECTOR_ID = "repo-ai-continuity-options";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|ai[_-]?gateway)/i;

const CONTINUITY_RE =
  /\b(continuity[_-]?(option|plan|doc)|failover|alternate[_-]?(provider|model|vendor)|manual[_-]?(procedure|fallback|runbook)|backup[_-]?provider|secondary[_-]?(model|provider))\b/i;

const CRITICAL_AI_PROCESS_RE =
  /\b(critical[_-]?ai[_-]?(dependent|process)|ai[_-]?dependent[_-]?process|mission[_-]?critical[_-]?ai|critical[_-]?process)\b/i;

const OWNER_RE =
  /\b(owner|owned[_-]?by|responsible|raci|accountable)\b/i;

export interface AiContinuityOptionsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    continuity: { found: boolean; refs: string[] };
    criticalProcess: { found: boolean; refs: string[] };
    owner: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    continuityOptionsDocumented: boolean | null;
    criticalAiProcessCount: number | null;
    criticalAiProcessesWithOwnedContinuityOptionPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    continuitySignalsPresent: boolean;
    relR3Satisfied: boolean | null;
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

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiContinuityOptionsReport["importedResults"] {
  const sources: string[] = [];
  let continuityOptionsDocumented: boolean | null = null;
  let criticalAiProcessCount: number | null = null;
  let criticalAiProcessesWithOwnedContinuityOptionPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-continuity-options-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      continuityOptionsDocumented =
        asBool(data.continuityOptionsDocumented) ??
        asBool(data.continuity_options_documented) ??
        asBool(data.continuityDocExists) ??
        continuityOptionsDocumented;
      criticalAiProcessCount =
        asNum(data.criticalAiProcessCount) ??
        asNum(data.critical_ai_process_count) ??
        asNum(data.criticalProcessCount) ??
        criticalAiProcessCount;
      criticalAiProcessesWithOwnedContinuityOptionPct =
        asNum(data.criticalAiProcessesWithOwnedContinuityOptionPct) ??
        asNum(data.critical_ai_processes_with_owned_continuity_option_pct) ??
        asNum(data.coveragePct) ??
        criticalAiProcessesWithOwnedContinuityOptionPct;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    continuityOptionsDocumented,
    criticalAiProcessCount,
    criticalAiProcessesWithOwnedContinuityOptionPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiContinuityOptionsReport(opts: {
  assessedAt: string;
  continuity: { found: boolean; refs: string[] };
  criticalProcess: { found: boolean; refs: string[] };
  owner: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiContinuityOptionsReport["importedResults"];
}): AiContinuityOptionsReport {
  const notes: string[] = [];
  const continuitySignalsPresent =
    opts.continuity.found ||
    opts.criticalProcess.found ||
    opts.owner.found;

  if (!opts.aiSignals && !continuitySignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI continuity-option signals — REL-R3 may be NOT_APPLICABLE if there are no critical AI-dependent processes.",
    );
  }
  if (opts.continuity.found) {
    notes.push(
      `Continuity-option refs: ${opts.continuity.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.criticalProcess.found) {
    notes.push(
      `Critical-process refs: ${opts.criticalProcess.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (documented=${opts.imported.continuityOptionsDocumented}, processes=${opts.imported.criticalAiProcessCount}, coveragePct=${opts.imported.criticalAiProcessesWithOwnedContinuityOptionPct})`,
    );
  } else if (continuitySignalsPresent) {
    notes.push(
      "Continuity signals alone are PARTIAL — import continuityOptionsDocumented=true + criticalAiProcessCount≥1 + criticalAiProcessesWithOwnedContinuityOptionPct=100 (measuredAt ≤90d) under imports/ai-continuity-options/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const documentedOk = opts.imported.continuityOptionsDocumented === true;
  const processOk =
    opts.imported.criticalAiProcessCount !== null &&
    opts.imported.criticalAiProcessCount >= 1;
  const coverageOk =
    opts.imported.criticalAiProcessesWithOwnedContinuityOptionPct !== null &&
    opts.imported.criticalAiProcessesWithOwnedContinuityOptionPct >=
      COVERAGE_PCT_MIN;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiContinuityOptionsReport["summary"]["statusHint"];
  let relR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.continuityOptionsDocumented === false ||
      (typeof opts.imported.criticalAiProcessCount === "number" &&
        opts.imported.criticalAiProcessCount < 1) ||
      (typeof opts.imported
        .criticalAiProcessesWithOwnedContinuityOptionPct === "number" &&
        opts.imported.criticalAiProcessesWithOwnedContinuityOptionPct <
          COVERAGE_PCT_MIN) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiSignals && !continuitySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing continuity docs, zero critical AI processes, coverage <100%, or evidence older than 90 days — REL-R3 fail.",
    );
  } else if (
    (continuitySignalsPresent || opts.imported.found) &&
    documentedOk &&
    processOk &&
    coverageOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR3Satisfied = true;
  } else if (continuitySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR3Satisfied = false;
    if (opts.imported.found && !documentedOk) {
      notes.push("Import must show continuityOptionsDocumented=true.");
    }
    if (opts.imported.found && !processOk) {
      notes.push("Import must show criticalAiProcessCount≥1.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show criticalAiProcessesWithOwnedContinuityOptionPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R3 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    relR3Satisfied = null;
    notes.push(
      "AI signals present but no continuity-options evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      continuity: opts.continuity,
      criticalProcess: opts.criticalProcess,
      owner: opts.owner,
    },
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      continuitySignalsPresent,
      relR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiContinuityOptionsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const continuityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CONTINUITY_RE.test(path) ||
        (CONTINUITY_RE.test(text) &&
          (AI_PATH_RE.test(path + text) ||
            CRITICAL_AI_PROCESS_RE.test(path + text) ||
            /process|failover|provider/i.test(text))),
      10,
    );
    const criticalProcessRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CRITICAL_AI_PROCESS_RE.test(path) ||
        CRITICAL_AI_PROCESS_RE.test(text),
      8,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) &&
        (CONTINUITY_RE.test(path + text) ||
          CRITICAL_AI_PROCESS_RE.test(path + text)),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiContinuityOptionsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      continuity: { found: continuityRefs.length > 0, refs: continuityRefs },
      criticalProcess: {
        found: criticalProcessRefs.length > 0,
        refs: criticalProcessRefs,
      },
      owner: { found: ownerRefs.length > 0, refs: ownerRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-continuity-options-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-continuity-options-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-continuity-options",
          "rel-r3",
          DETECTOR_ID,
          ...(report.summary.relR3Satisfied ? ["rel-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.continuity.refs,
        ...report.signals.criticalProcess.refs,
        ...report.signals.owner.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-continuity-options-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R3 status=${report.summary.statusHint} signals=${report.summary.continuitySignalsPresent} satisfied=${report.summary.relR3Satisfied}; report=imports/${PLUGIN_ID}/ai-continuity-options-report.json`,
      nodes,
    };
  },
};
