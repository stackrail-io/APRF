/**
 * prompt-version-registry — PRM-M1 / prompt-versioned + prompt-has-owner.
 *
 * Discovers versioned production prompts with named owners.
 * Import unversionedProductionPrompts=0 + productionPromptsMissingOwner=0
 * under imports/prompt-version-registry/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "prompt-version-registry";
const RELATED = ["PRM-M1"] as const;
const DETECTOR_IDS = ["prompt-versioned", "prompt-has-owner"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const VERSION_RE =
  /\b(prompt[\s_-]*version\w*|immutable[\s_-]*version\w*|version[\s_-]*id\w*|prompt[\s_-]*id\w*|semver|pinned[\s_-]*prompt)\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|prompt[\s_-]*owner|maintainer|raci)\b/i;

const REGISTRY_RE =
  /\b(prompt[\s_-]*(registry|catalog|store|library)|registry[\s_-]*of[\s_-]*prompts)\b/i;

export interface PromptVersionRegistryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorIds: string[];
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    registry: { found: boolean; refs: string[] };
    versioned: { found: boolean; refs: string[] };
    owners: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    unversionedProductionPrompts: number | null;
    productionPromptsMissingOwner: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    registrySignalsPresent: boolean;
    prmM1Satisfied: boolean | null;
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
      ".prompt",
      ".txt",
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
        /\b(system[\s_-]*prompt|prompt[\s_-]*template|chat[\s_-]*prompt)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptVersionRegistryReport["importedResults"] {
  const sources: string[] = [];
  let unversionedProductionPrompts: number | null = null;
  let productionPromptsMissingOwner: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-version-registry-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      unversionedProductionPrompts =
        asNum(data.unversionedProductionPrompts) ??
        asNum(data.unversioned_production_prompts) ??
        unversionedProductionPrompts;
      productionPromptsMissingOwner =
        asNum(data.productionPromptsMissingOwner) ??
        asNum(data.production_prompts_missing_owner) ??
        productionPromptsMissingOwner;

      if (asBool(data.allProductionPromptsVersioned) === true) {
        unversionedProductionPrompts = unversionedProductionPrompts ?? 0;
      }
      if (asBool(data.allProductionPromptsHaveOwner) === true) {
        productionPromptsMissingOwner = productionPromptsMissingOwner ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    unversionedProductionPrompts,
    productionPromptsMissingOwner,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptVersionRegistryReport(opts: {
  assessedAt: string;
  registry: { found: boolean; refs: string[] };
  versioned: { found: boolean; refs: string[] };
  owners: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptVersionRegistryReport["importedResults"];
}): PromptVersionRegistryReport {
  const notes: string[] = [];
  const registrySignalsPresent =
    opts.registry.found || opts.versioned.found || opts.owners.found;

  if (!opts.promptSignals && !registrySignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/registry signals — PRM-M1 may be NOT_APPLICABLE if there are no production prompts.",
    );
  }
  if (opts.registry.found) {
    notes.push(`Registry refs: ${opts.registry.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.versioned.found) {
    notes.push(`Version refs: ${opts.versioned.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.owners.found) {
    notes.push(`Owner refs: ${opts.owners.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (unversioned=${opts.imported.unversionedProductionPrompts}, missingOwner=${opts.imported.productionPromptsMissingOwner})`,
    );
  } else if (registrySignalsPresent) {
    notes.push(
      "Registry signals alone are PARTIAL — import unversionedProductionPrompts=0 + productionPromptsMissingOwner=0 (measuredAt ≤90d) under imports/prompt-version-registry/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const versionOk =
    opts.imported.unversionedProductionPrompts !== null &&
    opts.imported.unversionedProductionPrompts === 0;
  const ownerOk =
    opts.imported.productionPromptsMissingOwner !== null &&
    opts.imported.productionPromptsMissingOwner === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptVersionRegistryReport["summary"]["statusHint"] =
    "not_demonstrated";
  let prmM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.unversionedProductionPrompts !== null &&
      opts.imported.unversionedProductionPrompts > 0) ||
      (opts.imported.productionPromptsMissingOwner !== null &&
        opts.imported.productionPromptsMissingOwner > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.promptSignals && !registrySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    prmM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmM1Satisfied = false;
    notes.push(
      "Imported evidence shows unversioned prompts, missing owners, or evidence older than 90 days — PRM-M1 fail.",
    );
  } else if (
    (registrySignalsPresent || opts.imported.found) &&
    versionOk &&
    ownerOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmM1Satisfied = true;
  } else if (registrySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmM1Satisfied = false;
    if (opts.imported.found && !versionOk) {
      notes.push("Import must show unversionedProductionPrompts=0.");
    }
    if (opts.imported.found && !ownerOk) {
      notes.push("Import must show productionPromptsMissingOwner=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-M1 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmM1Satisfied = null;
    notes.push(
      "Prompt signals present but no versioned registry / owner evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorIds: [...DETECTOR_IDS],
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      registry: opts.registry,
      versioned: opts.versioned,
      owners: opts.owners,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      registrySignalsPresent,
      prmM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptVersionRegistryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const registryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REGISTRY_RE.test(path) || REGISTRY_RE.test(text),
      12,
    );
    const versionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMPT_PATH_RE.test(path) || VERSION_RE.test(path)) &&
        (VERSION_RE.test(text) || VERSION_RE.test(path)),
      12,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMPT_PATH_RE.test(path) || REGISTRY_RE.test(path)) &&
        (OWNER_RE.test(text) || OWNER_RE.test(path)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptVersionRegistryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      registry: { found: registryRefs.length > 0, refs: registryRefs },
      versioned: { found: versionRefs.length > 0, refs: versionRefs },
      owners: { found: ownerRefs.length > 0, refs: ownerRefs },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-version-registry-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-version-registry-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-version-registry",
          "prm-m1",
          ...DETECTOR_IDS,
          ...(report.summary.prmM1Satisfied ? ["prm-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.registry.refs,
        ...report.signals.versioned.refs,
        ...report.signals.owners.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-version-registry-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-M1 status=${report.summary.statusHint} registry=${report.summary.registrySignalsPresent} satisfied=${report.summary.prmM1Satisfied}; report=imports/${PLUGIN_ID}/prompt-version-registry-report.json`,
      nodes,
    };
  },
};
