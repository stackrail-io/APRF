/**
 * model-promotion-eval — MOD-M2 / repo-model-promotion-eval.
 *
 * Discovers eval-required gates on model promotions/version bumps.
 * Import promotionsMissingEvalArtifact=0 + promoteWithoutEvalBlocked under
 * imports/model-promotion-eval/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "model-promotion-eval";
const RELATED = ["MOD-M2"] as const;
const DETECTOR_ID = "repo-model-promotion-eval";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MODEL_PATH_RE =
  /(model|llm|openai|anthropic|bedrock|vertex|provider|inference|registry)/i;

const PROMOTION_RE =
  /\b(model[\s_-]*promot\w*|model[\s_-]*(version[\s_-]*bump|pin[\s_-]*change|cutover|deploy)|promot(?:e|ion)[\s_-]*model|registry[\s_-]*promot\w*)\b/i;

const EVAL_ARTIFACT_RE =
  /\b(eval[\s_-]*(pass|artifact|report|evidence|gate)\w*|require[sd]?[\s_-]*eval\w*|linked[\s_-]*eval\w*|eval[\s_-]*before[\s_-]*promot\w*)\b/i;

const BLOCK_RE =
  /\b(block[\s_-]*(promot|deploy|release|merge)\w*|fail[\s_-]*(closed|the[\s_-]*build)|required[\s_-]*check\w*|promote[\s_-]*without[\s_-]*eval\w*)\b/i;

export interface ModelPromotionEvalReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    promotion: { found: boolean; refs: string[] };
    evalArtifact: { found: boolean; refs: string[] };
    blockGate: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    promotionsMissingEvalArtifact: number | null;
    promoteWithoutEvalBlocked: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    promotionSignalsPresent: boolean;
    modM2Satisfied: boolean | null;
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
): ModelPromotionEvalReport["importedResults"] {
  const sources: string[] = [];
  let promotionsMissingEvalArtifact: number | null = null;
  let promoteWithoutEvalBlocked: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-promotion-eval-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      promotionsMissingEvalArtifact =
        asNum(data.promotionsMissingEvalArtifact) ??
        asNum(data.promotions_missing_eval_artifact) ??
        promotionsMissingEvalArtifact;
      promoteWithoutEvalBlocked =
        asBool(data.promoteWithoutEvalBlocked) ??
        asBool(data.promote_without_eval_blocked) ??
        asBool(data.blockingGate) ??
        promoteWithoutEvalBlocked;

      if (asBool(data.allPromotionsHaveEvalArtifact) === true) {
        promotionsMissingEvalArtifact = promotionsMissingEvalArtifact ?? 0;
      }
      // evalRequiredOnPromotion is affirmative blocking evidence — set true
      // even if blockingGate/promoteWithoutEvalBlocked was earlier false.
      if (asBool(data.evalRequiredOnPromotion) === true) {
        promoteWithoutEvalBlocked = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    promotionsMissingEvalArtifact,
    promoteWithoutEvalBlocked,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelPromotionEvalReport(opts: {
  assessedAt: string;
  promotion: { found: boolean; refs: string[] };
  evalArtifact: { found: boolean; refs: string[] };
  blockGate: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelPromotionEvalReport["importedResults"];
}): ModelPromotionEvalReport {
  const notes: string[] = [];
  const promotionSignalsPresent =
    opts.promotion.found || opts.evalArtifact.found || opts.blockGate.found;

  if (!opts.modelSignals && !promotionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No model/promotion signals — MOD-M2 may be NOT_APPLICABLE if there are no production model promotions.",
    );
  }
  if (opts.promotion.found) {
    notes.push(`Promotion refs: ${opts.promotion.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.evalArtifact.found) {
    notes.push(
      `Eval-artifact refs: ${opts.evalArtifact.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.blockGate.found) {
    notes.push(`Block-gate refs: ${opts.blockGate.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No promote-without-eval block signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingEval=${opts.imported.promotionsMissingEvalArtifact}, blocked=${opts.imported.promoteWithoutEvalBlocked})`,
    );
  } else if (promotionSignalsPresent) {
    notes.push(
      "Promotion signals alone are PARTIAL — import promotionsMissingEvalArtifact=0 + promoteWithoutEvalBlocked=true (measuredAt ≤90d) under imports/model-promotion-eval/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.promotionsMissingEvalArtifact !== null &&
    opts.imported.promotionsMissingEvalArtifact === 0;
  const blockOk = opts.imported.promoteWithoutEvalBlocked === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelPromotionEvalReport["summary"]["statusHint"] =
    "not_demonstrated";
  let modM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.promotionsMissingEvalArtifact !== null &&
      opts.imported.promotionsMissingEvalArtifact > 0) ||
      opts.imported.promoteWithoutEvalBlocked === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.modelSignals && !promotionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    modM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modM2Satisfied = false;
    notes.push(
      "Imported evidence shows promotions missing eval artifacts, non-blocking gate, or evidence older than 90 days — MOD-M2 fail.",
    );
  } else if (
    (promotionSignalsPresent || opts.imported.found) &&
    coverageOk &&
    blockOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modM2Satisfied = true;
  } else if (promotionSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modM2Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show promotionsMissingEvalArtifact=0.");
    }
    if (opts.imported.found && !blockOk) {
      notes.push("Import must show promoteWithoutEvalBlocked=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-M2 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modM2Satisfied = null;
    notes.push(
      "Model signals present but no promotion-eval / blocking-gate evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      promotion: opts.promotion,
      evalArtifact: opts.evalArtifact,
      blockGate: opts.blockGate,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      promotionSignalsPresent,
      modM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelPromotionEvalCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const promotionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROMOTION_RE.test(path) || PROMOTION_RE.test(text),
      12,
    );
    const evalArtifactRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        EVAL_ARTIFACT_RE.test(path) || EVAL_ARTIFACT_RE.test(text),
      12,
    );
    const blockGateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMOTION_RE.test(path) || PROMOTION_RE.test(text) || BLOCK_RE.test(path)) &&
        (BLOCK_RE.test(text) || BLOCK_RE.test(path)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelPromotionEvalReport({
      assessedAt: ctx.assessedAt.toISOString(),
      promotion: { found: promotionRefs.length > 0, refs: promotionRefs },
      evalArtifact: {
        found: evalArtifactRefs.length > 0,
        refs: evalArtifactRefs,
      },
      blockGate: { found: blockGateRefs.length > 0, refs: blockGateRefs },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-promotion-eval-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-promotion-eval-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-promotion-eval",
          "mod-m2",
          DETECTOR_ID,
          ...(report.summary.modM2Satisfied ? ["mod-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.promotion.refs,
        ...report.signals.evalArtifact.refs,
        ...report.signals.blockGate.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-promotion-eval-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-M2 status=${report.summary.statusHint} promotion=${report.summary.promotionSignalsPresent} satisfied=${report.summary.modM2Satisfied}; report=imports/${PLUGIN_ID}/model-promotion-eval-report.json`,
      nodes,
    };
  },
};
