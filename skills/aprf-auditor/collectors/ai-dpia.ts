/**
 * ai-dpia — PRI-R3 / repo-ai-dpia detector executor.
 *
 * Discovers DPIA/PIA (or equivalent) coverage for major AI features before
 * production. Import inventory under imports/ai-dpia/ to unlock PASS.
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

const PLUGIN_ID = "ai-dpia";
const RELATED = ["PRI-R3"] as const;
const DETECTOR_ID = "repo-ai-dpia";
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE = /(dpia|pia|privacy[\s_-]*impact|privacy[\s_-]*assess)/i;

const SIGN_OFF_RE =
  /\b(sign[\s_-]*off|signed[\s_-]*by|owner[\s_-]*approval|approved[\s_-]*by|privacy[\s_-]*owner)\b/i;

const FEATURE_RE =
  /\b(ai[\s_-]*feature|major[\s_-]*feature|feature[\s_-]*inventory|in[\s_-]*scope[\s_-]*feature)\b/i;

export interface AiDpiaReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    assessments: { found: boolean; refs: string[] };
    signOff: { found: boolean; refs: string[] };
    featureInventory: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    coversAllMajorAiFeatures: boolean | null;
    missingAssessmentCount: number | null;
    missingSignOffCount: number | null;
    postProductionSignOffCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    dpiaSignalsPresent: boolean;
    assessmentSignalsPresent: boolean;
    priR3Satisfied: boolean | null;
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

function detectDpiaSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PATH_RE.test(path) ||
        PATH_RE.test(text) ||
        /\b(privacy[\s_-]*impact|data[\s_-]*protection[\s_-]*impact)\b/i.test(
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
): AiDpiaReport["importedResults"] {
  const sources: string[] = [];
  let coversAllMajorAiFeatures: boolean | null = null;
  let missingAssessmentCount: number | null = null;
  let missingSignOffCount: number | null = null;
  let postProductionSignOffCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-dpia-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      coversAllMajorAiFeatures =
        asBool(data.coversAllMajorAiFeatures) ??
        asBool(data.coversAllMajorFeatures) ??
        coversAllMajorAiFeatures;
      missingAssessmentCount =
        asNum(data.missingAssessmentCount) ??
        asNum(data.missingDpiaCount) ??
        missingAssessmentCount;
      missingSignOffCount =
        asNum(data.missingSignOffCount) ?? missingSignOffCount;
      postProductionSignOffCount =
        asNum(data.postProductionSignOffCount) ??
        asNum(data.signedAfterProductionCount) ??
        postProductionSignOffCount;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const features = Array.isArray(data.features)
        ? (data.features as Array<Record<string, unknown>>)
        : Array.isArray(data.assessments)
          ? (data.assessments as Array<Record<string, unknown>>)
          : [];
      if (features.length > 0) {
        let missAssess = 0;
        let missSign = 0;
        let postProd = 0;
        for (const feat of features) {
          const completed =
            asBool(feat.assessmentCompleted) ??
            asBool(feat.dpiaCompleted) ??
            asBool(feat.completed);
          const signed =
            asBool(feat.ownerSignOff) ??
            asBool(feat.signedOff) ??
            (typeof feat.signedBy === "string" && !!feat.signedBy.trim());
          const beforeProd =
            asBool(feat.signedBeforeProduction) ??
            asBool(feat.beforeProductionTraffic);
          if (completed === false || completed == null && !signed) {
            // if neither completed nor signed evidence, count missing assessment
            if (completed !== true) missAssess += 1;
          }
          if (signed !== true) missSign += 1;
          if (signed === true && beforeProd === false) postProd += 1;
          if (
            signed === true &&
            beforeProd == null &&
            feat.stale === true
          ) {
            postProd += 1;
          }
        }
        missingAssessmentCount = missAssess;
        missingSignOffCount = missSign;
        postProductionSignOffCount = postProd;
        if (coversAllMajorAiFeatures == null) {
          coversAllMajorAiFeatures = true;
        }
      }

      if (
        asBool(data.allMajorFeaturesHaveSignedDpia) === true &&
        missingAssessmentCount == null
      ) {
        missingAssessmentCount = 0;
        missingSignOffCount = 0;
        postProductionSignOffCount = 0;
        coversAllMajorAiFeatures = coversAllMajorAiFeatures ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    coversAllMajorAiFeatures,
    missingAssessmentCount,
    missingSignOffCount,
    postProductionSignOffCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDpiaReport(opts: {
  assessedAt: string;
  signals: AiDpiaReport["signals"];
  dpiaSignals: boolean;
  imported: AiDpiaReport["importedResults"];
}): AiDpiaReport {
  const notes: string[] = [];
  const assessmentSignalsPresent =
    opts.signals.assessments.found ||
    (opts.signals.signOff.found && opts.signals.featureInventory.found);

  if (!opts.dpiaSignals && !assessmentSignalsPresent && !opts.imported.found) {
    notes.push(
      "No DPIA/PIA signals — PRI-R3 may be NOT_APPLICABLE if there are no major in-scope AI features.",
    );
  }
  if (opts.signals.assessments.found) {
    notes.push(
      `Assessment refs: ${opts.signals.assessments.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (coversAll=${opts.imported.coversAllMajorAiFeatures}, missAssess=${opts.imported.missingAssessmentCount}, missSign=${opts.imported.missingSignOffCount}, postProd=${opts.imported.postProductionSignOffCount}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (assessmentSignalsPresent) {
    notes.push(
      "DPIA signals alone are PARTIAL — import major-feature inventory with completed signed assessments under imports/ai-dpia/ to PASS.",
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
    opts.imported.coversAllMajorAiFeatures === true &&
    opts.imported.missingAssessmentCount === 0 &&
    opts.imported.missingSignOffCount === 0 &&
    opts.imported.postProductionSignOffCount === 0 &&
    ageOk &&
    importFresh;

  let statusHint: AiDpiaReport["summary"]["statusHint"];
  let priR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllMajorAiFeatures === false ||
      (opts.imported.missingAssessmentCount !== null &&
        opts.imported.missingAssessmentCount > 0) ||
      (opts.imported.missingSignOffCount !== null &&
        opts.imported.missingSignOffCount > 0) ||
      (opts.imported.postProductionSignOffCount !== null &&
        opts.imported.postProductionSignOffCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.dpiaSignals &&
    !opts.signals.assessments.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priR3Satisfied = false;
    notes.push(
      "Imported inventory shows missing/unsigned DPIAs, post-production sign-off, uncovered features, or evidence older than 90 days — PRI-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priR3Satisfied = true;
  } else if (
    opts.signals.assessments.found ||
    opts.signals.signOff.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priR3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllMajorAiFeatures !== true) {
        notes.push("Import must show coversAllMajorAiFeatures=true.");
      }
      if (opts.imported.missingAssessmentCount !== 0) {
        notes.push("Import must show missingAssessmentCount=0.");
      }
      if (opts.imported.missingSignOffCount !== 0) {
        notes.push("Import must show missingSignOffCount=0.");
      }
      if (opts.imported.postProductionSignOffCount !== 0) {
        notes.push("Import must show postProductionSignOffCount=0.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-R3 PASS.",
        );
      }
    }
  } else if (opts.dpiaSignals) {
    statusHint = "not_demonstrated";
    priR3Satisfied = null;
    notes.push(
      "Privacy-assessment signals present but no completed signed DPIA/PIA coverage found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priR3Satisfied = null;
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
      dpiaSignalsPresent: opts.dpiaSignals,
      assessmentSignalsPresent,
      priR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDpiaCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const dpiaSignals = detectDpiaSignals(ctx.targetPath, maxFiles);

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) || PATH_RE.test(text) || FEATURE_RE.test(text);

    const assessmentRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PATH_RE.test(path) || PATH_RE.test(text)) && inCtx(path, text),
    );
    const signOffRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SIGN_OFF_RE.test(path) || SIGN_OFF_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const featureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FEATURE_RE.test(path) || FEATURE_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiDpiaReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        assessments: {
          found: assessmentRefs.length > 0,
          refs: assessmentRefs,
        },
        signOff: { found: signOffRefs.length > 0, refs: signOffRefs },
        featureInventory: {
          found: featureRefs.length > 0,
          refs: featureRefs,
        },
      },
      dpiaSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-dpia-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-dpia-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-dpia",
          "pri-m4",
          DETECTOR_ID,
          ...(report.summary.assessmentSignalsPresent
            ? ["dpia-assessment-signals"]
            : []),
          ...(report.summary.priR3Satisfied ? ["pri-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...assessmentRefs.slice(0, 2),
        ...signOffRefs.slice(0, 1),
        ...featureRefs.slice(0, 1),
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
        signals: ["ai-dpia-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-R3 status=${report.summary.statusHint} assessments=${report.summary.assessmentSignalsPresent} satisfied=${report.summary.priR3Satisfied}; report=imports/${PLUGIN_ID}/ai-dpia-report.json`,
      nodes,
    };
  },
};
