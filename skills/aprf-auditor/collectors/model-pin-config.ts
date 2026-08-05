/**
 * model-pin-config — MOD-M1 / repo-model-pin-config.
 *
 * Discovers pinned model IDs and lint/CI rejection of floating aliases.
 * Import floatingAliasCountOnCriticalPaths=0 +
 * criticalPathsMissingPinnedModelId=0 + lintOrCiRejectsLatest under
 * imports/model-pin-config/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "model-pin-config";
const RELATED = ["MOD-M1"] as const;
const DETECTOR_ID = "repo-model-pin-config";
const IMPORT_MAX_AGE_DAYS = 90;

const MODEL_PATH_RE =
  /(model|llm|openai|anthropic|bedrock|vertex|azure.?openai|provider|inference)/i;

const PIN_RE =
  /\b(model[\s_-]*(id|version|pin|revision|snapshot)|pinned[\s_-]*model|immutable[\s_-]*model|gpt-[\w.-]+-\d{4}|claude-[\w.-]+-\d{8}|[\w.-]+@\d|sha256:)\b/i;

const FLOATING_RE =
  /\b(model[\s_-]*(id|name|alias)?\s*[:=]\s*["']?(latest|current|default|stable)["']?|["']latest["']|alias[\s_-]*latest|floating[\s_-]*alias)\b/i;

const LINT_CI_RE =
  /\b(reject[\s_-]*(latest|floating)|forbid[\s_-]*latest|no[\s_-]*latest|disallow[\s_-]*latest|model[\s_-]*pin[\s_-]*(lint|check|gate)|pin[\s_-]*model)\b/i;

export interface ModelPinConfigReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    pins: { found: boolean; refs: string[] };
    floating: { found: boolean; refs: string[] };
    lintCi: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    floatingAliasCountOnCriticalPaths: number | null;
    criticalPathsMissingPinnedModelId: number | null;
    lintOrCiRejectsLatest: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    pinSignalsPresent: boolean;
    modM1Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".env",
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

function detectModelSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        MODEL_PATH_RE.test(path) ||
        /\b(openai|anthropic|bedrock|vertexai|azure.?openai|llm)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ModelPinConfigReport["importedResults"] {
  const sources: string[] = [];
  let floatingAliasCountOnCriticalPaths: number | null = null;
  let criticalPathsMissingPinnedModelId: number | null = null;
  let lintOrCiRejectsLatest: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-pin-config-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      floatingAliasCountOnCriticalPaths =
        asNum(data.floatingAliasCountOnCriticalPaths) ??
        asNum(data.floating_alias_count_on_critical_paths) ??
        floatingAliasCountOnCriticalPaths;
      criticalPathsMissingPinnedModelId =
        asNum(data.criticalPathsMissingPinnedModelId) ??
        asNum(data.critical_paths_missing_pinned_model_id) ??
        criticalPathsMissingPinnedModelId;
      lintOrCiRejectsLatest =
        asBool(data.lintOrCiRejectsLatest) ??
        asBool(data.lint_or_ci_rejects_latest) ??
        asBool(data.rejectsLatest) ??
        lintOrCiRejectsLatest;

      if (
        asBool(data.allCriticalPathsPinned) === true &&
        floatingAliasCountOnCriticalPaths === null &&
        criticalPathsMissingPinnedModelId === null
      ) {
        floatingAliasCountOnCriticalPaths = 0;
        criticalPathsMissingPinnedModelId = 0;
      }
      if (asBool(data.noFloatingAliases) === true) {
        floatingAliasCountOnCriticalPaths =
          floatingAliasCountOnCriticalPaths ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    floatingAliasCountOnCriticalPaths,
    criticalPathsMissingPinnedModelId,
    lintOrCiRejectsLatest,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelPinConfigReport(opts: {
  assessedAt: string;
  pins: { found: boolean; refs: string[] };
  floating: { found: boolean; refs: string[] };
  lintCi: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelPinConfigReport["importedResults"];
}): ModelPinConfigReport {
  const notes: string[] = [];
  const pinSignalsPresent =
    opts.pins.found || opts.floating.found || opts.lintCi.found;

  if (!opts.modelSignals && !pinSignalsPresent && !opts.imported.found) {
    notes.push(
      "No model/pin signals — MOD-M1 may be NOT_APPLICABLE if there are no production model calls.",
    );
  }
  if (opts.pins.found) {
    notes.push(`Pin refs: ${opts.pins.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.floating.found) {
    notes.push(
      `Floating-alias refs (need review): ${opts.floating.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.lintCi.found) {
    notes.push(`Lint/CI reject refs: ${opts.lintCi.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No lint/CI floating-alias reject signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (floating=${opts.imported.floatingAliasCountOnCriticalPaths}, missingPin=${opts.imported.criticalPathsMissingPinnedModelId}, rejects=${opts.imported.lintOrCiRejectsLatest})`,
    );
  } else if (pinSignalsPresent) {
    notes.push(
      "Pin signals alone are PARTIAL — import floatingAliasCountOnCriticalPaths=0, criticalPathsMissingPinnedModelId=0, lintOrCiRejectsLatest=true (measuredAt ≤90d) under imports/model-pin-config/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const floatingOk =
    opts.imported.floatingAliasCountOnCriticalPaths !== null &&
    opts.imported.floatingAliasCountOnCriticalPaths === 0;
  const pinOk =
    opts.imported.criticalPathsMissingPinnedModelId !== null &&
    opts.imported.criticalPathsMissingPinnedModelId === 0;
  const rejectOk = opts.imported.lintOrCiRejectsLatest === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelPinConfigReport["summary"]["statusHint"];
  let modM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.floatingAliasCountOnCriticalPaths !== null &&
      opts.imported.floatingAliasCountOnCriticalPaths > 0) ||
      (opts.imported.criticalPathsMissingPinnedModelId !== null &&
        opts.imported.criticalPathsMissingPinnedModelId > 0) ||
      opts.imported.lintOrCiRejectsLatest === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.modelSignals && !pinSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    modM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modM1Satisfied = false;
    notes.push(
      "Imported evidence shows floating aliases, missing pins, non-rejecting lint/CI, or evidence older than 90 days — MOD-M1 fail.",
    );
  } else if (
    (pinSignalsPresent || opts.imported.found) &&
    floatingOk &&
    pinOk &&
    rejectOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modM1Satisfied = true;
  } else if (pinSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modM1Satisfied = false;
    if (opts.imported.found && !floatingOk) {
      notes.push("Import must show floatingAliasCountOnCriticalPaths=0.");
    }
    if (opts.imported.found && !pinOk) {
      notes.push("Import must show criticalPathsMissingPinnedModelId=0.");
    }
    if (opts.imported.found && !rejectOk) {
      notes.push("Import must show lintOrCiRejectsLatest=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-M1 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modM1Satisfied = null;
    notes.push(
      "Model signals present but no pin / floating-alias reject evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      pins: opts.pins,
      floating: opts.floating,
      lintCi: opts.lintCi,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      pinSignalsPresent,
      modM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelPinConfigCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const pinRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MODEL_PATH_RE.test(path) || PIN_RE.test(path)) &&
        (PIN_RE.test(text) || PIN_RE.test(path)),
      12,
    );
    const floatingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FLOATING_RE.test(path) || FLOATING_RE.test(text),
      12,
    );
    const lintCiRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => LINT_CI_RE.test(path) || LINT_CI_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelPinConfigReport({
      assessedAt: ctx.assessedAt.toISOString(),
      pins: { found: pinRefs.length > 0, refs: pinRefs },
      floating: { found: floatingRefs.length > 0, refs: floatingRefs },
      lintCi: { found: lintCiRefs.length > 0, refs: lintCiRefs },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-pin-config-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-pin-config-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-pin-config",
          "mod-m1",
          DETECTOR_ID,
          ...(report.summary.modM1Satisfied ? ["mod-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.pins.refs,
        ...report.signals.lintCi.refs,
        ...report.signals.floating.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-pin-config-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-M1 status=${report.summary.statusHint} pins=${report.summary.pinSignalsPresent} satisfied=${report.summary.modM1Satisfied}; report=imports/${PLUGIN_ID}/model-pin-config-report.json`,
      nodes,
    };
  },
};
