/**
 * prompt-change-review-eval — PRM-M2 / repo-prompt-change-review-eval.
 *
 * Discovers prompt-release review + eval linkage and blocking gates.
 * Import releasesMissingReviewOrEval=0 + promoteWithoutReviewAndEvalBlocked
 * under imports/prompt-change-review-eval/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "prompt-change-review-eval";
const RELATED = ["PRM-M2"] as const;
const DETECTOR_ID = "repo-prompt-change-review-eval";
const IMPORT_MAX_AGE_DAYS = 90;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const REVIEW_RE =
  /\b(prompt[\s_-]*review\w*|review[\s_-]*id\w*|code[\s_-]*review\w*|change[\s_-]*review\w*|approved[\s_-]*by)\b/i;

const EVAL_LINK_RE =
  /\b(eval[\s_-]*(pass|artifact|evidence|gate)|linked[\s_-]*eval|prompt[\s_-]*eval|eval[\s_-]*before[\s_-]*(release|promot)\w*)\b/i;

const RELEASE_RE =
  /\b(prompt[\s_-]*(release|promot|deploy|ship)\w*|release[\s_-]*prompt\w*|promot(?:e|ion)[\s_-]*prompt\w*)\b/i;

const BLOCK_RE =
  /\b(block[\s_-]*(promot|release|deploy|merge)\w*|fail[\s_-]*(closed|the[\s_-]*build)|required[\s_-]*check\w*|promote[\s_-]*without)\b/i;

export interface PromptChangeReviewEvalReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    release: { found: boolean; refs: string[] };
    review: { found: boolean; refs: string[] };
    evalLink: { found: boolean; refs: string[] };
    blockGate: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    releasesMissingReviewOrEval: number | null;
    promoteWithoutReviewAndEvalBlocked: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    releaseSignalsPresent: boolean;
    prmM2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
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

function detectPromptSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMPT_PATH_RE.test(path) ||
        /\b(system[\s_-]*prompt|prompt[\s_-]*template)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptChangeReviewEvalReport["importedResults"] {
  const sources: string[] = [];
  let releasesMissingReviewOrEval: number | null = null;
  let promoteWithoutReviewAndEvalBlocked: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-change-review-eval-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      releasesMissingReviewOrEval =
        asNum(data.releasesMissingReviewOrEval) ??
        asNum(data.releases_missing_review_or_eval) ??
        releasesMissingReviewOrEval;
      promoteWithoutReviewAndEvalBlocked =
        asBool(data.promoteWithoutReviewAndEvalBlocked) ??
        asBool(data.promote_without_review_and_eval_blocked) ??
        asBool(data.blockingGate) ??
        promoteWithoutReviewAndEvalBlocked;

      const missingReview =
        asNum(data.promptReleasesMissingReviewId) ??
        asNum(data.prompt_releases_missing_review_id);
      const missingEval =
        asNum(data.promptReleasesMissingEvalArtifact) ??
        asNum(data.prompt_releases_missing_eval_artifact);
      if (
        releasesMissingReviewOrEval === null &&
        missingReview !== null &&
        missingEval !== null
      ) {
        releasesMissingReviewOrEval = Math.max(missingReview, missingEval);
      }
      if (asBool(data.allReleasesHaveReviewAndEval) === true) {
        releasesMissingReviewOrEval = releasesMissingReviewOrEval ?? 0;
      }
      // Affirmative gate evidence overrides an earlier false blockingGate.
      if (asBool(data.reviewAndEvalRequiredOnRelease) === true) {
        promoteWithoutReviewAndEvalBlocked = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    releasesMissingReviewOrEval,
    promoteWithoutReviewAndEvalBlocked,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptChangeReviewEvalReport(opts: {
  assessedAt: string;
  release: { found: boolean; refs: string[] };
  review: { found: boolean; refs: string[] };
  evalLink: { found: boolean; refs: string[] };
  blockGate: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptChangeReviewEvalReport["importedResults"];
}): PromptChangeReviewEvalReport {
  const notes: string[] = [];
  const releaseSignalsPresent =
    opts.release.found ||
    opts.review.found ||
    opts.evalLink.found ||
    opts.blockGate.found;

  if (!opts.promptSignals && !releaseSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/release signals — PRM-M2 may be NOT_APPLICABLE if there are no production prompt releases.",
    );
  }
  if (opts.release.found) {
    notes.push(`Release refs: ${opts.release.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.review.found) {
    notes.push(`Review refs: ${opts.review.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.evalLink.found) {
    notes.push(`Eval-link refs: ${opts.evalLink.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.blockGate.found) {
    notes.push(`Block-gate refs: ${opts.blockGate.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missing=${opts.imported.releasesMissingReviewOrEval}, blocked=${opts.imported.promoteWithoutReviewAndEvalBlocked})`,
    );
  } else if (releaseSignalsPresent) {
    notes.push(
      "Release signals alone are PARTIAL — import releasesMissingReviewOrEval=0 + promoteWithoutReviewAndEvalBlocked=true (measuredAt ≤90d) under imports/prompt-change-review-eval/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.releasesMissingReviewOrEval !== null &&
    opts.imported.releasesMissingReviewOrEval === 0;
  const blockOk = opts.imported.promoteWithoutReviewAndEvalBlocked === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptChangeReviewEvalReport["summary"]["statusHint"];
  let prmM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.releasesMissingReviewOrEval !== null &&
      opts.imported.releasesMissingReviewOrEval > 0) ||
      opts.imported.promoteWithoutReviewAndEvalBlocked === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.promptSignals && !releaseSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    prmM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmM2Satisfied = false;
    notes.push(
      "Imported evidence shows releases missing review/eval, non-blocking gate, or evidence older than 90 days — PRM-M2 fail.",
    );
  } else if (
    (releaseSignalsPresent || opts.imported.found) &&
    coverageOk &&
    blockOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmM2Satisfied = true;
  } else if (releaseSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmM2Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show releasesMissingReviewOrEval=0.");
    }
    if (opts.imported.found && !blockOk) {
      notes.push("Import must show promoteWithoutReviewAndEvalBlocked=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-M2 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmM2Satisfied = null;
    notes.push(
      "Prompt signals present but no release review/eval gate evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      release: opts.release,
      review: opts.review,
      evalLink: opts.evalLink,
      blockGate: opts.blockGate,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      releaseSignalsPresent,
      prmM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptChangeReviewEvalCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const releaseRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RELEASE_RE.test(path) || RELEASE_RE.test(text),
      12,
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REVIEW_RE.test(path) || REVIEW_RE.test(text),
      12,
    );
    const evalLinkRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EVAL_LINK_RE.test(path) || EVAL_LINK_RE.test(text),
      12,
    );
    const blockGateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RELEASE_RE.test(path) || RELEASE_RE.test(text) || BLOCK_RE.test(path)) &&
        (BLOCK_RE.test(text) || BLOCK_RE.test(path)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptChangeReviewEvalReport({
      assessedAt: ctx.assessedAt.toISOString(),
      release: { found: releaseRefs.length > 0, refs: releaseRefs },
      review: { found: reviewRefs.length > 0, refs: reviewRefs },
      evalLink: { found: evalLinkRefs.length > 0, refs: evalLinkRefs },
      blockGate: { found: blockGateRefs.length > 0, refs: blockGateRefs },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-change-review-eval-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-change-review-eval-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-change-review-eval",
          "prm-m2",
          DETECTOR_ID,
          ...(report.summary.prmM2Satisfied ? ["prm-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.release.refs,
        ...report.signals.review.refs,
        ...report.signals.evalLink.refs,
        ...report.signals.blockGate.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-change-review-eval-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-M2 status=${report.summary.statusHint} release=${report.summary.releaseSignalsPresent} satisfied=${report.summary.prmM2Satisfied}; report=imports/${PLUGIN_ID}/prompt-change-review-eval-report.json`,
      nodes,
    };
  },
};
