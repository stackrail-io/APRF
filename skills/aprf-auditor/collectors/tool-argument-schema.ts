/**
 * tool-argument-schema — TOL-M4 / repo-tool-argument-schema.
 *
 * Discovers tool argument schemas and contract tests.
 * Import coverage under imports/tool-argument-schema/ unlocks PASS
 * (measuredAt ≤90d).
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import { ensureDir, listImportFiles, readText, redact } from "./lib/fs.ts";
import { asNum, collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "tool-argument-schema";
const RELATED = ["TOL-M4"] as const;
const DETECTOR_ID = "repo-tool-argument-schema";
const IMPORT_MAX_AGE_DAYS = 90;

const SCHEMA_RE =
  /\b(inputSchema|argument[_-]?schema|tool[_-]?schema|json[_-]?schema.{0,40}tool|parameters.{0,40}schema)\b/i;
const CONTRACT_RE =
  /\b(?:contract[_-]?tests?\b|invalid[_-]?argument\b|malicious[_-]?payload\b|schema[_-]?validat(?:e|ion|or|ed|ing)?\b|fixture[_-]?reject(?:ed|ion|s)?\b)/i;

export interface ToolArgumentSchemaReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    argumentSchema: { found: boolean; refs: string[] };
    contractTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionToolsPresent: boolean | null;
    toolsWithDeclaredArgumentSchemaPct: number | null;
    invalidArgumentFixturesRejectedPct: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolM4Satisfied: boolean | null;
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

function loadImported(
  ctx: CollectorContext,
): ToolArgumentSchemaReport["importedResults"] {
  const sources: string[] = [];
  let productionToolsPresent: boolean | null = null;
  let toolsWithDeclaredArgumentSchemaPct: number | null = null;
  let invalidArgumentFixturesRejectedPct: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/tool-argument-schema-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionToolsPresent = mergeOrBool(
        productionToolsPresent,
        asBool(data.productionToolsPresent) ??
          asBool(data.production_tools_present),
      );
      toolsWithDeclaredArgumentSchemaPct = mergeMinNum(
        toolsWithDeclaredArgumentSchemaPct,
        asNum(data.toolsWithDeclaredArgumentSchemaPct) ??
          asNum(data.tools_with_declared_argument_schema_pct),
      );
      invalidArgumentFixturesRejectedPct = mergeMinNum(
        invalidArgumentFixturesRejectedPct,
        asNum(data.invalidArgumentFixturesRejectedPct) ??
          asNum(data.invalid_argument_fixtures_rejected_pct),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionToolsPresent,
    toolsWithDeclaredArgumentSchemaPct,
    invalidArgumentFixturesRejectedPct,
    measuredAt,
    sources,
  };
}

export function buildToolArgumentSchemaReport(opts: {
  assessedAt: string;
  argumentSchema: { found: boolean; refs: string[] };
  contractTests: { found: boolean; refs: string[] };
  imported: ToolArgumentSchemaReport["importedResults"];
}): ToolArgumentSchemaReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.argumentSchema.found || opts.contractTests.found;
  const surfaceProvedForNaOverride =
    opts.argumentSchema.found || opts.contractTests.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No tool-argument-schema signals — TOL-M4 remains not demonstrated until schema/rejection coverage or productionToolsPresent=false is imported.",
    );
  }
  if (opts.argumentSchema.found) {
    notes.push(
      `Argument-schema refs: ${opts.argumentSchema.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.contractTests.found) {
    notes.push(
      `Contract-test refs: ${opts.contractTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionToolsPresent}, schemaPct=${opts.imported.toolsWithDeclaredArgumentSchemaPct}, rejectPct=${opts.imported.invalidArgumentFixturesRejectedPct}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import toolsWithDeclaredArgumentSchemaPct=100 + invalidArgumentFixturesRejectedPct=100 (measuredAt ≤90d) under imports/tool-argument-schema/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.productionToolsPresent === true;
  const schemaOk = opts.imported.toolsWithDeclaredArgumentSchemaPct === 100;
  const rejectOk = opts.imported.invalidArgumentFixturesRejectedPct === 100;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionToolsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.toolsWithDeclaredArgumentSchemaPct !== null &&
      opts.imported.toolsWithDeclaredArgumentSchemaPct < 100) ||
    (opts.imported.invalidArgumentFixturesRejectedPct !== null &&
      opts.imported.invalidArgumentFixturesRejectedPct < 100);
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: ToolArgumentSchemaReport["summary"]["statusHint"];
  let tolM4Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolM4Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete schema coverage or fixture rejection — TOL-M4 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolM4Satisfied = null;
    notes.push(
      "Imported productionToolsPresent=false — TOL-M4 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionToolsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionToolsPresent=false ignored — in-repo schema/contract signals prove the surface exists.",
    );
    if (
      surfacePresent &&
      schemaOk &&
      rejectOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      tolM4Satisfied = true;
    } else {
      statusHint = "partial";
      tolM4Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolM4Satisfied = null;
  } else if (
    surfacePresent &&
    schemaOk &&
    rejectOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolM4Satisfied = true;
  } else {
    statusHint = "partial";
    tolM4Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      argumentSchema: opts.argumentSchema,
      contractTests: opts.contractTests,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const toolArgumentSchemaCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const schemaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SCHEMA_RE.test(p) || SCHEMA_RE.test(t),
      10,
    );
    const contractRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => CONTRACT_RE.test(p) || CONTRACT_RE.test(t),
      10,
    );

    const report = buildToolArgumentSchemaReport({
      assessedAt: ctx.assessedAt.toISOString(),
      argumentSchema: { found: schemaRefs.length > 0, refs: schemaRefs },
      contractTests: { found: contractRefs.length > 0, refs: contractRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "tool-argument-schema-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M4 status=${report.summary.statusHint} satisfied=${report.summary.tolM4Satisfied}; report=imports/${PLUGIN_ID}/tool-argument-schema-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/tool-argument-schema-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-m4",
            DETECTOR_ID,
            ...(report.summary.tolM4Satisfied ? ["tol-m4-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
