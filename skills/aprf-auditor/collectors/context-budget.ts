/**
 * context-budget — CTX-M1 / repo-context-budget.
 *
 * Discovers context-assembly max token/byte budgets and overflow tests.
 * Import buildersMissingBudget=0 + silentOverflowCount=0 under
 * imports/context-budget/ to unlock PASS.
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "context-budget";
const RELATED = ["CTX-M1"] as const;
const DETECTOR_ID = "repo-context-budget";
const IMPORT_MAX_AGE_DAYS = 90;

const CTX_PATH_RE =
  /(context|prompt|rag|retriev|chat[_-]?histor|assembler|message[_-]?build|token[_-]?budget)/i;

const BUDGET_RE =
  /\b(context[_-]?(budget|window|limit|max)|max[_-]?(context|prompt)[_-]?(tokens?|bytes?|chars?)|token[_-]?budget|prompt[_-]?budget|max[_-]?tokens?\b|context[_-]?size)\b/i;

const PRIORITY_RE =
  /\b(priorit(y|ize|isation|ization)|truncat|overflow|drop[_-]?(order|lowest)|evict|compact)\b/i;

const OVERFLOW_TEST_RE =
  /\b(overflow|oversized|silent[_-]?overflow|truncat|reject.*(budget|context|token)|budget[_-]?(exceed|enforc))\b/i;

export interface ContextBudgetReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    budget: { found: boolean; refs: string[] };
    priority: { found: boolean; refs: string[] };
    overflowTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    buildersMissingBudget: number | null;
    silentOverflowCount: number | null;
    priorityRulesPresent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    contextSignalsPresent: boolean;
    budgetSignalsPresent: boolean;
    ctxM1Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
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

function detectContextSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CTX_PATH_RE.test(path) ||
        /\b(context[_-]?assembl|build[_-]?messages|ChatCompletion|rag|retriev)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextBudgetReport["importedResults"] {
  const sources: string[] = [];
  let buildersMissingBudget: number | null = null;
  let silentOverflowCount: number | null = null;
  let priorityRulesPresent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-budget-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      buildersMissingBudget =
        asNum(data.buildersMissingBudget) ??
        asNum(data.builders_missing_budget) ??
        buildersMissingBudget;
      silentOverflowCount =
        asNum(data.silentOverflowCount) ??
        asNum(data.silent_overflow_count) ??
        silentOverflowCount;
      priorityRulesPresent =
        asBool(data.priorityRulesPresent) ??
        asBool(data.priority_rules_present) ??
        priorityRulesPresent;

      if (
        asBool(data.coversAllProductionBuilders) === true &&
        buildersMissingBudget === null
      ) {
        buildersMissingBudget = 0;
      }
      if (asBool(data.overflowTestsPass) === true && silentOverflowCount === null) {
        silentOverflowCount = 0;
      }
      if (asBool(data.zeroSilentOverflows) === true) {
        silentOverflowCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    buildersMissingBudget,
    silentOverflowCount,
    priorityRulesPresent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextBudgetReport(opts: {
  assessedAt: string;
  budget: { found: boolean; refs: string[] };
  priority: { found: boolean; refs: string[] };
  overflowTests: { found: boolean; refs: string[] };
  contextSignals: boolean;
  imported: ContextBudgetReport["importedResults"];
}): ContextBudgetReport {
  const notes: string[] = [];
  const budgetSignalsPresent = opts.budget.found;

  if (!opts.contextSignals && !budgetSignalsPresent && !opts.imported.found) {
    notes.push(
      "No context-assembly signals — CTX-M1 may be NOT_APPLICABLE if there are no production context builders.",
    );
  }
  if (budgetSignalsPresent) {
    notes.push(`Budget refs: ${opts.budget.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No context max token/byte budget config signals found.");
  }
  if (opts.priority.found) {
    notes.push(`Priority/truncate refs: ${opts.priority.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.overflowTests.found) {
    notes.push(
      `Overflow-test refs: ${opts.overflowTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingBudget=${opts.imported.buildersMissingBudget}, silentOverflow=${opts.imported.silentOverflowCount})`,
    );
  } else if (budgetSignalsPresent) {
    notes.push(
      "Budget signals alone are PARTIAL — import buildersMissingBudget=0 and silentOverflowCount=0 (measuredAt ≤90d) under imports/context-budget/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.buildersMissingBudget !== null &&
    opts.imported.buildersMissingBudget === 0;
  const overflowOk =
    opts.imported.silentOverflowCount !== null &&
    opts.imported.silentOverflowCount === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextBudgetReport["summary"]["statusHint"];
  let ctxM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.buildersMissingBudget !== null &&
      opts.imported.buildersMissingBudget > 0) ||
      (opts.imported.silentOverflowCount !== null &&
        opts.imported.silentOverflowCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.contextSignals && !budgetSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    ctxM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing budgets, silent overflows, or evidence older than 90 days — CTX-M1 fail.",
    );
  } else if (
    budgetSignalsPresent &&
    coverageOk &&
    overflowOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxM1Satisfied = true;
  } else if (
    budgetSignalsPresent ||
    opts.priority.found ||
    opts.overflowTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    ctxM1Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show buildersMissingBudget=0.");
    }
    if (opts.imported.found && !overflowOk) {
      notes.push("Import must show silentOverflowCount=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-M1 PASS.",
      );
    }
  } else if (opts.contextSignals) {
    statusHint = "not_demonstrated";
    ctxM1Satisfied = null;
    notes.push(
      "Context signals present but no budget config or overflow evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      budget: opts.budget,
      priority: opts.priority,
      overflowTests: opts.overflowTests,
    },
    importedResults: opts.imported,
    summary: {
      contextSignalsPresent: opts.contextSignals,
      budgetSignalsPresent,
      ctxM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextBudgetCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const contextSignals = detectContextSignals(ctx.targetPath, maxFiles);

    const budgetRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!BUDGET_RE.test(path) && !BUDGET_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          BUDGET_RE.test(path)
        );
      },
    );
    const priorityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CTX_PATH_RE.test(path) || CTX_PATH_RE.test(text) || BUDGET_RE.test(text)) &&
        PRIORITY_RE.test(text),
      12,
    );
    const overflowRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture)/i.test(path) &&
        (BUDGET_RE.test(text) || CTX_PATH_RE.test(text)) &&
        OVERFLOW_TEST_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildContextBudgetReport({
      assessedAt: ctx.assessedAt.toISOString(),
      budget: { found: budgetRefs.length > 0, refs: budgetRefs },
      priority: { found: priorityRefs.length > 0, refs: priorityRefs },
      overflowTests: { found: overflowRefs.length > 0, refs: overflowRefs },
      contextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-budget-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/context-budget-report.json`,
        signals: [
          "context-budget",
          "ctx-m1",
          DETECTOR_ID,
          ...(report.summary.ctxM1Satisfied ? ["ctx-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of report.signals.budget.refs.slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:budget:${r}`,
        class: "code",
        ref: r,
        signals: ["context-budget-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-M1 status=${report.summary.statusHint} budget=${report.summary.budgetSignalsPresent} satisfied=${report.summary.ctxM1Satisfied}; report=imports/${PLUGIN_ID}/context-budget-report.json`,
      nodes,
    };
  },
};
