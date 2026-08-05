/**
 * ai-containment-drill — INC-M2 / repo-ai-containment-drill.
 *
 * Discovers containment runbooks + drills for pause agents, disable tools,
 * and prompt/model rollback. Import pauseAgentsDemonstrated +
 * disableToolsDemonstrated + rollbackPromptOrModelDemonstrated +
 * withinDocumentedTimeBudgets under imports/ai-containment-drill/
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

const PLUGIN_ID = "ai-containment-drill";
const RELATED = ["INC-M2"] as const;
const DETECTOR_ID = "repo-ai-containment-drill";
const IMPORT_MAX_AGE_DAYS = 90;

const CONTAINMENT_RE =
  /\b(containment|incident[\s_-]*contain|kill[\s_-]*switch|emergency[\s_-]*stop)\b/i;

const PAUSE_RE =
  /\b(pause[\s_-]*agent|halt[\s_-]*agent|stop[\s_-]*agent|freeze[\s_-]*agent|agent[\s_-]*pause)\b/i;

const DISABLE_TOOLS_RE =
  /\b(disable[\s_-]*tool|tool[\s_-]*disable|revoke[\s_-]*tool|tool[\s_-]*kill|disable[\s_-]*mcp)\b/i;

const ROLLBACK_RE =
  /\b(roll[\s_-]*back[\s_-]*(prompt|model)|prompt[\s_-]*rollback|model[\s_-]*rollback|revert[\s_-]*(prompt|model[\s_-]*pin))\b/i;

const DRILL_RE =
  /\b(drill|tabletop|game[\s_-]*day|exercis(?:e|ed)|containment[\s_-]*test)\b/i;

const TIME_BUDGET_RE =
  /\b(time[\s_-]*budget|within[\s_-]*\d+\s*(min|minute|m|sec|s)|mttr|time[\s_-]*to[\s_-]*contain|sla[\s_-]*contain)\b/i;

export interface AiContainmentDrillReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    pause: { found: boolean; refs: string[] };
    disableTools: { found: boolean; refs: string[] };
    rollback: { found: boolean; refs: string[] };
    drillOrBudget: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    pauseAgentsDemonstrated: boolean | null;
    disableToolsDemonstrated: boolean | null;
    rollbackPromptOrModelDemonstrated: boolean | null;
    withinDocumentedTimeBudgets: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    containmentSignalsPresent: boolean;
    actionSignalCount: number;
    incM2Satisfied: boolean | null;
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
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".sh",
      ".ts",
      ".py",
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
): AiContainmentDrillReport["importedResults"] {
  const sources: string[] = [];
  let pauseAgentsDemonstrated: boolean | null = null;
  let disableToolsDemonstrated: boolean | null = null;
  let rollbackPromptOrModelDemonstrated: boolean | null = null;
  let withinDocumentedTimeBudgets: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-containment-drill-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      pauseAgentsDemonstrated =
        asBool(data.pauseAgentsDemonstrated) ??
        asBool(data.pause_agents_demonstrated) ??
        asBool(data.pauseDemonstrated) ??
        pauseAgentsDemonstrated;
      disableToolsDemonstrated =
        asBool(data.disableToolsDemonstrated) ??
        asBool(data.disable_tools_demonstrated) ??
        asBool(data.disableDemonstrated) ??
        disableToolsDemonstrated;
      rollbackPromptOrModelDemonstrated =
        asBool(data.rollbackPromptOrModelDemonstrated) ??
        asBool(data.rollback_prompt_or_model_demonstrated) ??
        asBool(data.rollbackDemonstrated) ??
        rollbackPromptOrModelDemonstrated;
      withinDocumentedTimeBudgets =
        asBool(data.withinDocumentedTimeBudgets) ??
        asBool(data.within_documented_time_budgets) ??
        asBool(data.withinTimeBudgets) ??
        withinDocumentedTimeBudgets;

      if (asBool(data.containmentDrillPassedLast90Days) === true) {
        pauseAgentsDemonstrated = pauseAgentsDemonstrated ?? true;
        disableToolsDemonstrated = disableToolsDemonstrated ?? true;
        rollbackPromptOrModelDemonstrated =
          rollbackPromptOrModelDemonstrated ?? true;
        withinDocumentedTimeBudgets = withinDocumentedTimeBudgets ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    pauseAgentsDemonstrated,
    disableToolsDemonstrated,
    rollbackPromptOrModelDemonstrated,
    withinDocumentedTimeBudgets,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiContainmentDrillReport(opts: {
  assessedAt: string;
  pause: { found: boolean; refs: string[] };
  disableTools: { found: boolean; refs: string[] };
  rollback: { found: boolean; refs: string[] };
  drillOrBudget: { found: boolean; refs: string[] };
  imported: AiContainmentDrillReport["importedResults"];
}): AiContainmentDrillReport {
  const notes: string[] = [];
  const actionSignalCount = [
    opts.pause.found,
    opts.disableTools.found,
    opts.rollback.found,
  ].filter(Boolean).length;
  const containmentSignalsPresent =
    actionSignalCount > 0 ||
    opts.drillOrBudget.found ||
    CONTAINMENT_RE.test(
      [...opts.pause.refs, ...opts.disableTools.refs, ...opts.rollback.refs].join(
        " ",
      ),
    );

  if (!containmentSignalsPresent && !opts.imported.found) {
    notes.push(
      "No containment signals — INC-M2 may be NOT_APPLICABLE if no production agents/tools/prompt-model units are in scope.",
    );
  }
  if (opts.pause.found) {
    notes.push(`Pause refs: ${opts.pause.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.disableTools.found) {
    notes.push(
      `Disable-tools refs: ${opts.disableTools.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.rollback.found) {
    notes.push(`Rollback refs: ${opts.rollback.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (pause=${opts.imported.pauseAgentsDemonstrated}, disable=${opts.imported.disableToolsDemonstrated}, rollback=${opts.imported.rollbackPromptOrModelDemonstrated}, withinBudget=${opts.imported.withinDocumentedTimeBudgets})`,
    );
  } else if (containmentSignalsPresent) {
    notes.push(
      "Containment signals alone are PARTIAL — import pauseAgentsDemonstrated=true + disableToolsDemonstrated=true + rollbackPromptOrModelDemonstrated=true + withinDocumentedTimeBudgets=true (measuredAt ≤90d) under imports/ai-containment-drill/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const pauseOk = opts.imported.pauseAgentsDemonstrated === true;
  const disableOk = opts.imported.disableToolsDemonstrated === true;
  const rollbackOk = opts.imported.rollbackPromptOrModelDemonstrated === true;
  const budgetOk = opts.imported.withinDocumentedTimeBudgets === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiContainmentDrillReport["summary"]["statusHint"];
  let incM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.pauseAgentsDemonstrated === false ||
      opts.imported.disableToolsDemonstrated === false ||
      opts.imported.rollbackPromptOrModelDemonstrated === false ||
      opts.imported.withinDocumentedTimeBudgets === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!containmentSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing pause/disable/rollback demonstration, missed time budgets, or evidence older than 90 days — INC-M2 fail.",
    );
  } else if (
    (containmentSignalsPresent || opts.imported.found) &&
    pauseOk &&
    disableOk &&
    rollbackOk &&
    budgetOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incM2Satisfied = true;
  } else if (containmentSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incM2Satisfied = false;
    if (opts.imported.found && !pauseOk) {
      notes.push("Import must show pauseAgentsDemonstrated=true.");
    }
    if (opts.imported.found && !disableOk) {
      notes.push("Import must show disableToolsDemonstrated=true.");
    }
    if (opts.imported.found && !rollbackOk) {
      notes.push("Import must show rollbackPromptOrModelDemonstrated=true.");
    }
    if (opts.imported.found && !budgetOk) {
      notes.push("Import must show withinDocumentedTimeBudgets=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      pause: opts.pause,
      disableTools: opts.disableTools,
      rollback: opts.rollback,
      drillOrBudget: opts.drillOrBudget,
    },
    importedResults: opts.imported,
    summary: {
      containmentSignalsPresent,
      actionSignalCount,
      incM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiContainmentDrillCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const pause = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PAUSE_RE.test(path) || PAUSE_RE.test(text),
      8,
    );
    const disableTools = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        DISABLE_TOOLS_RE.test(path) || DISABLE_TOOLS_RE.test(text),
      8,
    );
    const rollback = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ROLLBACK_RE.test(path) || ROLLBACK_RE.test(text),
      8,
    );
    const drillOrBudget = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        ((CONTAINMENT_RE.test(path) ||
          CONTAINMENT_RE.test(text) ||
          PAUSE_RE.test(text) ||
          DISABLE_TOOLS_RE.test(text) ||
          ROLLBACK_RE.test(text)) &&
          (DRILL_RE.test(text) || TIME_BUDGET_RE.test(text))) ||
        DRILL_RE.test(path),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiContainmentDrillReport({
      assessedAt: ctx.assessedAt.toISOString(),
      pause: { found: pause.length > 0, refs: pause },
      disableTools: { found: disableTools.length > 0, refs: disableTools },
      rollback: { found: rollback.length > 0, refs: rollback },
      drillOrBudget: { found: drillOrBudget.length > 0, refs: drillOrBudget },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-containment-drill-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-containment-drill-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-containment-drill",
          "inc-m2",
          DETECTOR_ID,
          ...(report.summary.incM2Satisfied ? ["inc-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.pause.refs,
        ...report.signals.disableTools.refs,
        ...report.signals.rollback.refs,
        ...report.signals.drillOrBudget.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-containment-drill-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-M2 status=${report.summary.statusHint} actions=${report.summary.actionSignalCount}/3 satisfied=${report.summary.incM2Satisfied}; report=imports/${PLUGIN_ID}/ai-containment-drill-report.json`,
      nodes,
    };
  },
};
