/**
 * env-parity-model-tool-catalog — DEP-R2 / repo-env-parity-model-tool-catalog.
 *
 * Discovers prod vs staging parity for model pins + tool catalogs.
 * Import lastParityScanWithin30Days + unexplainedParityDrifts=0 under
 * imports/env-parity-model-tool-catalog/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "env-parity-model-tool-catalog";
const RELATED = ["DEP-R2"] as const;
const DETECTOR_ID = "repo-env-parity-model-tool-catalog";
const IMPORT_MAX_AGE_DAYS = 90;
const SCAN_MAX_AGE_DAYS = 30;

const SCOPE_RE =
  /(model[\s_-]*pin|model[\s_-]*version|tool[\s_-]*catalog|tool[\s_-]*registry)/i;

const PARITY_RE =
  /\b(env(?:ironment)?[\s_-]*parity|parity[\s_-]*scan|parity[\s_-]*check|prod[\s_-]*vs[\s_-]*staging|staging[\s_-]*vs[\s_-]*prod|cross[\s_-]*env(?:ironment)?[\s_-]*diff)\b/i;

const DRIFT_RE =
  /\b(unexplained[\s_-]*drift|documented[\s_-]*delta|parity[\s_-]*drift|env[\s_-]*drift)\b/i;

export interface EnvParityModelToolCatalogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    parity: { found: boolean; refs: string[] };
    scope: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    lastParityScanWithin30Days: boolean | null;
    parityScanAgeDays: number | null;
    unexplainedParityDrifts: number | null;
    coversModelPinsAndToolCatalogs: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    scopeSignalsPresent: boolean;
    paritySignalsPresent: boolean;
    depR2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".sh"],
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
): EnvParityModelToolCatalogReport["importedResults"] {
  const sources: string[] = [];
  let lastParityScanWithin30Days: boolean | null = null;
  let parityScanAgeDays: number | null = null;
  let unexplainedParityDrifts: number | null = null;
  let coversModelPinsAndToolCatalogs: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/env-parity-model-tool-catalog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      parityScanAgeDays =
        asNum(data.parityScanAgeDays) ??
        asNum(data.parity_scan_age_days) ??
        parityScanAgeDays;
      lastParityScanWithin30Days =
        asBool(data.lastParityScanWithin30Days) ??
        asBool(data.last_parity_scan_within_30_days) ??
        lastParityScanWithin30Days;
      unexplainedParityDrifts =
        asNum(data.unexplainedParityDrifts) ??
        asNum(data.unexplained_parity_drifts) ??
        asNum(data.unexplainedDrifts) ??
        unexplainedParityDrifts;
      coversModelPinsAndToolCatalogs =
        asBool(data.coversModelPinsAndToolCatalogs) ??
        asBool(data.covers_model_pins_and_tool_catalogs) ??
        coversModelPinsAndToolCatalogs;

      if (parityScanAgeDays !== null) {
        lastParityScanWithin30Days =
          lastParityScanWithin30Days ??
          parityScanAgeDays <= SCAN_MAX_AGE_DAYS;
      }
      if (asBool(data.zeroUnexplainedParityDrifts) === true) {
        unexplainedParityDrifts = unexplainedParityDrifts ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    lastParityScanWithin30Days,
    parityScanAgeDays,
    unexplainedParityDrifts,
    coversModelPinsAndToolCatalogs,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEnvParityModelToolCatalogReport(opts: {
  assessedAt: string;
  parity: { found: boolean; refs: string[] };
  scope: { found: boolean; refs: string[] };
  imported: EnvParityModelToolCatalogReport["importedResults"];
}): EnvParityModelToolCatalogReport {
  const notes: string[] = [];
  const paritySignalsPresent = opts.parity.found;
  const scopeSignalsPresent = opts.scope.found;

  if (!scopeSignalsPresent && !paritySignalsPresent && !opts.imported.found) {
    notes.push(
      "No model-pin/tool-catalog or parity signals — DEP-R2 may be NOT_APPLICABLE if those artifacts are not in scope.",
    );
  }
  if (opts.parity.found) {
    notes.push(`Parity refs: ${opts.parity.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.scope.found) {
    notes.push(`Scope refs: ${opts.scope.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scanWithin30d=${opts.imported.lastParityScanWithin30Days}, scanAge=${opts.imported.parityScanAgeDays}, unexplained=${opts.imported.unexplainedParityDrifts}, covers=${opts.imported.coversModelPinsAndToolCatalogs})`,
    );
  } else if (paritySignalsPresent) {
    notes.push(
      "Parity signals alone are PARTIAL — import lastParityScanWithin30Days=true + unexplainedParityDrifts=0 (measuredAt ≤90d) under imports/env-parity-model-tool-catalog/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const scanFresh =
    opts.imported.lastParityScanWithin30Days === true ||
    (opts.imported.parityScanAgeDays !== null &&
      opts.imported.parityScanAgeDays <= SCAN_MAX_AGE_DAYS);
  const driftsOk = opts.imported.unexplainedParityDrifts === 0;
  const coversOk =
    opts.imported.coversModelPinsAndToolCatalogs !== false &&
    (opts.imported.coversModelPinsAndToolCatalogs === true ||
      (scopeSignalsPresent && paritySignalsPresent) ||
      opts.imported.coversModelPinsAndToolCatalogs === null);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EnvParityModelToolCatalogReport["summary"]["statusHint"];
  let depR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.lastParityScanWithin30Days === false ||
      (typeof opts.imported.parityScanAgeDays === "number" &&
        opts.imported.parityScanAgeDays > SCAN_MAX_AGE_DAYS) ||
      (typeof opts.imported.unexplainedParityDrifts === "number" &&
        opts.imported.unexplainedParityDrifts > 0) ||
      opts.imported.coversModelPinsAndToolCatalogs === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!scopeSignalsPresent && !paritySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    depR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depR2Satisfied = false;
    notes.push(
      "Imported evidence shows stale parity scan (>30d), unexplained drifts >0, missing model-pin/tool-catalog coverage, or evidence older than 90 days — DEP-R2 fail.",
    );
  } else if (
    (paritySignalsPresent || opts.imported.found) &&
    scanFresh &&
    driftsOk &&
    coversOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depR2Satisfied = true;
  } else if (paritySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depR2Satisfied = false;
    if (opts.imported.found && !scanFresh) {
      notes.push(
        "Import must show lastParityScanWithin30Days=true (or parityScanAgeDays≤30).",
      );
    }
    if (opts.imported.found && !driftsOk) {
      notes.push("Import must show unexplainedParityDrifts=0.");
    }
    if (opts.imported.found && !coversOk) {
      notes.push(
        "Import must show coversModelPinsAndToolCatalogs=true (or leave unset with repo scope signals).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DEP-R2 PASS.",
      );
    }
  } else if (scopeSignalsPresent) {
    statusHint = "not_demonstrated";
    depR2Satisfied = null;
    notes.push(
      "Model-pin/tool-catalog signals present but no environment parity evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      parity: opts.parity,
      scope: opts.scope,
    },
    importedResults: opts.imported,
    summary: {
      scopeSignalsPresent,
      paritySignalsPresent,
      depR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const envParityModelToolCatalogCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const scopeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCOPE_RE.test(path) || SCOPE_RE.test(text),
      12,
    );
    const parityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        PARITY_RE.test(path) ||
        PARITY_RE.test(text) ||
        ((SCOPE_RE.test(path) || SCOPE_RE.test(text)) &&
          (PARITY_RE.test(text) || DRIFT_RE.test(text))),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEnvParityModelToolCatalogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      parity: { found: parityRefs.length > 0, refs: parityRefs },
      scope: { found: scopeRefs.length > 0, refs: scopeRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "env-parity-model-tool-catalog-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/env-parity-model-tool-catalog-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "env-parity-model-tool-catalog",
          "dep-r2",
          DETECTOR_ID,
          ...(report.summary.depR2Satisfied ? ["dep-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.parity.refs,
        ...report.signals.scope.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["env-parity-model-tool-catalog-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-R2 status=${report.summary.statusHint} parity=${report.summary.paritySignalsPresent} satisfied=${report.summary.depR2Satisfied}; report=imports/${PLUGIN_ID}/env-parity-model-tool-catalog-report.json`,
      nodes,
    };
  },
};
