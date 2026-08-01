/**
 * ai-config-as-code — DEP-M3 / repo-ai-config-as-code.
 *
 * Discovers declarative AI config + drift/live-pin coverage.
 * Import unmanagedProductionAiConfigResources=0 +
 * livePinsMatchDeclaredPct=100 under imports/ai-config-as-code/
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

const PLUGIN_ID = "ai-config-as-code";
const RELATED = ["DEP-M3"] as const;
const DETECTOR_ID = "repo-ai-config-as-code";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_CONFIG_RE =
  /(ai[\s_-]*gateway|model[\s_-]*pin|model[\s_-]*version|tool[\s_-]*catalog|prompt|prompts|llm|openai|anthropic|bedrock|vertex)/i;

const DECLARATIVE_RE =
  /\b(terraform|pulumi|cloudformation|cdk|helm|kustomize|iac|declarative[\s_-]*config|as[\s_-]*code|infra[\s_-]*as[\s_-]*code)\b/i;

const DRIFT_RE =
  /\b(drift[\s_-]*check|config[\s_-]*drift|drift[\s_-]*detect|unmanaged[\s_-]*resource|live[\s_-]*pin|declared[\s_-]*version)\b/i;

export interface AiConfigAsCodeReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    declarative: { found: boolean; refs: string[] };
    drift: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    unmanagedProductionAiConfigResources: number | null;
    livePinsMatchDeclaredPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiConfigSignalsPresent: boolean;
    configAsCodeSignalsPresent: boolean;
    depM3Satisfied: boolean | null;
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
      ".tf",
      ".md",
      ".hcl",
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

function detectAiConfigSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) => AI_CONFIG_RE.test(path) || AI_CONFIG_RE.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiConfigAsCodeReport["importedResults"] {
  const sources: string[] = [];
  let unmanagedProductionAiConfigResources: number | null = null;
  let livePinsMatchDeclaredPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-config-as-code-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      unmanagedProductionAiConfigResources =
        asNum(data.unmanagedProductionAiConfigResources) ??
        asNum(data.unmanaged_production_ai_config_resources) ??
        asNum(data.unmanagedResources) ??
        unmanagedProductionAiConfigResources;
      livePinsMatchDeclaredPct =
        asNum(data.livePinsMatchDeclaredPct) ??
        asNum(data.live_pins_match_declared_pct) ??
        asNum(data.livePinMatchPct) ??
        livePinsMatchDeclaredPct;

      if (asBool(data.zeroUnmanagedAiConfig) === true) {
        unmanagedProductionAiConfigResources =
          unmanagedProductionAiConfigResources ?? 0;
      }
      if (asBool(data.livePinsMatchDeclared) === true) {
        livePinsMatchDeclaredPct = livePinsMatchDeclaredPct ?? 100;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    unmanagedProductionAiConfigResources,
    livePinsMatchDeclaredPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiConfigAsCodeReport(opts: {
  assessedAt: string;
  declarative: { found: boolean; refs: string[] };
  drift: { found: boolean; refs: string[] };
  aiConfigSignals: boolean;
  imported: AiConfigAsCodeReport["importedResults"];
}): AiConfigAsCodeReport {
  const notes: string[] = [];
  const configAsCodeSignalsPresent =
    opts.declarative.found || opts.drift.found;

  if (
    !opts.aiConfigSignals &&
    !configAsCodeSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI-config/declarative signals — DEP-M3 may be NOT_APPLICABLE if no production AI config is in scope.",
    );
  }
  if (opts.declarative.found) {
    notes.push(
      `Declarative refs: ${opts.declarative.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.drift.found) {
    notes.push(`Drift refs: ${opts.drift.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (unmanaged=${opts.imported.unmanagedProductionAiConfigResources}, liveMatchPct=${opts.imported.livePinsMatchDeclaredPct})`,
    );
  } else if (configAsCodeSignalsPresent) {
    notes.push(
      "Config-as-code signals alone are PARTIAL — import unmanagedProductionAiConfigResources=0 + livePinsMatchDeclaredPct=100 (measuredAt ≤90d) under imports/ai-config-as-code/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const unmanagedOk = opts.imported.unmanagedProductionAiConfigResources === 0;
  const liveMatchOk = opts.imported.livePinsMatchDeclaredPct === 100;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiConfigAsCodeReport["summary"]["statusHint"];
  let depM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((typeof opts.imported.unmanagedProductionAiConfigResources === "number" &&
      opts.imported.unmanagedProductionAiConfigResources > 0) ||
      (typeof opts.imported.livePinsMatchDeclaredPct === "number" &&
        opts.imported.livePinsMatchDeclaredPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.aiConfigSignals &&
    !configAsCodeSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    depM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depM3Satisfied = false;
    notes.push(
      "Imported evidence shows unmanaged AI config, live-pin mismatch, or evidence older than 90 days — DEP-M3 fail.",
    );
  } else if (
    (configAsCodeSignalsPresent || opts.imported.found) &&
    unmanagedOk &&
    liveMatchOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depM3Satisfied = true;
  } else if (configAsCodeSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depM3Satisfied = false;
    if (opts.imported.found && !unmanagedOk) {
      notes.push(
        "Import must show unmanagedProductionAiConfigResources=0.",
      );
    }
    if (opts.imported.found && !liveMatchOk) {
      notes.push("Import must show livePinsMatchDeclaredPct=100.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DEP-M3 PASS.",
      );
    }
  } else if (opts.aiConfigSignals) {
    statusHint = "not_demonstrated";
    depM3Satisfied = null;
    notes.push(
      "AI config signals present but no declarative / drift evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      declarative: opts.declarative,
      drift: opts.drift,
    },
    importedResults: opts.imported,
    summary: {
      aiConfigSignalsPresent: opts.aiConfigSignals,
      configAsCodeSignalsPresent,
      depM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiConfigAsCodeCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiConfigSignals = detectAiConfigSignals(ctx.targetPath, maxFiles);

    const declarativeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DECLARATIVE_RE.test(path) || DECLARATIVE_RE.test(text)) &&
        (AI_CONFIG_RE.test(path) || AI_CONFIG_RE.test(text)),
      12,
    );
    // Also catch .tf / helm paths that mention AI config.
    const iacPathRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /\.(tf|hcl)$|\/(terraform|pulumi|helm|kustomize|infra)\//i.test(path) &&
        (AI_CONFIG_RE.test(path) || AI_CONFIG_RE.test(text)),
      8,
    );
    const allDeclarative = [...new Set([...declarativeRefs, ...iacPathRefs])];

    const driftRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRIFT_RE.test(path) || DRIFT_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiConfigAsCodeReport({
      assessedAt: ctx.assessedAt.toISOString(),
      declarative: {
        found: allDeclarative.length > 0,
        refs: allDeclarative,
      },
      drift: { found: driftRefs.length > 0, refs: driftRefs },
      aiConfigSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-config-as-code-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-config-as-code-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-config-as-code",
          "dep-m3",
          DETECTOR_ID,
          ...(report.summary.depM3Satisfied ? ["dep-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.declarative.refs,
        ...report.signals.drift.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-config-as-code-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-M3 status=${report.summary.statusHint} configAsCode=${report.summary.configAsCodeSignalsPresent} satisfied=${report.summary.depM3Satisfied}; report=imports/${PLUGIN_ID}/ai-config-as-code-report.json`,
      nodes,
    };
  },
};
