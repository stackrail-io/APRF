/**
 * rag-corpus-governance — DG-M1 / repo-rag-corpus-config detector executor.
 *
 * Discovers production RAG corpus/index configs with owner, version, and
 * refresh cadence. Import a complete inventory under imports/rag-corpus-governance/
 * to unlock PASS.
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

const PLUGIN_ID = "rag-corpus-governance";
const RELATED = ["DG-M1"] as const;
const DETECTOR_ID = "repo-rag-corpus-config";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const RAG_PATH_RE =
  /(rag|corpus|vector|pinecone|weaviate|chroma|qdrant|opensearch|elasticsearch|embedding|retriev|faiss|milvus)/i;

const CORPUS_RE =
  /\b(corpus|knowledge[\s_-]*base|vector[\s_-]*(index|store|db)|retrieval[\s_-]*index|index[\s_-]*(name|id|config))\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|data[\s_-]*owner|corpus[\s_-]*owner|index[\s_-]*owner)\b/i;

const VERSION_RE =
  /\b(version(?:Id|_id|ID)?|index[\s_-]*version|corpus[\s_-]*version|snapshot[\s_-]*id|embed(?:ding)?[\s_-]*version)\b/i;

const CADENCE_RE =
  /\b(refresh[\s_-]*(cadence|schedule|interval|cron)|reindex[\s_-]*(schedule|cron)|sync[\s_-]*schedule|ttl|freshness[\s_-]*sla)\b/i;

const STALE_RE =
  /\b(stale|rebuild|reindex|freshness[\s_-]*alert|out[\s_-]*of[\s_-]*date|cadence[\s_-]*breach)\b/i;

export interface RagCorpusGovernanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    corpusConfig: { found: boolean; refs: string[] };
    owner: { found: boolean; refs: string[] };
    version: { found: boolean; refs: string[] };
    cadence: { found: boolean; refs: string[] };
    staleHandling: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionIndexCount: number | null;
    missingOwnerCount: number | null;
    missingVersionCount: number | null;
    missingCadenceCount: number | null;
    staleUnhandledCount: number | null;
    coversAllProductionIndexes: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    ragSignalsPresent: boolean;
    configSignalsPresent: boolean;
    dgM1Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectRagSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        RAG_PATH_RE.test(path) ||
        CORPUS_RE.test(text) ||
        /\b(pinecone|weaviate|chroma|qdrant|faiss|milvus|vectorStore)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): RagCorpusGovernanceReport["importedResults"] {
  const sources: string[] = [];
  let productionIndexCount: number | null = null;
  let missingOwnerCount: number | null = null;
  let missingVersionCount: number | null = null;
  let missingCadenceCount: number | null = null;
  let staleUnhandledCount: number | null = null;
  let coversAllProductionIndexes: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/rag-corpus-governance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      productionIndexCount =
        asNum(data.productionIndexCount) ??
        asNum(data.indexCount) ??
        productionIndexCount;
      missingOwnerCount =
        asNum(data.missingOwnerCount) ?? missingOwnerCount;
      missingVersionCount =
        asNum(data.missingVersionCount) ?? missingVersionCount;
      missingCadenceCount =
        asNum(data.missingCadenceCount) ?? missingCadenceCount;
      staleUnhandledCount =
        asNum(data.staleUnhandledCount) ??
        asNum(data.staleNotFlaggedOrRebuiltCount) ??
        staleUnhandledCount;
      coversAllProductionIndexes =
        asBool(data.coversAllProductionIndexes) ??
        asBool(data.coversAllIndexes) ??
        coversAllProductionIndexes;

      const indexes = Array.isArray(data.indexes)
        ? (data.indexes as Array<Record<string, unknown>>)
        : Array.isArray(data.corpora)
          ? (data.corpora as Array<Record<string, unknown>>)
          : [];
      if (indexes.length > 0) {
        productionIndexCount = indexes.length;
        let missOwner = 0;
        let missVer = 0;
        let missCad = 0;
        let staleUnhandled = 0;
        for (const ix of indexes) {
          const owner =
            typeof ix.owner === "string" ? ix.owner.trim() : "";
          const version = String(
            ix.versionId ?? ix.version ?? ix.indexVersion ?? "",
          ).trim();
          const cadence = String(
            ix.refreshCadence ?? ix.cadence ?? ix.refreshSchedule ?? "",
          ).trim();
          if (!owner) missOwner += 1;
          if (!version) missVer += 1;
          if (!cadence) missCad += 1;
          const stale = ix.stale === true || ix.pastCadence === true;
          const handled =
            ix.flagged === true ||
            ix.rebuilt === true ||
            ix.staleHandled === true;
          if (stale && !handled) staleUnhandled += 1;
        }
        missingOwnerCount = missOwner;
        missingVersionCount = missVer;
        missingCadenceCount = missCad;
        staleUnhandledCount = staleUnhandled;
        if (coversAllProductionIndexes == null) {
          coversAllProductionIndexes = true;
        }
      }

      if (
        asBool(data.allHaveOwnerVersionCadence) === true &&
        missingOwnerCount == null
      ) {
        missingOwnerCount = 0;
        missingVersionCount = 0;
        missingCadenceCount = 0;
      }
      if (
        asBool(data.staleFlaggedOrRebuilt) === true &&
        staleUnhandledCount == null
      ) {
        staleUnhandledCount = 0;
      }
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionIndexCount,
    missingOwnerCount,
    missingVersionCount,
    missingCadenceCount,
    staleUnhandledCount,
    coversAllProductionIndexes,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildRagCorpusGovernanceReport(opts: {
  assessedAt: string;
  signals: RagCorpusGovernanceReport["signals"];
  ragSignals: boolean;
  imported: RagCorpusGovernanceReport["importedResults"];
}): RagCorpusGovernanceReport {
  const notes: string[] = [];
  const configSignalsPresent =
    opts.signals.corpusConfig.found ||
    (opts.signals.owner.found &&
      opts.signals.version.found &&
      opts.signals.cadence.found);

  if (!opts.ragSignals && !configSignalsPresent && !opts.imported.found) {
    notes.push(
      "No RAG/corpus/index signals — DG-M1 may be NOT_APPLICABLE if there is no production retrieval surface.",
    );
  }
  if (opts.signals.corpusConfig.found) {
    notes.push(
      `Corpus/index refs: ${opts.signals.corpusConfig.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.owner.found) {
    notes.push(`Owner refs: ${opts.signals.owner.refs.slice(0, 2).join(", ")}`);
  }
  if (opts.signals.version.found) {
    notes.push(
      `Version refs: ${opts.signals.version.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.cadence.found) {
    notes.push(
      `Cadence refs: ${opts.signals.cadence.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.staleHandling.found) {
    notes.push(
      `Stale-handling refs: ${opts.signals.staleHandling.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (indexes=${opts.imported.productionIndexCount}, missOwner=${opts.imported.missingOwnerCount}, missVer=${opts.imported.missingVersionCount}, missCad=${opts.imported.missingCadenceCount}, staleUnhandled=${opts.imported.staleUnhandledCount}, coversAll=${opts.imported.coversAllProductionIndexes}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (configSignalsPresent) {
    notes.push(
      "Config signals alone are PARTIAL — import inventory with 0 missing owner/version/cadence and staleUnhandledCount=0 ≤90d under imports/rag-corpus-governance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const inventoryComplete =
    opts.imported.coversAllProductionIndexes === true &&
    (opts.imported.productionIndexCount ?? 0) >= 0 &&
    opts.imported.missingOwnerCount === 0 &&
    opts.imported.missingVersionCount === 0 &&
    opts.imported.missingCadenceCount === 0 &&
    opts.imported.staleUnhandledCount === 0;
  // Vacuous: zero production indexes with coversAll is OK only if explicitly attested
  const passOk =
    opts.imported.coversAllProductionIndexes === true &&
    opts.imported.missingOwnerCount === 0 &&
    opts.imported.missingVersionCount === 0 &&
    opts.imported.missingCadenceCount === 0 &&
    opts.imported.staleUnhandledCount === 0 &&
    ageOk &&
    importFresh;

  let statusHint: RagCorpusGovernanceReport["summary"]["statusHint"];
  let dgM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllProductionIndexes === false ||
      (opts.imported.missingOwnerCount !== null &&
        opts.imported.missingOwnerCount > 0) ||
      (opts.imported.missingVersionCount !== null &&
        opts.imported.missingVersionCount > 0) ||
      (opts.imported.missingCadenceCount !== null &&
        opts.imported.missingCadenceCount > 0) ||
      (opts.imported.staleUnhandledCount !== null &&
        opts.imported.staleUnhandledCount > 0) ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.ragSignals &&
    !opts.signals.corpusConfig.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgM1Satisfied = false;
    notes.push(
      "Imported inventory shows missing fields, uncovered indexes, unhandled stale indexes, or evidence older than 90 days — DG-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgM1Satisfied = true;
    if ((opts.imported.productionIndexCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllProductionIndexes with zero production indexes — confirm no production retrieval surface.",
      );
    }
  } else if (
    opts.signals.corpusConfig.found ||
    opts.signals.owner.found ||
    opts.signals.version.found ||
    opts.signals.cadence.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgM1Satisfied = false;
    if (opts.imported.found && !inventoryComplete) {
      if (opts.imported.coversAllProductionIndexes !== true) {
        notes.push("Import must show coversAllProductionIndexes=true.");
      }
      if (
        opts.imported.missingOwnerCount !== 0 ||
        opts.imported.missingVersionCount !== 0 ||
        opts.imported.missingCadenceCount !== 0
      ) {
        notes.push(
          "Import must show missingOwnerCount, missingVersionCount, and missingCadenceCount = 0.",
        );
      }
      if (opts.imported.staleUnhandledCount !== 0) {
        notes.push("Import must show staleUnhandledCount=0.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DG-M1 PASS.",
        );
      }
    }
  } else if (opts.ragSignals) {
    statusHint = "not_demonstrated";
    dgM1Satisfied = null;
    notes.push(
      "RAG signals present but no corpus/index ownership/version/cadence config found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      ragSignalsPresent: opts.ragSignals,
      configSignalsPresent,
      dgM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const ragCorpusGovernanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const ragSignals = detectRagSignals(ctx.targetPath, maxFiles);

    const inRagContext = (path: string, text: string) =>
      RAG_PATH_RE.test(path) ||
      CORPUS_RE.test(path) ||
      CORPUS_RE.test(text) ||
      RAG_PATH_RE.test(text);

    const corpusRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CORPUS_RE.test(path) || CORPUS_RE.test(text)) &&
        inRagContext(path, text),
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) &&
        inRagContext(path, text),
      12,
    );
    const versionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (VERSION_RE.test(path) || VERSION_RE.test(text)) &&
        inRagContext(path, text),
      12,
    );
    const cadenceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CADENCE_RE.test(path) || CADENCE_RE.test(text)) &&
        inRagContext(path, text),
      12,
    );
    const staleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (STALE_RE.test(path) || STALE_RE.test(text)) &&
        inRagContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildRagCorpusGovernanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        corpusConfig: {
          found: corpusRefs.length > 0,
          refs: corpusRefs,
        },
        owner: { found: ownerRefs.length > 0, refs: ownerRefs },
        version: { found: versionRefs.length > 0, refs: versionRefs },
        cadence: { found: cadenceRefs.length > 0, refs: cadenceRefs },
        staleHandling: { found: staleRefs.length > 0, refs: staleRefs },
      },
      ragSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "rag-corpus-governance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/rag-corpus-governance-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "rag-corpus-governance",
          "dg-m1",
          DETECTOR_ID,
          ...(report.summary.configSignalsPresent
            ? ["corpus-config-signals"]
            : []),
          ...(report.summary.dgM1Satisfied ? ["dg-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...corpusRefs.slice(0, 2),
        ...ownerRefs.slice(0, 2),
        ...versionRefs.slice(0, 1),
        ...cadenceRefs.slice(0, 1),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["rag-corpus-governance-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-M1 status=${report.summary.statusHint} config=${report.summary.configSignalsPresent} satisfied=${report.summary.dgM1Satisfied}; report=imports/${PLUGIN_ID}/rag-corpus-governance-report.json`,
      nodes,
    };
  },
};
