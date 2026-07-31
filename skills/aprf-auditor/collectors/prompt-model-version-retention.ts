/**
 * prompt-model-version-retention — CHG-M1 / repo-prompt-model-version-retention.
 *
 * Discovers retention of prior prompt + model-pin versions and restore dry-runs.
 * Import retainedPriorProductionVersions≥2 (or ≥policyMinimumN) +
 * immediatePriorRestoreDryRunPassed under imports/prompt-model-version-retention/
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

const PLUGIN_ID = "prompt-model-version-retention";
const RELATED = ["CHG-M1"] as const;
const DETECTOR_ID = "repo-prompt-model-version-retention";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_RETAINED = 2;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_OR_MODEL_RE =
  /(prompt|prompts|model[\s_-]*pin|model[\s_-]*version|llm|openai|anthropic|bedrock|vertex|\.prompt\.)/i;

const RETENTION_RE =
  /\b(retain\w*[\s_-]*(prior|previous|n[\s_-]*version)|version[\s_-]*retention|prior[\s_-]*(production[\s_-]*)?version\w*|keep[\s_-]*last[\s_-]*\d+|min(?:imum)?[\s_-]*n\s*=?\s*\d+)\b/i;

const REGISTRY_RE =
  /\b(prompt[\s_-]*registry|model[\s_-]*registry|version[\s_-]*registry|pinned[\s_-]*(prompt|model)|immutable[\s_-]*version)\b/i;

const DRY_RUN_RE =
  /\b(restore[\s_-]*dry[\s_-]*run|dry[\s_-]*run[\s_-]*restore|immediate[\s_-]*prior|load[\s_-]*prior[\s_-]*version|staging[\s_-]*restore|prod[\s_-]*adjacent)\b/i;

export interface PromptModelVersionRetentionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    retention: { found: boolean; refs: string[] };
    registry: { found: boolean; refs: string[] };
    dryRun: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    retainedPriorProductionVersions: number | null;
    policyMinimumN: number | null;
    immediatePriorRestoreDryRunPassed: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiVersionSignalsPresent: boolean;
    retentionSignalsPresent: boolean;
    chgM1Satisfied: boolean | null;
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

function detectAiVersionSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMPT_OR_MODEL_RE.test(path) ||
        /\b(system[\s_-]*prompt|model[\s_-]*pin|prompt[\s_-]*version)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptModelVersionRetentionReport["importedResults"] {
  const sources: string[] = [];
  let retainedPriorProductionVersions: number | null = null;
  let policyMinimumN: number | null = null;
  let immediatePriorRestoreDryRunPassed: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-model-version-retention-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      retainedPriorProductionVersions =
        asNum(data.retainedPriorProductionVersions) ??
        asNum(data.retained_prior_production_versions) ??
        asNum(data.priorVersionsRetained) ??
        retainedPriorProductionVersions;
      policyMinimumN =
        asNum(data.policyMinimumN) ??
        asNum(data.policy_minimum_n) ??
        asNum(data.minimumN) ??
        policyMinimumN;
      immediatePriorRestoreDryRunPassed =
        asBool(data.immediatePriorRestoreDryRunPassed) ??
        asBool(data.immediate_prior_restore_dry_run_passed) ??
        asBool(data.restoreDryRunPassed) ??
        immediatePriorRestoreDryRunPassed;

      if (asBool(data.meetsMinimumRetention) === true) {
        retainedPriorProductionVersions =
          retainedPriorProductionVersions ?? MIN_RETAINED;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    retainedPriorProductionVersions,
    policyMinimumN,
    immediatePriorRestoreDryRunPassed,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptModelVersionRetentionReport(opts: {
  assessedAt: string;
  retention: { found: boolean; refs: string[] };
  registry: { found: boolean; refs: string[] };
  dryRun: { found: boolean; refs: string[] };
  aiVersionSignals: boolean;
  imported: PromptModelVersionRetentionReport["importedResults"];
}): PromptModelVersionRetentionReport {
  const notes: string[] = [];
  const retentionSignalsPresent =
    opts.retention.found || opts.registry.found || opts.dryRun.found;

  if (!opts.aiVersionSignals && !retentionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/model-pin retention signals — CHG-M1 may be NOT_APPLICABLE if neither ships in production.",
    );
  }
  if (opts.retention.found) {
    notes.push(`Retention refs: ${opts.retention.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.registry.found) {
    notes.push(`Registry refs: ${opts.registry.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.dryRun.found) {
    notes.push(`Dry-run refs: ${opts.dryRun.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (retained=${opts.imported.retainedPriorProductionVersions}, policyN=${opts.imported.policyMinimumN}, dryRun=${opts.imported.immediatePriorRestoreDryRunPassed})`,
    );
  } else if (retentionSignalsPresent) {
    notes.push(
      "Retention signals alone are PARTIAL — import retainedPriorProductionVersions≥2 + immediatePriorRestoreDryRunPassed=true (measuredAt ≤90d) under imports/prompt-model-version-retention/ to PASS.",
    );
  }

  const requiredN = Math.max(
    MIN_RETAINED,
    opts.imported.policyMinimumN ?? MIN_RETAINED,
  );
  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const retentionOk =
    opts.imported.retainedPriorProductionVersions !== null &&
    opts.imported.retainedPriorProductionVersions >= requiredN;
  const dryRunOk = opts.imported.immediatePriorRestoreDryRunPassed === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptModelVersionRetentionReport["summary"]["statusHint"] =
    "not_demonstrated";
  let chgM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.retainedPriorProductionVersions !== null &&
      opts.imported.retainedPriorProductionVersions < requiredN) ||
      opts.imported.immediatePriorRestoreDryRunPassed === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiVersionSignals && !retentionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgM1Satisfied = false;
    notes.push(
      `Imported evidence shows retained versions below required N=${requiredN}, failed dry-run, or evidence older than 90 days — CHG-M1 fail.`,
    );
  } else if (
    (retentionSignalsPresent || opts.imported.found) &&
    retentionOk &&
    dryRunOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgM1Satisfied = true;
  } else if (retentionSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgM1Satisfied = false;
    if (opts.imported.found && !retentionOk) {
      notes.push(
        `Import must show retainedPriorProductionVersions≥${requiredN}.`,
      );
    }
    if (opts.imported.found && !dryRunOk) {
      notes.push("Import must show immediatePriorRestoreDryRunPassed=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-M1 PASS.",
      );
    }
  } else if (opts.aiVersionSignals) {
    statusHint = "not_demonstrated";
    chgM1Satisfied = null;
    notes.push(
      "Prompt/model signals present but no version retention or restore dry-run evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      retention: opts.retention,
      registry: opts.registry,
      dryRun: opts.dryRun,
    },
    importedResults: opts.imported,
    summary: {
      aiVersionSignalsPresent: opts.aiVersionSignals,
      retentionSignalsPresent,
      chgM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptModelVersionRetentionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiVersionSignals = detectAiVersionSignals(ctx.targetPath, maxFiles);

    const retentionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RETENTION_RE.test(path) || RETENTION_RE.test(text),
      12,
    );
    const registryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REGISTRY_RE.test(path) || REGISTRY_RE.test(text),
      12,
    );
    const dryRunRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRY_RUN_RE.test(path) || DRY_RUN_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptModelVersionRetentionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      retention: { found: retentionRefs.length > 0, refs: retentionRefs },
      registry: { found: registryRefs.length > 0, refs: registryRefs },
      dryRun: { found: dryRunRefs.length > 0, refs: dryRunRefs },
      aiVersionSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-model-version-retention-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-model-version-retention-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-model-version-retention",
          "chg-m1",
          DETECTOR_ID,
          ...(report.summary.chgM1Satisfied ? ["chg-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.retention.refs,
        ...report.signals.registry.refs,
        ...report.signals.dryRun.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-model-version-retention-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-M1 status=${report.summary.statusHint} retention=${report.summary.retentionSignalsPresent} satisfied=${report.summary.chgM1Satisfied}; report=imports/${PLUGIN_ID}/prompt-model-version-retention-report.json`,
      nodes,
    };
  },
};
