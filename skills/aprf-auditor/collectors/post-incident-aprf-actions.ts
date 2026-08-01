/**
 * post-incident-aprf-actions — INC-R2 / repo-post-incident-aprf-actions.
 *
 * Discovers post-incident reviews with APRF-pillar-mapped actions.
 * Import reviewsWithTrackedActionOrRationalePct=100 (or
 * reviewsMissingTrackedActionOrRationale=0) with sevEligibleIncidentCount>0
 * under imports/post-incident-aprf-actions/ to unlock PASS (measuredAt ≤90d).
 * N/A when sevEligibleIncidentCount=0.
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

const PLUGIN_ID = "post-incident-aprf-actions";
const RELATED = ["INC-R2"] as const;
const DETECTOR_ID = "repo-post-incident-aprf-actions";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const POSTMORTEM_RE =
  /\b(post[\s_-]*incident|postmortem|post[\s_-]*mortem|after[\s_-]*action|incident[\s_-]*review|pir)\b/i;

const APRF_ACTION_RE =
  /\b(aprf[\s_-]*pillar|pillar[\s_-]*mapped|tracked[\s_-]*action|remediation[\s_-]*ticket|no[\s_-]*action[\s_-]*rationale)\b/i;

const SEV_RE =
  /\b(sev[\s_-]*\d|severity|sev[\s_-]*eligible|p[0-3][\s_-]*incident)\b/i;

export interface PostIncidentAprfActionsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    postmortem: { found: boolean; refs: string[] };
    aprfAction: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sevEligibleIncidentCount: number | null;
    reviewsWithTrackedActionOrRationalePct: number | null;
    reviewsMissingTrackedActionOrRationale: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    reviewSignalsPresent: boolean;
    incR2Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".html"],
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

function loadImported(
  ctx: CollectorContext,
): PostIncidentAprfActionsReport["importedResults"] {
  const sources: string[] = [];
  let sevEligibleIncidentCount: number | null = null;
  let reviewsWithTrackedActionOrRationalePct: number | null = null;
  let reviewsMissingTrackedActionOrRationale: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/post-incident-aprf-actions-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      sevEligibleIncidentCount =
        asNum(data.sevEligibleIncidentCount) ??
        asNum(data.sev_eligible_incident_count) ??
        sevEligibleIncidentCount;
      reviewsWithTrackedActionOrRationalePct =
        asNum(data.reviewsWithTrackedActionOrRationalePct) ??
        asNum(data.reviews_with_tracked_action_or_rationale_pct) ??
        asNum(data.coveragePct) ??
        reviewsWithTrackedActionOrRationalePct;
      reviewsMissingTrackedActionOrRationale =
        asNum(data.reviewsMissingTrackedActionOrRationale) ??
        asNum(data.reviews_missing_tracked_action_or_rationale) ??
        asNum(data.missingCount) ??
        reviewsMissingTrackedActionOrRationale;

      if (asBool(data.allSevReviewsHaveTrackedActionOrRationale) === true) {
        reviewsWithTrackedActionOrRationalePct =
          reviewsWithTrackedActionOrRationalePct ?? 100;
        reviewsMissingTrackedActionOrRationale =
          reviewsMissingTrackedActionOrRationale ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sevEligibleIncidentCount,
    reviewsWithTrackedActionOrRationalePct,
    reviewsMissingTrackedActionOrRationale,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPostIncidentAprfActionsReport(opts: {
  assessedAt: string;
  postmortem: { found: boolean; refs: string[] };
  aprfAction: { found: boolean; refs: string[] };
  imported: PostIncidentAprfActionsReport["importedResults"];
}): PostIncidentAprfActionsReport {
  const notes: string[] = [];
  const reviewSignalsPresent =
    opts.postmortem.found || opts.aprfAction.found;

  if (!reviewSignalsPresent && !opts.imported.found) {
    notes.push(
      "No post-incident / APRF-action signals — INC-R2 may be NOT_APPLICABLE if no SEV-eligible AI incidents occur.",
    );
  }
  if (opts.postmortem.found) {
    notes.push(
      `Postmortem refs: ${opts.postmortem.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.aprfAction.found) {
    notes.push(
      `APRF-action refs: ${opts.aprfAction.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (sevCount=${opts.imported.sevEligibleIncidentCount}, coveragePct=${opts.imported.reviewsWithTrackedActionOrRationalePct}, missing=${opts.imported.reviewsMissingTrackedActionOrRationale})`,
    );
  } else if (reviewSignalsPresent) {
    notes.push(
      "Review signals alone are PARTIAL — import reviewsWithTrackedActionOrRationalePct=100 (or reviewsMissingTrackedActionOrRationale=0) (measuredAt ≤90d) under imports/post-incident-aprf-actions/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.reviewsWithTrackedActionOrRationalePct === 100 ||
    opts.imported.reviewsMissingTrackedActionOrRationale === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const noSev =
    opts.imported.found && opts.imported.sevEligibleIncidentCount === 0;
  const sevCountOk =
    typeof opts.imported.sevEligibleIncidentCount === "number" &&
    opts.imported.sevEligibleIncidentCount > 0;

  let statusHint: PostIncidentAprfActionsReport["summary"]["statusHint"];
  let incR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !noSev &&
    ((typeof opts.imported.reviewsWithTrackedActionOrRationalePct ===
      "number" &&
      opts.imported.reviewsWithTrackedActionOrRationalePct < 100) ||
      (typeof opts.imported.reviewsMissingTrackedActionOrRationale ===
        "number" &&
        opts.imported.reviewsMissingTrackedActionOrRationale > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (noSev) {
    statusHint = "not_applicable";
    incR2Satisfied = null;
    notes.push(
      "sevEligibleIncidentCount=0 — INC-R2 NOT_APPLICABLE (no SEV-eligible AI incidents in window).",
    );
  } else if (!reviewSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incR2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete APRF-action coverage or evidence older than 90 days — INC-R2 fail.",
    );
  } else if (
    (reviewSignalsPresent || opts.imported.found) &&
    sevCountOk &&
    coverageOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incR2Satisfied = true;
  } else if (reviewSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incR2Satisfied = false;
    if (opts.imported.found && !sevCountOk) {
      notes.push(
        "Import must show sevEligibleIncidentCount>0 to unlock PASS (use 0 for NOT_APPLICABLE).",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show reviewsWithTrackedActionOrRationalePct=100 or reviewsMissingTrackedActionOrRationale=0.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      postmortem: opts.postmortem,
      aprfAction: opts.aprfAction,
    },
    importedResults: opts.imported,
    summary: {
      reviewSignalsPresent,
      incR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const postIncidentAprfActionsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const postmortem = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        POSTMORTEM_RE.test(path) ||
        POSTMORTEM_RE.test(text) ||
        (SEV_RE.test(text) && /incident/i.test(path + text)),
      10,
    );
    const aprfAction = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        APRF_ACTION_RE.test(path) ||
        APRF_ACTION_RE.test(text) ||
        ((POSTMORTEM_RE.test(path) || POSTMORTEM_RE.test(text)) &&
          /aprf|pillar|tracked[\s_-]*action/i.test(text)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildPostIncidentAprfActionsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      postmortem: { found: postmortem.length > 0, refs: postmortem },
      aprfAction: { found: aprfAction.length > 0, refs: aprfAction },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "post-incident-aprf-actions-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/post-incident-aprf-actions-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "post-incident-aprf-actions",
          "inc-r2",
          DETECTOR_ID,
          ...(report.summary.incR2Satisfied ? ["inc-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.postmortem.refs,
        ...report.signals.aprfAction.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["post-incident-aprf-actions-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-R2 status=${report.summary.statusHint} reviews=${report.summary.reviewSignalsPresent} satisfied=${report.summary.incR2Satisfied}; report=imports/${PLUGIN_ID}/post-incident-aprf-actions-report.json`,
      nodes,
    };
  },
};
