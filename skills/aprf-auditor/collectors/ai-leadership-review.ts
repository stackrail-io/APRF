/**
 * ai-leadership-review — ORG-R1 / repo-ai-leadership-review.
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

const PLUGIN_ID = "ai-leadership-review";
const RELATED = ["ORG-R1"] as const;
const DETECTOR_ID = "repo-ai-leadership-review";
const REVIEW_MAX_AGE_DAYS = 90;
const IMPORT_MAX_AGE_DAYS = 90;
const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;
const PATH_RE =
  /(leadership|board[\s_-]*pack|ai[\s_-]*risk|aprf[\s_-]*maturity|executive[\s_-]*review)/i;
const REVIEW_RE =
  /\b(leadership[\s_-]*review|board[\s_-]*pack|ai[\s_-]*risk[\s_-]*posture|aprf[\s_-]*maturity|capability[\s_-]*attained)\b/i;
const ACTION_RE =
  /\b(action[\s_-]*log|open[\s_-]*action|due[\s_-]*date|action[\s_-]*owner)\b/i;

export interface AiLeadershipReviewReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    review: { found: boolean; refs: string[] };
    actions: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    reviewAgeDays: number | null;
    openActionsIncomplete: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    reviewSignalsPresent: boolean;
    orgR1Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
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
  for (const f of walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [".yml", ".yaml", ".json", ".md", ".txt"],
  })) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
  now: Date,
): AiLeadershipReviewReport["importedResults"] {
  const sources: string[] = [];
  let reviewAgeDays: number | null = null;
  let openActionsIncomplete: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;
  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-leadership-review-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      reviewAgeDays =
        asNum(data.reviewAgeDays) ??
        daysSince(
          asStr(data.reviewDate) ?? asStr(data.reviewedAt) ?? undefined,
          now,
        ) ??
        reviewAgeDays;
      openActionsIncomplete =
        asNum(data.openActionsIncomplete) ??
        asNum(data.incompleteOpenActions) ??
        openActionsIncomplete;
      ageDays = asNum(data.ageDays) ?? ageDays;
      const actions = (data.openActions as unknown[]) || [];
      if (Array.isArray(actions) && actions.length > 0) {
        let incomplete = 0;
        for (const a of actions) {
          if (!a || typeof a !== "object") continue;
          const row = a as Record<string, unknown>;
          if (!row.owner || !(row.dueDate || row.due_date || row.dueAt)) {
            incomplete += 1;
          }
        }
        openActionsIncomplete = openActionsIncomplete ?? incomplete;
      }
      if (asBool(data.orgR1Complete) === true) {
        reviewAgeDays = reviewAgeDays ?? 0;
        openActionsIncomplete = openActionsIncomplete ?? 0;
      }
    } catch {
      /* skip */
    }
  }
  return {
    found: sources.length > 0,
    reviewAgeDays,
    openActionsIncomplete,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiLeadershipReviewReport(opts: {
  assessedAt: string;
  signals: AiLeadershipReviewReport["signals"];
  contextSignals: boolean;
  imported: AiLeadershipReviewReport["importedResults"];
}): AiLeadershipReviewReport {
  const notes: string[] = [];
  const reviewSignalsPresent =
    opts.signals.review.found || opts.signals.actions.found;
  if (!opts.contextSignals && !reviewSignalsPresent && !opts.imported.found) {
    notes.push(
      "No leadership-review signals — ORG-R1 may be NOT_APPLICABLE if there are no production AI systems.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (reviewAgeDays=${opts.imported.reviewAgeDays}, incompleteActions=${opts.imported.openActionsIncomplete})`,
    );
  } else if (reviewSignalsPresent) {
    notes.push(
      "Review signals alone are PARTIAL — import reviewAgeDays≤90 + openActionsIncomplete=0 (measuredAt ≤90d) under imports/ai-leadership-review/ to PASS.",
    );
  }
  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    IMPORT_MAX_AGE_DAYS,
  );
  const reviewOk =
    opts.imported.reviewAgeDays !== null &&
    opts.imported.reviewAgeDays <= REVIEW_MAX_AGE_DAYS;
  const actionsOk = opts.imported.openActionsIncomplete === 0;
  const passOk = reviewOk && actionsOk && ageOk && importFresh;
  let statusHint: AiLeadershipReviewReport["summary"]["statusHint"] =
    "not_demonstrated";
  let orgR1Satisfied: boolean | null = null;
  const measuredFail =
    opts.imported.found &&
    ((opts.imported.reviewAgeDays !== null &&
      opts.imported.reviewAgeDays > REVIEW_MAX_AGE_DAYS) ||
      (opts.imported.openActionsIncomplete !== null &&
        opts.imported.openActionsIncomplete > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));
  if (!opts.contextSignals && !reviewSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
  } else if (measuredFail) {
    statusHint = "fail";
    orgR1Satisfied = false;
    notes.push(
      "Imported evidence shows stale review (>90d), incomplete actions, or stale evidence — ORG-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgR1Satisfied = true;
  } else if (reviewSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgR1Satisfied = false;
    if (opts.imported.found) {
      if (!reviewOk) notes.push(`Import must show reviewAgeDays≤${REVIEW_MAX_AGE_DAYS}.`);
      if (!actionsOk) notes.push("Import must show openActionsIncomplete=0.");
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-R1 PASS.",
        );
      }
    }
  }
  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: { reviewSignalsPresent, orgR1Satisfied, statusHint },
    notes,
  };
}

export const aiLeadershipReviewCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const contextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (p, t) => PATH_RE.test(p) || PATH_RE.test(t),
        5,
      ).length > 0;
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        (REVIEW_RE.test(p) || REVIEW_RE.test(t)) &&
        (PATH_RE.test(p) || PATH_RE.test(t) || REVIEW_RE.test(t)),
    );
    const actionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        (ACTION_RE.test(p) || ACTION_RE.test(t)) &&
        (REVIEW_RE.test(t) || PATH_RE.test(p)),
      12,
    );
    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiLeadershipReviewReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        review: { found: reviewRefs.length > 0, refs: reviewRefs },
        actions: { found: actionRefs.length > 0, refs: actionRefs },
      },
      contextSignals,
      imported,
    });
    ensureDir(join(ctx.outputDir, "imports", PLUGIN_ID));
    writeFileSync(
      join(ctx.outputDir, "imports", PLUGIN_ID, "ai-leadership-review-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );
    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-leadership-review-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-leadership-review",
          "org-r1",
          DETECTOR_ID,
          ...(report.summary.orgR1Satisfied ? ["org-r1-satisfied"] : []),
        ],
      },
    ];
    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-R1 status=${report.summary.statusHint} satisfied=${report.summary.orgR1Satisfied}`,
      nodes,
    };
  },
};
