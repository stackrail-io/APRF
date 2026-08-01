/**
 * ai-deletion-export — PRI-M2 / repo-ai-deletion-export detector executor.
 *
 * Discovers deletion/export paths covering AI memory and in-scope AI logs.
 * Import timed SLA test under imports/ai-deletion-export/ to unlock PASS.
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

const PLUGIN_ID = "ai-deletion-export";
const RELATED = ["PRI-M2"] as const;
const DETECTOR_ID = "repo-ai-deletion-export";
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(delet(?:e|ion)|export|erasure|gdpr|dsar|right[\s_-]*to[\s_-]*be[\s_-]*forgotten|purge|offboard)/i;

const MEMORY_RE =
  /\b(ai[\s_-]*memory|conversation[\s_-]*memory|durable[\s_-]*memory|vector[\s_-]*store|chat[\s_-]*history|retrieval[\s_-]*memory|session[\s_-]*memory)\b/i;

const LOG_RE =
  /\b(ai[\s_-]*logs?|model[\s_-]*logs?|prompt[\s_-]*logs?|llm[\s_-]*logs?|tool[\s_-]*logs?|inference[\s_-]*logs?)\b/i;

const SLA_RE =
  /\b(sla|within[\s_-]*\d+|completion[\s_-]*time|time[\s_-]*to[\s_-]*delete|deletion[\s_-]*deadline)\b/i;

export interface AiDeletionExportReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    procedure: { found: boolean; refs: string[] };
    aiMemoryScope: { found: boolean; refs: string[] };
    aiLogScope: { found: boolean; refs: string[] };
    slaOrTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    procedureCoversAiMemory: boolean | null;
    procedureCoversAiLogs: boolean | null;
    sampleTestCompleted: boolean | null;
    completedWithinSla: boolean | null;
    measuredDurationPresent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    deletionSignalsPresent: boolean;
    procedureSignalsPresent: boolean;
    priM2Satisfied: boolean | null;
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

function detectDeletionSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PATH_RE.test(path) ||
        MEMORY_RE.test(text) ||
        /\b(delete[\s_-]*user|export[\s_-]*data|gdpr)\b/i.test(text),
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
): AiDeletionExportReport["importedResults"] {
  const sources: string[] = [];
  let procedureCoversAiMemory: boolean | null = null;
  let procedureCoversAiLogs: boolean | null = null;
  let sampleTestCompleted: boolean | null = null;
  let completedWithinSla: boolean | null = null;
  let measuredDurationPresent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-deletion-export-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      procedureCoversAiMemory =
        asBool(data.procedureCoversAiMemory) ??
        asBool(data.coversAiMemory) ??
        procedureCoversAiMemory;
      procedureCoversAiLogs =
        asBool(data.procedureCoversAiLogs) ??
        asBool(data.coversAiLogs) ??
        procedureCoversAiLogs;
      sampleTestCompleted =
        asBool(data.sampleTestCompleted) ??
        asBool(data.testCompleted) ??
        sampleTestCompleted;
      completedWithinSla =
        asBool(data.completedWithinSla) ??
        asBool(data.withinSla) ??
        completedWithinSla;
      measuredDurationPresent =
        asBool(data.measuredDurationPresent) ??
        (asNum(data.measuredDurationSeconds) != null ? true : null) ??
        (asNum(data.durationSeconds) != null ? true : null) ??
        measuredDurationPresent;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.priM2Complete) === true) {
        procedureCoversAiMemory = procedureCoversAiMemory ?? true;
        procedureCoversAiLogs = procedureCoversAiLogs ?? true;
        sampleTestCompleted = sampleTestCompleted ?? true;
        completedWithinSla = completedWithinSla ?? true;
        measuredDurationPresent = measuredDurationPresent ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    procedureCoversAiMemory,
    procedureCoversAiLogs,
    sampleTestCompleted,
    completedWithinSla,
    measuredDurationPresent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDeletionExportReport(opts: {
  assessedAt: string;
  signals: AiDeletionExportReport["signals"];
  deletionSignals: boolean;
  imported: AiDeletionExportReport["importedResults"];
}): AiDeletionExportReport {
  const notes: string[] = [];
  const procedureSignalsPresent =
    opts.signals.procedure.found ||
    (opts.signals.aiMemoryScope.found && opts.signals.slaOrTest.found);

  if (!opts.deletionSignals && !procedureSignalsPresent && !opts.imported.found) {
    notes.push(
      "No deletion/export or AI-memory signals — PRI-M2 may be NOT_APPLICABLE if no AI memory/logs require deletion/export.",
    );
  }
  if (opts.signals.procedure.found) {
    notes.push(
      `Procedure refs: ${opts.signals.procedure.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (memory=${opts.imported.procedureCoversAiMemory}, logs=${opts.imported.procedureCoversAiLogs}, test=${opts.imported.sampleTestCompleted}, withinSla=${opts.imported.completedWithinSla}, duration=${opts.imported.measuredDurationPresent}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (procedureSignalsPresent) {
    notes.push(
      "Procedure signals alone are PARTIAL — import AI-scoped procedure + within-SLA timed test under imports/ai-deletion-export/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= INVENTORY_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    INVENTORY_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.procedureCoversAiMemory === true &&
    opts.imported.procedureCoversAiLogs === true &&
    opts.imported.sampleTestCompleted === true &&
    opts.imported.completedWithinSla === true &&
    opts.imported.measuredDurationPresent === true &&
    ageOk &&
    importFresh;

  let statusHint: AiDeletionExportReport["summary"]["statusHint"];
  let priM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.procedureCoversAiMemory === false ||
      opts.imported.procedureCoversAiLogs === false ||
      opts.imported.sampleTestCompleted === false ||
      opts.imported.completedWithinSla === false ||
      opts.imported.measuredDurationPresent === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.deletionSignals &&
    !opts.signals.procedure.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing AI memory/log scope, failed/missing SLA test, or evidence older than 90 days — PRI-M2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priM2Satisfied = true;
  } else if (
    opts.signals.procedure.found ||
    opts.signals.aiMemoryScope.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priM2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.procedureCoversAiMemory !== true) {
        notes.push("Import must show procedureCoversAiMemory=true.");
      }
      if (opts.imported.procedureCoversAiLogs !== true) {
        notes.push("Import must show procedureCoversAiLogs=true.");
      }
      if (opts.imported.sampleTestCompleted !== true) {
        notes.push("Import must show sampleTestCompleted=true.");
      }
      if (opts.imported.completedWithinSla !== true) {
        notes.push("Import must show completedWithinSla=true.");
      }
      if (opts.imported.measuredDurationPresent !== true) {
        notes.push("Import must show measuredDurationPresent=true (or measuredDurationSeconds).");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-M2 PASS.",
        );
      }
    }
  } else if (opts.deletionSignals) {
    statusHint = "not_demonstrated";
    priM2Satisfied = null;
    notes.push(
      "Deletion/export signals present but AI memory/log scope or SLA test not found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      deletionSignalsPresent: opts.deletionSignals,
      procedureSignalsPresent,
      priM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDeletionExportCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const deletionSignals = detectDeletionSignals(ctx.targetPath, maxFiles);

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      MEMORY_RE.test(text) ||
      PATH_RE.test(text) ||
      LOG_RE.test(text);

    const procedureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PATH_RE.test(path) || PATH_RE.test(text)) && inCtx(path, text),
    );
    const memoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MEMORY_RE.test(path) || MEMORY_RE.test(text)) && inCtx(path, text),
      12,
    );
    const logRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LOG_RE.test(path) || LOG_RE.test(text)) && inCtx(path, text),
      12,
    );
    const slaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SLA_RE.test(path) || SLA_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiDeletionExportReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        procedure: { found: procedureRefs.length > 0, refs: procedureRefs },
        aiMemoryScope: { found: memoryRefs.length > 0, refs: memoryRefs },
        aiLogScope: { found: logRefs.length > 0, refs: logRefs },
        slaOrTest: { found: slaRefs.length > 0, refs: slaRefs },
      },
      deletionSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-deletion-export-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-deletion-export-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-deletion-export",
          "pri-m2",
          DETECTOR_ID,
          ...(report.summary.procedureSignalsPresent
            ? ["deletion-procedure-signals"]
            : []),
          ...(report.summary.priM2Satisfied ? ["pri-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...procedureRefs.slice(0, 2),
        ...memoryRefs.slice(0, 1),
        ...logRefs.slice(0, 1),
        ...slaRefs.slice(0, 1),
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
        signals: ["ai-deletion-export-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-M2 status=${report.summary.statusHint} procedure=${report.summary.procedureSignalsPresent} satisfied=${report.summary.priM2Satisfied}; report=imports/${PLUGIN_ID}/ai-deletion-export-report.json`,
      nodes,
    };
  },
};
