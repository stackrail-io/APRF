/**
 * dataset-cards-registry — DG-R3 / repo-dataset-cards detector executor.
 *
 * Discovers major eval/fine-tune dataset cards (purpose, source, PII, freshness).
 * Import inventory under imports/dataset-cards-registry/ to unlock PASS.
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

const PLUGIN_ID = "dataset-cards-registry";
const RELATED = ["DG-R3"] as const;
const DETECTOR_ID = "repo-dataset-cards";
/** Spec: card last-updated ≤12 months. */
const CARD_MAX_AGE_DAYS = 365;
/** Inventory attestation freshness. */
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DATASET_PATH_RE =
  /(dataset|datasheet|data[\s_-]*card|eval[\s_-]*set|finetune|fine[\s_-]*tune|huggingface)/i;

const CARD_RE =
  /\b(dataset[\s_-]*card|datasheet|data[\s_-]*card|card[\s_-]*yaml|README\.dataset)\b/i;

const PURPOSE_RE =
  /\b(purpose|intended[\s_-]*use|use[\s_-]*case|evaluation[\s_-]*goal)\b/i;

const SOURCE_RE =
  /\b(source|origin|collected[\s_-]*from|derived[\s_-]*from|data[\s_-]*source)\b/i;

const PII_RE =
  /\b(pii|personally[\s_-]*identifiable|privacy[\s_-]*handling|sensitive[\s_-]*data|redact(?:ion|ed)?)\b/i;

const UPDATED_RE =
  /\b(last[\s_-]*updated|updated[\s_-]*at|card[\s_-]*version[\s_-]*date|reviewed[\s_-]*at)\b/i;

export interface DatasetCardsRegistryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    cards: { found: boolean; refs: string[] };
    purpose: { found: boolean; refs: string[] };
    source: { found: boolean; refs: string[] };
    pii: { found: boolean; refs: string[] };
    lastUpdated: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    majorSetCount: number | null;
    coversAllMajorEvalFinetuneSets: boolean | null;
    missingPurposeCount: number | null;
    missingSourceCount: number | null;
    missingPiiHandlingCount: number | null;
    staleCardCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    datasetSignalsPresent: boolean;
    cardSignalsPresent: boolean;
    dgR3Satisfied: boolean | null;
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

function detectDatasetSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        DATASET_PATH_RE.test(path) ||
        CARD_RE.test(text) ||
        /\b(fine[\s_-]*tun|eval[\s_-]*set|dataset)\b/i.test(text),
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
): DatasetCardsRegistryReport["importedResults"] {
  const sources: string[] = [];
  let majorSetCount: number | null = null;
  let coversAllMajorEvalFinetuneSets: boolean | null = null;
  let missingPurposeCount: number | null = null;
  let missingSourceCount: number | null = null;
  let missingPiiHandlingCount: number | null = null;
  let staleCardCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/dataset-cards-registry-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      majorSetCount =
        asNum(data.majorSetCount) ??
        asNum(data.datasetCount) ??
        majorSetCount;
      coversAllMajorEvalFinetuneSets =
        asBool(data.coversAllMajorEvalFinetuneSets) ??
        asBool(data.coversAllMajorSets) ??
        coversAllMajorEvalFinetuneSets;
      missingPurposeCount =
        asNum(data.missingPurposeCount) ?? missingPurposeCount;
      missingSourceCount =
        asNum(data.missingSourceCount) ?? missingSourceCount;
      missingPiiHandlingCount =
        asNum(data.missingPiiHandlingCount) ??
        asNum(data.missingPiiCount) ??
        missingPiiHandlingCount;
      staleCardCount =
        asNum(data.staleCardCount) ??
        asNum(data.cardsOlderThan12MonthsCount) ??
        staleCardCount;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const cards = Array.isArray(data.cards)
        ? (data.cards as Array<Record<string, unknown>>)
        : Array.isArray(data.datasets)
          ? (data.datasets as Array<Record<string, unknown>>)
          : [];
      if (cards.length > 0) {
        majorSetCount = cards.length;
        let missPurpose = 0;
        let missSource = 0;
        let missPii = 0;
        let stale = 0;
        for (const c of cards) {
          const purpose =
            typeof c.purpose === "string"
              ? c.purpose.trim()
              : c.hasPurpose === true;
          const source =
            typeof c.source === "string"
              ? c.source.trim()
              : c.hasSource === true;
          const pii =
            typeof c.piiHandling === "string"
              ? c.piiHandling.trim()
              : c.hasPiiHandling === true;
          if (!purpose) missPurpose += 1;
          if (!source) missSource += 1;
          if (!pii) missPii += 1;
          const updatedWithin12Months =
            asBool(c.updatedWithin12Months) ??
            asBool(c.lastUpdatedWithin12Months);
          const lastUpdated = parseMeasuredAt({
            measuredAt: c.lastUpdated ?? c.updatedAt ?? c.last_updated,
          } as Record<string, unknown>);
          const freshCard =
            updatedWithin12Months === true ||
            (updatedWithin12Months == null &&
              !!lastUpdated &&
              measuredAtFresh(lastUpdated, new Date(), CARD_MAX_AGE_DAYS));
          // Unknown last-updated is stale — do not vacuous-pass undated cards.
          if (updatedWithin12Months === false || c.stale === true || !freshCard) {
            stale += 1;
          }
        }
        missingPurposeCount = missPurpose;
        missingSourceCount = missSource;
        missingPiiHandlingCount = missPii;
        staleCardCount = stale;
        if (coversAllMajorEvalFinetuneSets == null) {
          coversAllMajorEvalFinetuneSets = true;
        }
      }

      if (
        asBool(data.allCardsCompleteAndFresh) === true &&
        missingPurposeCount == null
      ) {
        missingPurposeCount = 0;
        missingSourceCount = 0;
        missingPiiHandlingCount = 0;
        staleCardCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    majorSetCount,
    coversAllMajorEvalFinetuneSets,
    missingPurposeCount,
    missingSourceCount,
    missingPiiHandlingCount,
    staleCardCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildDatasetCardsRegistryReport(opts: {
  assessedAt: string;
  signals: DatasetCardsRegistryReport["signals"];
  datasetSignals: boolean;
  imported: DatasetCardsRegistryReport["importedResults"];
}): DatasetCardsRegistryReport {
  const notes: string[] = [];
  const cardSignalsPresent =
    opts.signals.cards.found ||
    (opts.signals.purpose.found &&
      opts.signals.source.found &&
      opts.signals.pii.found);

  if (!opts.datasetSignals && !cardSignalsPresent && !opts.imported.found) {
    notes.push(
      "No eval/fine-tune dataset-card signals — DG-R3 may be NOT_APPLICABLE if there are no major sets in production promotion.",
    );
  }
  if (opts.signals.cards.found) {
    notes.push(
      `Card refs: ${opts.signals.cards.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.purpose.found) {
    notes.push(
      `Purpose refs: ${opts.signals.purpose.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.source.found) {
    notes.push(
      `Source refs: ${opts.signals.source.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.pii.found) {
    notes.push(`PII refs: ${opts.signals.pii.refs.slice(0, 2).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (sets=${opts.imported.majorSetCount}, coversAll=${opts.imported.coversAllMajorEvalFinetuneSets}, missPurpose=${opts.imported.missingPurposeCount}, missSource=${opts.imported.missingSourceCount}, missPii=${opts.imported.missingPiiHandlingCount}, stale=${opts.imported.staleCardCount}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (cardSignalsPresent) {
    notes.push(
      "Card signals alone are PARTIAL — import complete major-set inventory (purpose/source/PII + ≤12mo) under imports/dataset-cards-registry/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= INVENTORY_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    INVENTORY_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.coversAllMajorEvalFinetuneSets === true &&
    opts.imported.missingPurposeCount === 0 &&
    opts.imported.missingSourceCount === 0 &&
    opts.imported.missingPiiHandlingCount === 0 &&
    opts.imported.staleCardCount === 0 &&
    ageOk &&
    importFresh;

  let statusHint: DatasetCardsRegistryReport["summary"]["statusHint"] =
    "not_demonstrated";
  let dgR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllMajorEvalFinetuneSets === false ||
      (opts.imported.missingPurposeCount !== null &&
        opts.imported.missingPurposeCount > 0) ||
      (opts.imported.missingSourceCount !== null &&
        opts.imported.missingSourceCount > 0) ||
      (opts.imported.missingPiiHandlingCount !== null &&
        opts.imported.missingPiiHandlingCount > 0) ||
      (opts.imported.staleCardCount !== null &&
        opts.imported.staleCardCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.datasetSignals &&
    !opts.signals.cards.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgR3Satisfied = false;
    notes.push(
      "Imported inventory shows missing fields, stale cards (>12 months), uncovered sets, or inventory older than 90 days — DG-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgR3Satisfied = true;
    if ((opts.imported.majorSetCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllMajorEvalFinetuneSets with zero sets — confirm no major eval/fine-tune surface.",
      );
    }
  } else if (
    opts.signals.cards.found ||
    opts.signals.purpose.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgR3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllMajorEvalFinetuneSets !== true) {
        notes.push(
          "Import must show coversAllMajorEvalFinetuneSets=true.",
        );
      }
      if (
        opts.imported.missingPurposeCount !== 0 ||
        opts.imported.missingSourceCount !== 0 ||
        opts.imported.missingPiiHandlingCount !== 0
      ) {
        notes.push(
          "Import must show missingPurposeCount, missingSourceCount, and missingPiiHandlingCount = 0.",
        );
      }
      if (opts.imported.staleCardCount !== 0) {
        notes.push("Import must show staleCardCount=0 (cards ≤12 months).");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DG-R3 PASS.",
        );
      }
    }
  } else if (opts.datasetSignals) {
    statusHint = "not_demonstrated";
    dgR3Satisfied = null;
    notes.push(
      "Eval/fine-tune signals present but no dataset cards with purpose/source/PII found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgR3Satisfied = null;
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
      dgR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const datasetCardsRegistryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const datasetSignals = detectDatasetSignals(ctx.targetPath, maxFiles);

    const inCardContext = (path: string, text: string) =>
      DATASET_PATH_RE.test(path) ||
      CARD_RE.test(path) ||
      CARD_RE.test(text) ||
      DATASET_PATH_RE.test(text);

    const cardRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CARD_RE.test(path) || CARD_RE.test(text)) &&
        inCardContext(path, text),
    );
    const purposeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PURPOSE_RE.test(path) || PURPOSE_RE.test(text)) &&
        inCardContext(path, text),
      12,
    );
    const sourceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SOURCE_RE.test(path) || SOURCE_RE.test(text)) &&
        inCardContext(path, text),
      12,
    );
    const piiRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PII_RE.test(path) || PII_RE.test(text)) &&
        inCardContext(path, text),
      12,
    );
    const updatedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (UPDATED_RE.test(path) || UPDATED_RE.test(text)) &&
        inCardContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildDatasetCardsRegistryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        cards: { found: cardRefs.length > 0, refs: cardRefs },
        purpose: { found: purposeRefs.length > 0, refs: purposeRefs },
        source: { found: sourceRefs.length > 0, refs: sourceRefs },
        pii: { found: piiRefs.length > 0, refs: piiRefs },
        lastUpdated: {
          found: updatedRefs.length > 0,
          refs: updatedRefs,
        },
      },
      datasetSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "dataset-cards-registry-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/dataset-cards-registry-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "dataset-cards-registry",
          "dg-r3",
          DETECTOR_ID,
          ...(report.summary.cardSignalsPresent ? ["dataset-card-signals"] : []),
          ...(report.summary.dgR3Satisfied ? ["dg-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...cardRefs.slice(0, 2),
        ...purposeRefs.slice(0, 1),
        ...sourceRefs.slice(0, 1),
        ...piiRefs.slice(0, 1),
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
        signals: ["dataset-cards-registry-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-R3 status=${report.summary.statusHint} cards=${report.summary.cardSignalsPresent} satisfied=${report.summary.dgR3Satisfied}; report=imports/${PLUGIN_ID}/dataset-cards-registry-report.json`,
      nodes,
    };
  },
};
