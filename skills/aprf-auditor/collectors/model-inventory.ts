/**
 * model-inventory — MOD-R4 / repo-model-inventory.
 *
 * Discovers model inventory/registry with owner, residency, intended use.
 * Import incompleteInventoryRows=0 under imports/model-inventory/ to unlock
 * PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "model-inventory";
const RELATED = ["MOD-R4"] as const;
const DETECTOR_ID = "repo-model-inventory";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MODEL_PATH_RE =
  /(model|llm|openai|anthropic|bedrock|vertex|azure.?openai|provider|inference)/i;

const INVENTORY_RE =
  /\b(model[\s_-]*(inventory|registry|catalog)|inventory[\s_-]*of[\s_-]*models|registered[\s_-]*models)\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|model[\s_-]*owner|maintainer|raci)\b/i;

const RESIDENCY_RE =
  /\b(residency|data[\s_-]*residency|region[\s_-]*(constraint|policy)|allowed[\s_-]*regions?)\b/i;

const INTENDED_USE_RE =
  /\b(intended[\s_-]*use|use[\s_-]*case|workload[\s_-]*(purpose|type)|purpose)\b/i;

export interface ModelInventoryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    inventory: { found: boolean; refs: string[] };
    owners: { found: boolean; refs: string[] };
    residency: { found: boolean; refs: string[] };
    intendedUse: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    incompleteInventoryRows: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    inventorySignalsPresent: boolean;
    modR4Satisfied: boolean | null;
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
      ".csv",
      ".tf",
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
): ModelInventoryReport["importedResults"] {
  const sources: string[] = [];
  let incompleteInventoryRows: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-inventory-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      incompleteInventoryRows =
        asNum(data.incompleteInventoryRows) ??
        asNum(data.incomplete_inventory_rows) ??
        incompleteInventoryRows;

      const missingOwner =
        asNum(data.missingOwner) ?? asNum(data.missing_owner);
      const missingResidency =
        asNum(data.missingResidency) ?? asNum(data.missing_residency);
      const missingIntendedUse =
        asNum(data.missingIntendedUse) ?? asNum(data.missing_intended_use);
      // Per-field missing counts overlap on the same incomplete rows; sum
      // inflates. Max approximates rows missing ≥1 required field.
      if (
        incompleteInventoryRows === null &&
        missingOwner !== null &&
        missingResidency !== null &&
        missingIntendedUse !== null
      ) {
        incompleteInventoryRows = Math.max(
          missingOwner,
          missingResidency,
          missingIntendedUse,
        );
      }
      if (asBool(data.inventoryComplete) === true) {
        incompleteInventoryRows = incompleteInventoryRows ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    incompleteInventoryRows,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelInventoryReport(opts: {
  assessedAt: string;
  inventory: { found: boolean; refs: string[] };
  owners: { found: boolean; refs: string[] };
  residency: { found: boolean; refs: string[] };
  intendedUse: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelInventoryReport["importedResults"];
}): ModelInventoryReport {
  const notes: string[] = [];
  const inventorySignalsPresent =
    opts.inventory.found ||
    opts.owners.found ||
    opts.residency.found ||
    opts.intendedUse.found;

  if (!opts.modelSignals && !inventorySignalsPresent && !opts.imported.found) {
    notes.push(
      "No model/inventory signals — MOD-R4 may be NOT_APPLICABLE if there are no production model calls.",
    );
  }
  if (opts.inventory.found) {
    notes.push(`Inventory refs: ${opts.inventory.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.owners.found) {
    notes.push(`Owner-field refs: ${opts.owners.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.residency.found) {
    notes.push(
      `Residency-field refs: ${opts.residency.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.intendedUse.found) {
    notes.push(
      `Intended-use refs: ${opts.intendedUse.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (incompleteRows=${opts.imported.incompleteInventoryRows})`,
    );
  } else if (inventorySignalsPresent) {
    notes.push(
      "Inventory signals alone are PARTIAL — import incompleteInventoryRows=0 (measuredAt ≤90d) under imports/model-inventory/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const completeOk =
    opts.imported.incompleteInventoryRows !== null &&
    opts.imported.incompleteInventoryRows === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelInventoryReport["summary"]["statusHint"] =
    "not_demonstrated";
  let modR4Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.incompleteInventoryRows !== null &&
      opts.imported.incompleteInventoryRows > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.modelSignals && !inventorySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    modR4Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modR4Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete inventory rows or evidence older than 90 days — MOD-R4 fail.",
    );
  } else if (
    (inventorySignalsPresent || opts.imported.found) &&
    completeOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modR4Satisfied = true;
  } else if (inventorySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modR4Satisfied = false;
    if (opts.imported.found && !completeOk) {
      notes.push("Import must show incompleteInventoryRows=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-R4 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modR4Satisfied = null;
    notes.push(
      "Model signals present but no inventory / owner / residency / intended-use evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      inventory: opts.inventory,
      owners: opts.owners,
      residency: opts.residency,
      intendedUse: opts.intendedUse,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      inventorySignalsPresent,
      modR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelInventoryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INVENTORY_RE.test(path) || INVENTORY_RE.test(text),
      12,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INVENTORY_RE.test(path) || MODEL_PATH_RE.test(path)) &&
        (OWNER_RE.test(text) || OWNER_RE.test(path)),
      12,
    );
    const residencyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INVENTORY_RE.test(path) || MODEL_PATH_RE.test(path)) &&
        (RESIDENCY_RE.test(text) || RESIDENCY_RE.test(path)),
      12,
    );
    const intendedUseRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INVENTORY_RE.test(path) || MODEL_PATH_RE.test(path)) &&
        (INTENDED_USE_RE.test(text) || INTENDED_USE_RE.test(path)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelInventoryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      inventory: { found: inventoryRefs.length > 0, refs: inventoryRefs },
      owners: { found: ownerRefs.length > 0, refs: ownerRefs },
      residency: { found: residencyRefs.length > 0, refs: residencyRefs },
      intendedUse: {
        found: intendedUseRefs.length > 0,
        refs: intendedUseRefs,
      },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-inventory-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-inventory-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-inventory",
          "mod-r4",
          DETECTOR_ID,
          ...(report.summary.modR4Satisfied ? ["mod-r4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.inventory.refs,
        ...report.signals.owners.refs,
        ...report.signals.residency.refs,
        ...report.signals.intendedUse.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-inventory-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-R4 status=${report.summary.statusHint} inventory=${report.summary.inventorySignalsPresent} satisfied=${report.summary.modR4Satisfied}; report=imports/${PLUGIN_ID}/model-inventory-report.json`,
      nodes,
    };
  },
};
