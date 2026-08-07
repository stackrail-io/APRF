/**
 * embedding-index-migration — DEP-R3 / repo-embedding-index-migration.
 *
 * Discovers automated embedding/index version migrations with validation gates.
 * Import automatedMigrationWithValidationGates +
 * lastUpgradeSucceededWithoutDualWriteGaps (and lastUpgradeWithin12Months)
 * under imports/embedding-index-migration/ to unlock PASS (measuredAt ≤90d).
 * N/A when no embeddings/indexes, or noUpgradeInWindowAttested=true.
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

const PLUGIN_ID = "embedding-index-migration";
const RELATED = ["DEP-R3"] as const;
const DETECTOR_ID = "repo-embedding-index-migration";
const IMPORT_MAX_AGE_DAYS = 90;
const UPGRADE_MAX_AGE_DAYS = 365;

const EMBED_INDEX_RE =
  /\b(embedd(?:ing|ings)|vector[\s_-]*index|vector[\s_-]*store|faiss|pinecone|weaviate|chroma|qdrant|opensearch|elasticsearch[\s_-]*knn|hnsw)\b/i;

const MIGRATION_RE =
  /\b(embedd(?:ing)?[\s_-]*migrat\w*|index[\s_-]*migrat\w*|re[\s_-]*embed|reindex|version[\s_-]*upgrade|schema[\s_-]*migrat\w*)\b/i;

const VALIDATION_RE =
  /\b(validation[\s_-]*gate|migrat\w*[\s_-]*validat\w*|cutover[\s_-]*check|dual[\s_-]*write|shadow[\s_-]*index|parity[\s_-]*check)\b/i;

export interface EmbeddingIndexMigrationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    embedIndex: { found: boolean; refs: string[] };
    migration: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    noUpgradeInWindowAttested: boolean | null;
    automatedMigrationWithValidationGates: boolean | null;
    lastUpgradeWithin12Months: boolean | null;
    lastUpgradeAgeDays: number | null;
    lastUpgradeSucceededWithoutDualWriteGaps: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    embedIndexSignalsPresent: boolean;
    migrationSignalsPresent: boolean;
    depR3Satisfied: boolean | null;
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
): EmbeddingIndexMigrationReport["importedResults"] {
  const sources: string[] = [];
  let noUpgradeInWindowAttested: boolean | null = null;
  let automatedMigrationWithValidationGates: boolean | null = null;
  let lastUpgradeWithin12Months: boolean | null = null;
  let lastUpgradeAgeDays: number | null = null;
  let lastUpgradeSucceededWithoutDualWriteGaps: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/embedding-index-migration-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      noUpgradeInWindowAttested =
        asBool(data.noUpgradeInWindowAttested) ??
        asBool(data.no_upgrade_in_window_attested) ??
        asBool(data.noUpgradeAttested) ??
        noUpgradeInWindowAttested;
      automatedMigrationWithValidationGates =
        asBool(data.automatedMigrationWithValidationGates) ??
        asBool(data.automated_migration_with_validation_gates) ??
        asBool(data.automatedMigrationConfigured) ??
        automatedMigrationWithValidationGates;
      lastUpgradeAgeDays =
        asNum(data.lastUpgradeAgeDays) ??
        asNum(data.last_upgrade_age_days) ??
        lastUpgradeAgeDays;
      lastUpgradeWithin12Months =
        asBool(data.lastUpgradeWithin12Months) ??
        asBool(data.last_upgrade_within_12_months) ??
        lastUpgradeWithin12Months;
      lastUpgradeSucceededWithoutDualWriteGaps =
        asBool(data.lastUpgradeSucceededWithoutDualWriteGaps) ??
        asBool(data.last_upgrade_succeeded_without_dual_write_gaps) ??
        asBool(data.noDualWriteGaps) ??
        lastUpgradeSucceededWithoutDualWriteGaps;

      if (lastUpgradeAgeDays !== null) {
        lastUpgradeWithin12Months =
          lastUpgradeWithin12Months ??
          lastUpgradeAgeDays <= UPGRADE_MAX_AGE_DAYS;
      }
      if (
        asBool(data.validationGatesPresent) === true &&
        asBool(data.automatedMigrationConfigured) === true
      ) {
        automatedMigrationWithValidationGates =
          automatedMigrationWithValidationGates ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    noUpgradeInWindowAttested,
    automatedMigrationWithValidationGates,
    lastUpgradeWithin12Months,
    lastUpgradeAgeDays,
    lastUpgradeSucceededWithoutDualWriteGaps,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEmbeddingIndexMigrationReport(opts: {
  assessedAt: string;
  embedIndex: { found: boolean; refs: string[] };
  migration: { found: boolean; refs: string[] };
  imported: EmbeddingIndexMigrationReport["importedResults"];
}): EmbeddingIndexMigrationReport {
  const notes: string[] = [];
  const embedIndexSignalsPresent = opts.embedIndex.found;
  const migrationSignalsPresent = opts.migration.found;

  if (
    !embedIndexSignalsPresent &&
    !migrationSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No embedding/index or migration signals — DEP-R3 may be NOT_APPLICABLE if no vector indexes/embeddings are in scope.",
    );
  }
  if (opts.embedIndex.found) {
    notes.push(
      `Embed/index refs: ${opts.embedIndex.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.migration.found) {
    notes.push(
      `Migration refs: ${opts.migration.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (noUpgrade=${opts.imported.noUpgradeInWindowAttested}, automated=${opts.imported.automatedMigrationWithValidationGates}, within12m=${opts.imported.lastUpgradeWithin12Months}, noDualWriteGaps=${opts.imported.lastUpgradeSucceededWithoutDualWriteGaps})`,
    );
  } else if (migrationSignalsPresent) {
    notes.push(
      "Migration signals alone are PARTIAL — import automatedMigrationWithValidationGates=true + lastUpgradeSucceededWithoutDualWriteGaps=true + lastUpgradeWithin12Months=true (measuredAt ≤90d) under imports/embedding-index-migration/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const automatedOk =
    opts.imported.automatedMigrationWithValidationGates === true ||
    (migrationSignalsPresent &&
      opts.imported.automatedMigrationWithValidationGates !== false);
  const upgradeFresh =
    opts.imported.lastUpgradeWithin12Months === true ||
    (opts.imported.lastUpgradeAgeDays !== null &&
      opts.imported.lastUpgradeAgeDays <= UPGRADE_MAX_AGE_DAYS);
  const successOk =
    opts.imported.lastUpgradeSucceededWithoutDualWriteGaps === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const noUpgrade =
    opts.imported.found && opts.imported.noUpgradeInWindowAttested === true;

  let statusHint: EmbeddingIndexMigrationReport["summary"]["statusHint"];
  let depR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !noUpgrade &&
    (opts.imported.automatedMigrationWithValidationGates === false ||
      opts.imported.lastUpgradeSucceededWithoutDualWriteGaps === false ||
      opts.imported.lastUpgradeWithin12Months === false ||
      (typeof opts.imported.lastUpgradeAgeDays === "number" &&
        opts.imported.lastUpgradeAgeDays > UPGRADE_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (noUpgrade) {
    statusHint = "not_applicable";
    depR3Satisfied = null;
    notes.push(
      "noUpgradeInWindowAttested=true — DEP-R3 NOT_APPLICABLE (no embedding/index upgrade in window).",
    );
  } else if (
    !embedIndexSignalsPresent &&
    !migrationSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    depR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing automated migration/gates, dual-write gaps, upgrade older than 12 months, or evidence older than 90 days — DEP-R3 fail.",
    );
  } else if (
    (migrationSignalsPresent || opts.imported.found) &&
    automatedOk &&
    upgradeFresh &&
    successOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depR3Satisfied = true;
  } else if (migrationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depR3Satisfied = false;
    if (opts.imported.found && !automatedOk) {
      notes.push(
        "Import must show automatedMigrationWithValidationGates=true (or retain migration/validation signals in repo).",
      );
    }
    if (opts.imported.found && !upgradeFresh) {
      notes.push(
        "Import must show lastUpgradeWithin12Months=true (or lastUpgradeAgeDays≤365).",
      );
    }
    if (opts.imported.found && !successOk) {
      notes.push(
        "Import must show lastUpgradeSucceededWithoutDualWriteGaps=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DEP-R3 PASS.",
      );
    }
  } else if (embedIndexSignalsPresent) {
    statusHint = "not_demonstrated";
    depR3Satisfied = null;
    notes.push(
      "Embedding/index signals present but no automated migration evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      embedIndex: opts.embedIndex,
      migration: opts.migration,
    },
    importedResults: opts.imported,
    summary: {
      embedIndexSignalsPresent,
      migrationSignalsPresent,
      depR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const embeddingIndexMigrationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const embedIndexRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EMBED_INDEX_RE.test(path) || EMBED_INDEX_RE.test(text),
      12,
    );
    const migrationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        MIGRATION_RE.test(path) ||
        MIGRATION_RE.test(text) ||
        ((EMBED_INDEX_RE.test(path) || EMBED_INDEX_RE.test(text)) &&
          VALIDATION_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildEmbeddingIndexMigrationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      embedIndex: { found: embedIndexRefs.length > 0, refs: embedIndexRefs },
      migration: { found: migrationRefs.length > 0, refs: migrationRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "embedding-index-migration-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/embedding-index-migration-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "embedding-index-migration",
          "dep-r3",
          DETECTOR_ID,
          ...(report.summary.depR3Satisfied ? ["dep-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.embedIndex.refs,
        ...report.signals.migration.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["embedding-index-migration-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-R3 status=${report.summary.statusHint} migration=${report.summary.migrationSignalsPresent} satisfied=${report.summary.depR3Satisfied}; report=imports/${PLUGIN_ID}/embedding-index-migration-report.json`,
      nodes,
    };
  },
};
