/**
 * ai-artifact-promotion-path — DEP-M1 / repo-ai-artifact-promotion-path.
 *
 * Discovers non-prod→prod promotion paths for prompts/models/tools.
 * Import promotionPathDocumented + releasesThroughPromotionPathPct=100
 * (or productionReleasesMissingPromotionPath=0) +
 * productionHotEditsWithoutChangeRecord=0 under
 * imports/ai-artifact-promotion-path/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-artifact-promotion-path";
const RELATED = ["DEP-M1"] as const;
const DETECTOR_ID = "repo-ai-artifact-promotion-path";
const IMPORT_MAX_AGE_DAYS = 90;

const AI_ARTIFACT_RE =
  /(prompt|prompts|model[\s_-]*pin|model[\s_-]*version|tool[\s_-]*catalog|llm|openai|anthropic|bedrock|vertex)/i;

const PROMOTION_RE =
  /\b(promot(?:e|ion)|non[\s_-]*prod[\s_-]*to[\s_-]*prod|staging[\s_-]*to[\s_-]*prod|promote[\s_-]*to[\s_-]*prod|release[\s_-]*pipeline|cd[\s_-]*pipeline)\b/i;

const HOT_EDIT_RE =
  /\b(hot[\s_-]*edit|prod[\s_-]*edit|production[\s_-]*edit|manual[\s_-]*prod[\s_-]*change|break[\s_-]*glass)\b/i;

const CHANGE_RECORD_RE =
  /\b(change[\s_-]*record|change[\s_-]*ticket|linked[\s_-]*change|change[\s_-]*request|cr[\s_-]*id)\b/i;

export interface AiArtifactPromotionPathReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    promotion: { found: boolean; refs: string[] };
    hotEditPolicy: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    promotionPathDocumented: boolean | null;
    releasesThroughPromotionPathPct: number | null;
    productionReleasesMissingPromotionPath: number | null;
    productionHotEditsWithoutChangeRecord: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiArtifactSignalsPresent: boolean;
    promotionSignalsPresent: boolean;
    depM1Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
  /** Customer-facing asks for REPORT.html Evidence still required. */
  gapNotes: string[];
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
      ".sh",
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

function detectAiArtifactSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) => AI_ARTIFACT_RE.test(path) || AI_ARTIFACT_RE.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AiArtifactPromotionPathReport["importedResults"] {
  const sources: string[] = [];
  let promotionPathDocumented: boolean | null = null;
  let releasesThroughPromotionPathPct: number | null = null;
  let productionReleasesMissingPromotionPath: number | null = null;
  let productionHotEditsWithoutChangeRecord: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-artifact-promotion-path-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      promotionPathDocumented =
        asBool(data.promotionPathDocumented) ??
        asBool(data.promotion_path_documented) ??
        asBool(data.pathDocumented) ??
        promotionPathDocumented;
      releasesThroughPromotionPathPct =
        asNum(data.releasesThroughPromotionPathPct) ??
        asNum(data.releases_through_promotion_path_pct) ??
        asNum(data.throughPathPct) ??
        releasesThroughPromotionPathPct;
      productionReleasesMissingPromotionPath =
        asNum(data.productionReleasesMissingPromotionPath) ??
        asNum(data.production_releases_missing_promotion_path) ??
        asNum(data.missingPromotionPathCount) ??
        productionReleasesMissingPromotionPath;
      productionHotEditsWithoutChangeRecord =
        asNum(data.productionHotEditsWithoutChangeRecord) ??
        asNum(data.production_hot_edits_without_change_record) ??
        asNum(data.hotEditsWithoutChangeRecord) ??
        productionHotEditsWithoutChangeRecord;

      // Affirmative aliases.
      if (asBool(data.allReleasesThroughPromotionPath) === true) {
        releasesThroughPromotionPathPct =
          releasesThroughPromotionPathPct ?? 100;
        productionReleasesMissingPromotionPath =
          productionReleasesMissingPromotionPath ?? 0;
      }
      if (asBool(data.zeroHotEditsWithoutChangeRecord) === true) {
        productionHotEditsWithoutChangeRecord =
          productionHotEditsWithoutChangeRecord ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    promotionPathDocumented,
    releasesThroughPromotionPathPct,
    productionReleasesMissingPromotionPath,
    productionHotEditsWithoutChangeRecord,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiArtifactPromotionPathReport(opts: {
  assessedAt: string;
  promotion: { found: boolean; refs: string[] };
  hotEditPolicy: { found: boolean; refs: string[] };
  aiArtifactSignals: boolean;
  imported: AiArtifactPromotionPathReport["importedResults"];
}): AiArtifactPromotionPathReport {
  const notes: string[] = [];
  const promotionSignalsPresent =
    opts.promotion.found || opts.hotEditPolicy.found;

  if (!opts.aiArtifactSignals && !promotionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/model/tool release surface found — DEP-M1 is NOT_APPLICABLE when nothing ships to production.",
    );
  }
  if (opts.promotion.found) {
    notes.push(`Promotion refs: ${opts.promotion.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.hotEditPolicy.found) {
    notes.push(
      `Hot-edit policy refs: ${opts.hotEditPolicy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported coverage from ${opts.imported.sources.join(", ")} (measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (promotionSignalsPresent) {
    notes.push(
      "Repo mentions a promotion path, but measured release coverage is not imported yet — status remains PARTIAL.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const pathOk =
    opts.imported.promotionPathDocumented === true || opts.promotion.found;
  const coverageOk =
    opts.imported.releasesThroughPromotionPathPct === 100 ||
    opts.imported.productionReleasesMissingPromotionPath === 0;
  const hotEditOk = opts.imported.productionHotEditsWithoutChangeRecord === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiArtifactPromotionPathReport["summary"]["statusHint"];
  let depM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.promotionPathDocumented === false ||
      (typeof opts.imported.releasesThroughPromotionPathPct === "number" &&
        opts.imported.releasesThroughPromotionPathPct < 100) ||
      (typeof opts.imported.productionReleasesMissingPromotionPath ===
        "number" &&
        opts.imported.productionReleasesMissingPromotionPath > 0) ||
      (typeof opts.imported.productionHotEditsWithoutChangeRecord ===
        "number" &&
        opts.imported.productionHotEditsWithoutChangeRecord > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.aiArtifactSignals && !promotionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    depM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depM1Satisfied = false;
    notes.push(
      "Imported coverage shows gaps in the promotion path, incomplete release coverage, undocumented prod hot-edits, or evidence older than 90 days.",
    );
  } else if (
    (promotionSignalsPresent || opts.imported.found) &&
    pathOk &&
    coverageOk &&
    hotEditOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depM1Satisfied = true;
  } else if (promotionSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depM1Satisfied = false;
  } else if (opts.aiArtifactSignals) {
    statusHint = "not_demonstrated";
    depM1Satisfied = null;
    notes.push(
      "Prompts/models/tools appear in the repo, but no non-prod→prod promotion path evidence was found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depM1Satisfied = null;
  }

  const gapNotes: string[] = [];
  if (statusHint !== "pass" && statusHint !== "not_applicable") {
    if (!opts.imported.found && promotionSignalsPresent) {
      gapNotes.push(
        "Document the non-prod→prod promotion path for prompts, models, and tools, then provide ≤90-day evidence that 100% of production releases used it and that 0 production hot-edits lacked a change record (place measured coverage under imports/ai-artifact-promotion-path/)",
      );
    }
    if (opts.imported.found && !pathOk) {
      gapNotes.push(
        "Document a non-prod→prod promotion path for prompts, models, and tools (or keep clear promotion workflow evidence in the repo)",
      );
    }
    if (opts.imported.found && !coverageOk) {
      gapNotes.push(
        "Show that 100% of recent production releases for prompts/models/tools went through the promotion path (0 releases that skipped it)",
      );
    }
    if (opts.imported.found && !hotEditOk) {
      gapNotes.push(
        "Show 0 production hot-edits of prompts/models/tools without a linked change record",
      );
    }
    if (opts.imported.found && !importFresh) {
      gapNotes.push(
        "Refresh promotion-path coverage evidence (measured within the last 90 days)",
      );
    }
    if (statusHint === "not_demonstrated") {
      gapNotes.push(
        "Define a promotion path from non-prod to prod for prompts, models, and tools, and import ≤90-day release coverage under imports/ai-artifact-promotion-path/",
      );
    }
    if (explicitFail && gapNotes.length === 0) {
      gapNotes.push(
        "Fix promotion-path gaps in the imported coverage: path documented, 100% of prod releases through the path, and 0 undocumented prod hot-edits (measuredAt ≤90 days)",
      );
    }
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      promotion: opts.promotion,
      hotEditPolicy: opts.hotEditPolicy,
    },
    importedResults: opts.imported,
    summary: {
      aiArtifactSignalsPresent: opts.aiArtifactSignals,
      promotionSignalsPresent,
      depM1Satisfied,
      statusHint,
    },
    notes,
    gapNotes: gapNotes.slice(0, 8),
  };
}

export const aiArtifactPromotionPathCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiArtifactSignals = detectAiArtifactSignals(ctx.targetPath, maxFiles);

    const promotionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AI_ARTIFACT_RE.test(path) || AI_ARTIFACT_RE.test(text)) &&
        PROMOTION_RE.test(text),
      12,
    );
    // Also catch promotion workflow files by path.
    const pathPromotionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /promot|deploy|release/i.test(path) &&
        (AI_ARTIFACT_RE.test(path) || AI_ARTIFACT_RE.test(text) || PROMOTION_RE.test(text)),
      8,
    );
    const allPromotion = [...new Set([...promotionRefs, ...pathPromotionRefs])];

    const hotEditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        HOT_EDIT_RE.test(path) ||
        HOT_EDIT_RE.test(text) ||
        (CHANGE_RECORD_RE.test(text) && /prod(uction)?/i.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiArtifactPromotionPathReport({
      assessedAt: ctx.assessedAt.toISOString(),
      promotion: { found: allPromotion.length > 0, refs: allPromotion },
      hotEditPolicy: { found: hotEditRefs.length > 0, refs: hotEditRefs },
      aiArtifactSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-artifact-promotion-path-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-artifact-promotion-path-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-artifact-promotion-path",
          "dep-m1",
          DETECTOR_ID,
          ...(report.summary.depM1Satisfied ? ["dep-m1-satisfied"] : []),
        ],
        excerpt: redact(
          report.signals.promotion.refs.length
            ? `DEP-M1 ${report.summary.statusHint}: promotion path refs — ${report.signals.promotion.refs.slice(0, 4).join("; ")}`
            : `DEP-M1 ${report.summary.statusHint}: ${report.gapNotes[0] ?? report.notes[0] ?? "no promotion-path evidence yet"}`,
        ),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.promotion.refs,
        ...report.signals.hotEditPolicy.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-artifact-promotion-path-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-M1 status=${report.summary.statusHint} promotion=${report.summary.promotionSignalsPresent} satisfied=${report.summary.depM1Satisfied}; report=imports/${PLUGIN_ID}/ai-artifact-promotion-path-report.json`,
      nodes,
    };
  },
};
