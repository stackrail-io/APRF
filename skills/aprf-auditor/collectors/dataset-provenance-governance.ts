/**
 * dataset-provenance-governance — DG-M2 / repo-dataset-provenance executor.
 *
 * Discovers eval/fine-tune dataset cards with provenance + quality criteria.
 * Import inventory + promotion-block proof under
 * imports/dataset-provenance-governance/ to unlock PASS.
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

const PLUGIN_ID = "dataset-provenance-governance";
const RELATED = ["DG-M2"] as const;
const DETECTOR_ID = "repo-dataset-provenance";

const DATASET_PATH_RE =
  /(dataset|datasheet|data[\s_-]*card|eval[\s_-]*set|finetune|fine[\s_-]*tune|training[\s_-]*data|huggingface|hf[\s_-]*hub)/i;

const DATASET_RE =
  /\b(dataset[\s_-]*card|datasheet|data[\s_-]*card|eval[\s_-]*(set|suite|corpus)|fine[\s_-]*tun(?:e|ing)|training[\s_-]*(set|corpus)|benchmark[\s_-]*set)\b/i;

const PROVENANCE_RE =
  /\b(provenance|source[\s_-]*of[\s_-]*truth|data[\s_-]*origin|license|lineage|collected[\s_-]*from|derived[\s_-]*from)\b/i;

const QUALITY_RE =
  /\b(quality[\s_-]*(criteria|bar|gate|checks?)|acceptance[\s_-]*criteria|label[\s_-]*quality|contamination|dedup|schema[\s_-]*valid)\b/i;

const PROMOTE_BLOCK_RE =
  /\b(block(?:s|ed)?[\s_-]*(promote|promotion|release|fine[\s_-]*tune)|required[\s_-]*check|dataset[\s_-]*card[\s_-]*gate|missing[\s_-]*card)\b/i;

export interface DatasetProvenanceGovernanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    datasetCards: { found: boolean; refs: string[] };
    provenance: { found: boolean; refs: string[] };
    quality: { found: boolean; refs: string[] };
    promotionBlock: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    datasetCount: number | null;
    missingProvenanceCount: number | null;
    missingQualityCriteriaCount: number | null;
    coversAllEvalAndFinetuneDatasets: boolean | null;
    promotionBlockedIfMissing: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    datasetSignalsPresent: boolean;
    cardSignalsPresent: boolean;
    dgM2Satisfied: boolean | null;
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
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectDatasetSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        DATASET_PATH_RE.test(path) ||
        DATASET_RE.test(text) ||
        /\b(promptfoo|eval[\s_-]*suite|fine[\s_-]*tun)/i.test(text),
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
): DatasetProvenanceGovernanceReport["importedResults"] {
  const sources: string[] = [];
  let datasetCount: number | null = null;
  let missingProvenanceCount: number | null = null;
  let missingQualityCriteriaCount: number | null = null;
  let coversAllEvalAndFinetuneDatasets: boolean | null = null;
  let promotionBlockedIfMissing: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/dataset-provenance-governance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      datasetCount =
        asNum(data.datasetCount) ??
        asNum(data.evalAndFinetuneDatasetCount) ??
        datasetCount;
      missingProvenanceCount =
        asNum(data.missingProvenanceCount) ?? missingProvenanceCount;
      missingQualityCriteriaCount =
        asNum(data.missingQualityCriteriaCount) ??
        asNum(data.missingQualityCount) ??
        missingQualityCriteriaCount;
      coversAllEvalAndFinetuneDatasets =
        asBool(data.coversAllEvalAndFinetuneDatasets) ??
        asBool(data.coversAllDatasets) ??
        coversAllEvalAndFinetuneDatasets;
      promotionBlockedIfMissing =
        asBool(data.promotionBlockedIfMissing) ??
        asBool(data.blocksPromoteWithoutCard) ??
        asBool(data.promotionGateEnforced) ??
        promotionBlockedIfMissing;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const datasets = Array.isArray(data.datasets)
        ? (data.datasets as Array<Record<string, unknown>>)
        : [];
      if (datasets.length > 0) {
        datasetCount = datasets.length;
        let missProv = 0;
        let missQual = 0;
        for (const ds of datasets) {
          const provenance =
            typeof ds.provenance === "string"
              ? ds.provenance.trim()
              : ds.hasProvenance === true;
          const quality =
            typeof ds.qualityCriteria === "string"
              ? ds.qualityCriteria.trim()
              : ds.hasQualityCriteria === true;
          if (!provenance) missProv += 1;
          if (!quality) missQual += 1;
        }
        missingProvenanceCount = missProv;
        missingQualityCriteriaCount = missQual;
        if (coversAllEvalAndFinetuneDatasets == null) {
          coversAllEvalAndFinetuneDatasets = true;
        }
      }

      if (
        asBool(data.allHaveProvenanceAndQuality) === true &&
        missingProvenanceCount == null
      ) {
        missingProvenanceCount = 0;
        missingQualityCriteriaCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    datasetCount,
    missingProvenanceCount,
    missingQualityCriteriaCount,
    coversAllEvalAndFinetuneDatasets,
    promotionBlockedIfMissing,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildDatasetProvenanceGovernanceReport(opts: {
  assessedAt: string;
  signals: DatasetProvenanceGovernanceReport["signals"];
  datasetSignals: boolean;
  imported: DatasetProvenanceGovernanceReport["importedResults"];
}): DatasetProvenanceGovernanceReport {
  const notes: string[] = [];
  const cardSignalsPresent =
    opts.signals.datasetCards.found ||
    (opts.signals.provenance.found && opts.signals.quality.found);

  if (!opts.datasetSignals && !cardSignalsPresent && !opts.imported.found) {
    notes.push(
      "No eval/fine-tune dataset signals — DG-M2 may be NOT_APPLICABLE if there are no production eval gates or fine-tunes.",
    );
  }
  if (opts.signals.datasetCards.found) {
    notes.push(
      `Dataset-card refs: ${opts.signals.datasetCards.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.provenance.found) {
    notes.push(
      `Provenance refs: ${opts.signals.provenance.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.quality.found) {
    notes.push(
      `Quality-criteria refs: ${opts.signals.quality.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.promotionBlock.found) {
    notes.push(
      `Promotion-block refs: ${opts.signals.promotionBlock.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (datasets=${opts.imported.datasetCount}, missProv=${opts.imported.missingProvenanceCount}, missQual=${opts.imported.missingQualityCriteriaCount}, coversAll=${opts.imported.coversAllEvalAndFinetuneDatasets}, promoteBlock=${opts.imported.promotionBlockedIfMissing}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (cardSignalsPresent) {
    notes.push(
      "Card signals alone are PARTIAL — import inventory with 0 missing provenance/quality + promotionBlockedIfMissing ≤90d under imports/dataset-provenance-governance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const passOk =
    opts.imported.coversAllEvalAndFinetuneDatasets === true &&
    opts.imported.missingProvenanceCount === 0 &&
    opts.imported.missingQualityCriteriaCount === 0 &&
    opts.imported.promotionBlockedIfMissing === true &&
    ageOk &&
    importFresh;

  let statusHint: DatasetProvenanceGovernanceReport["summary"]["statusHint"];
  let dgM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllEvalAndFinetuneDatasets === false ||
      (opts.imported.missingProvenanceCount !== null &&
        opts.imported.missingProvenanceCount > 0) ||
      (opts.imported.missingQualityCriteriaCount !== null &&
        opts.imported.missingQualityCriteriaCount > 0) ||
      opts.imported.promotionBlockedIfMissing === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.datasetSignals &&
    !opts.signals.datasetCards.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgM2Satisfied = false;
    notes.push(
      "Imported inventory shows missing provenance/quality, uncovered datasets, no promotion block, or evidence older than 90 days — DG-M2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgM2Satisfied = true;
    if ((opts.imported.datasetCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllEvalAndFinetuneDatasets with zero datasets — confirm no production eval/fine-tune data surface.",
      );
    }
  } else if (
    opts.signals.datasetCards.found ||
    opts.signals.provenance.found ||
    opts.signals.quality.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgM2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllEvalAndFinetuneDatasets !== true) {
        notes.push(
          "Import must show coversAllEvalAndFinetuneDatasets=true.",
        );
      }
      if (
        opts.imported.missingProvenanceCount !== 0 ||
        opts.imported.missingQualityCriteriaCount !== 0
      ) {
        notes.push(
          "Import must show missingProvenanceCount and missingQualityCriteriaCount = 0.",
        );
      }
      if (opts.imported.promotionBlockedIfMissing !== true) {
        notes.push("Import must show promotionBlockedIfMissing=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DG-M2 PASS.",
        );
      }
    }
  } else if (opts.datasetSignals) {
    statusHint = "not_demonstrated";
    dgM2Satisfied = null;
    notes.push(
      "Eval/fine-tune signals present but no dataset cards with provenance/quality found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgM2Satisfied = null;
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
      datasetSignalsPresent: opts.datasetSignals,
      cardSignalsPresent,
      dgM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const datasetProvenanceGovernanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const datasetSignals = detectDatasetSignals(ctx.targetPath, maxFiles);

    const inDatasetContext = (path: string, text: string) =>
      DATASET_PATH_RE.test(path) ||
      DATASET_RE.test(path) ||
      DATASET_RE.test(text) ||
      DATASET_PATH_RE.test(text);

    const cardRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DATASET_RE.test(path) || DATASET_RE.test(text)) &&
        inDatasetContext(path, text),
    );
    const provenanceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROVENANCE_RE.test(path) || PROVENANCE_RE.test(text)) &&
        inDatasetContext(path, text),
      12,
    );
    const qualityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (QUALITY_RE.test(path) || QUALITY_RE.test(text)) &&
        inDatasetContext(path, text),
      12,
    );
    const promoteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMOTE_BLOCK_RE.test(path) || PROMOTE_BLOCK_RE.test(text)) &&
        inDatasetContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildDatasetProvenanceGovernanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        datasetCards: { found: cardRefs.length > 0, refs: cardRefs },
        provenance: {
          found: provenanceRefs.length > 0,
          refs: provenanceRefs,
        },
        quality: { found: qualityRefs.length > 0, refs: qualityRefs },
        promotionBlock: {
          found: promoteRefs.length > 0,
          refs: promoteRefs,
        },
      },
      datasetSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "dataset-provenance-governance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/dataset-provenance-governance-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "dataset-provenance-governance",
          "dg-m2",
          DETECTOR_ID,
          ...(report.summary.cardSignalsPresent ? ["dataset-card-signals"] : []),
          ...(report.summary.dgM2Satisfied ? ["dg-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...cardRefs.slice(0, 2),
        ...provenanceRefs.slice(0, 2),
        ...qualityRefs.slice(0, 2),
        ...promoteRefs.slice(0, 1),
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
        signals: ["dataset-provenance-governance-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-M2 status=${report.summary.statusHint} cards=${report.summary.cardSignalsPresent} satisfied=${report.summary.dgM2Satisfied}; report=imports/${PLUGIN_ID}/dataset-provenance-governance-report.json`,
      nodes,
    };
  },
};
