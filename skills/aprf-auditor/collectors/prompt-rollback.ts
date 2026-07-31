/**
 * prompt-rollback — PRM-M3 / repo-prompt-rollback.
 *
 * Discovers prompt-specific rollback procedures (no full app redeploy) + RTO.
 * Import priorPromptRestoredWithinRto + rollbackWithoutFullAppRedeploy under
 * imports/prompt-rollback/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "prompt-rollback";
const RELATED = ["PRM-M3"] as const;
const DETECTOR_ID = "repo-prompt-rollback";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const PROCEDURE_RE =
  /\b(prompt[\s_-]*rollback\w*|rollback[\s_-]*prompt\w*|restore[\s_-]*prompt\w*|prompt[\s_-]*restore\w*|revert[\s_-]*prompt\w*)\b/i;

const RTO_RE =
  /\b(rto|recovery[\s_-]*time|restore[\s_-]*within|time[\s_-]*budget|≤\s*\d+\s*(min|minute|m|hour|h)\b|<=\s*\d+\s*(min|minute|m|hour|h))\b/i;

const NO_REDEPLOY_RE =
  /\b(without[\s_-]*(full[\s_-]*)?(app|application|service)[\s_-]*redeploy\w*|no[\s_-]*(full[\s_-]*)?redeploy|config[\s_-]*only[\s_-]*rollback|registry[\s_-]*pin|hot[\s_-]*swap|feature[\s_-]*flag)\b/i;

const DRILL_RE =
  /\b(timed[\s_-]*restore|restore[\s_-]*test|rollback[\s_-]*drill|drill[\s_-]*log|restore[\s_-]*demo|game[\s_-]*day)\b/i;

export interface PromptRollbackReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    procedure: { found: boolean; refs: string[] };
    rto: { found: boolean; refs: string[] };
    noFullRedeploy: { found: boolean; refs: string[] };
    drill: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    priorPromptRestoredWithinRto: boolean | null;
    rollbackWithoutFullAppRedeploy: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    rollbackSignalsPresent: boolean;
    prmM3Satisfied: boolean | null;
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

function detectPromptSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMPT_PATH_RE.test(path) ||
        /\b(system[\s_-]*prompt|prompt[\s_-]*template)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptRollbackReport["importedResults"] {
  const sources: string[] = [];
  let priorPromptRestoredWithinRto: boolean | null = null;
  let rollbackWithoutFullAppRedeploy: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-rollback-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      priorPromptRestoredWithinRto =
        asBool(data.priorPromptRestoredWithinRto) ??
        asBool(data.prior_prompt_restored_within_rto) ??
        asBool(data.restoredWithinRto) ??
        priorPromptRestoredWithinRto;
      rollbackWithoutFullAppRedeploy =
        asBool(data.rollbackWithoutFullAppRedeploy) ??
        asBool(data.rollback_without_full_app_redeploy) ??
        asBool(data.noFullAppRedeploy) ??
        rollbackWithoutFullAppRedeploy;

      // Affirmative drill evidence can set both when explicitly attested.
      if (asBool(data.timedRestorePassed) === true) {
        priorPromptRestoredWithinRto = priorPromptRestoredWithinRto ?? true;
      }
      if (asBool(data.configOnlyRollback) === true) {
        rollbackWithoutFullAppRedeploy =
          rollbackWithoutFullAppRedeploy ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    priorPromptRestoredWithinRto,
    rollbackWithoutFullAppRedeploy,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptRollbackReport(opts: {
  assessedAt: string;
  procedure: { found: boolean; refs: string[] };
  rto: { found: boolean; refs: string[] };
  noFullRedeploy: { found: boolean; refs: string[] };
  drill: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptRollbackReport["importedResults"];
}): PromptRollbackReport {
  const notes: string[] = [];
  const rollbackSignalsPresent =
    opts.procedure.found ||
    opts.rto.found ||
    opts.noFullRedeploy.found ||
    opts.drill.found;

  if (!opts.promptSignals && !rollbackSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/rollback signals — PRM-M3 may be NOT_APPLICABLE if there are no production prompts.",
    );
  }
  if (opts.procedure.found) {
    notes.push(`Procedure refs: ${opts.procedure.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.rto.found) {
    notes.push(`RTO refs: ${opts.rto.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.noFullRedeploy.found) {
    notes.push(
      `No-full-redeploy refs: ${opts.noFullRedeploy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.drill.found) {
    notes.push(`Drill refs: ${opts.drill.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (withinRto=${opts.imported.priorPromptRestoredWithinRto}, noFullRedeploy=${opts.imported.rollbackWithoutFullAppRedeploy})`,
    );
  } else if (rollbackSignalsPresent) {
    notes.push(
      "Rollback signals alone are PARTIAL — import priorPromptRestoredWithinRto=true + rollbackWithoutFullAppRedeploy=true (measuredAt ≤90d) under imports/prompt-rollback/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const restoreOk = opts.imported.priorPromptRestoredWithinRto === true;
  const pathOk = opts.imported.rollbackWithoutFullAppRedeploy === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptRollbackReport["summary"]["statusHint"] =
    "not_demonstrated";
  let prmM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.priorPromptRestoredWithinRto === false ||
      opts.imported.rollbackWithoutFullAppRedeploy === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.promptSignals && !rollbackSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    prmM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmM3Satisfied = false;
    notes.push(
      "Imported evidence shows restore outside RTO, full-app-redeploy-only path, or drill older than 90 days — PRM-M3 fail.",
    );
  } else if (
    (rollbackSignalsPresent || opts.imported.found) &&
    restoreOk &&
    pathOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmM3Satisfied = true;
  } else if (rollbackSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmM3Satisfied = false;
    if (opts.imported.found && !restoreOk) {
      notes.push("Import must show priorPromptRestoredWithinRto=true.");
    }
    if (opts.imported.found && !pathOk) {
      notes.push("Import must show rollbackWithoutFullAppRedeploy=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-M3 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmM3Satisfied = null;
    notes.push(
      "Prompt signals present but no prompt-rollback procedure/drill evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      procedure: opts.procedure,
      rto: opts.rto,
      noFullRedeploy: opts.noFullRedeploy,
      drill: opts.drill,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      rollbackSignalsPresent,
      prmM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptRollbackCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const procedureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROCEDURE_RE.test(path) || PROCEDURE_RE.test(text),
      12,
    );
    const rtoRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROCEDURE_RE.test(path) ||
          PROCEDURE_RE.test(text) ||
          PROMPT_PATH_RE.test(path)) &&
        RTO_RE.test(text),
      12,
    );
    const noFullRedeployRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROCEDURE_RE.test(path) || PROCEDURE_RE.test(text)) &&
        NO_REDEPLOY_RE.test(text),
      12,
    );
    const drillRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROCEDURE_RE.test(path) || DRILL_RE.test(path) || DRILL_RE.test(text)) &&
        (PROCEDURE_RE.test(text) || DRILL_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptRollbackReport({
      assessedAt: ctx.assessedAt.toISOString(),
      procedure: { found: procedureRefs.length > 0, refs: procedureRefs },
      rto: { found: rtoRefs.length > 0, refs: rtoRefs },
      noFullRedeploy: {
        found: noFullRedeployRefs.length > 0,
        refs: noFullRedeployRefs,
      },
      drill: { found: drillRefs.length > 0, refs: drillRefs },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-rollback-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-rollback-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-rollback",
          "prm-m3",
          DETECTOR_ID,
          ...(report.summary.prmM3Satisfied ? ["prm-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.procedure.refs,
        ...report.signals.rto.refs,
        ...report.signals.noFullRedeploy.refs,
        ...report.signals.drill.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-rollback-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-M3 status=${report.summary.statusHint} rollback=${report.summary.rollbackSignalsPresent} satisfied=${report.summary.prmM3Satisfied}; report=imports/${PLUGIN_ID}/prompt-rollback-report.json`,
      nodes,
    };
  },
};
