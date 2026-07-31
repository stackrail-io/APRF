/**
 * ai-artifact-change-records — DEP-M2 / repo-ai-artifact-change-records.
 *
 * Discovers who/what/when + review-linked change records for AI artifacts.
 * Import changesWithWhoWhatWhenAndReviewLinkPct=100 (or
 * changesMissingWhoWhatWhenOrReviewLink=0) under
 * imports/ai-artifact-change-records/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-artifact-change-records";
const RELATED = ["DEP-M2"] as const;
const DETECTOR_ID = "repo-ai-artifact-change-records";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_ARTIFACT_RE =
  /(prompt|prompts|model[\s_-]*pin|model[\s_-]*version|tool[\s_-]*catalog|llm|openai|anthropic|bedrock|vertex)/i;

const CHANGE_LOG_RE =
  /\b(change[\s_-]*log|changelog|release[\s_-]*notes|change[\s_-]*record|ticket[\s_-]*export|audit[\s_-]*log)\b/i;

const WHO_WHAT_WHEN_RE =
  /\b(who[\s_/-]*what[\s_/-]*when|changed[\s_-]*by|actor|author|timestamp|changed[\s_-]*at|review[\s_-]*link|approval[\s_-]*id)\b/i;

const REVIEW_LINK_RE =
  /\b(pull[\s_-]*request|review[\s_-]*link|approval[\s_-]*id|ticket[\s_-]*id|change[\s_-]*request|linked[\s_-]*pr)\b/i;

export interface AiArtifactChangeRecordsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    changeLog: { found: boolean; refs: string[] };
    whoWhatWhen: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    changesWithWhoWhatWhenAndReviewLinkPct: number | null;
    changesMissingWhoWhatWhenOrReviewLink: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiArtifactSignalsPresent: boolean;
    changeRecordSignalsPresent: boolean;
    depM2Satisfied: boolean | null;
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
      ".csv",
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
): AiArtifactChangeRecordsReport["importedResults"] {
  const sources: string[] = [];
  let changesWithWhoWhatWhenAndReviewLinkPct: number | null = null;
  let changesMissingWhoWhatWhenOrReviewLink: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-artifact-change-records-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      changesWithWhoWhatWhenAndReviewLinkPct =
        asNum(data.changesWithWhoWhatWhenAndReviewLinkPct) ??
        asNum(data.changes_with_who_what_when_and_review_link_pct) ??
        asNum(data.completeChangeRecordPct) ??
        changesWithWhoWhatWhenAndReviewLinkPct;
      changesMissingWhoWhatWhenOrReviewLink =
        asNum(data.changesMissingWhoWhatWhenOrReviewLink) ??
        asNum(data.changes_missing_who_what_when_or_review_link) ??
        asNum(data.incompleteChangeRecordCount) ??
        changesMissingWhoWhatWhenOrReviewLink;

      if (asBool(data.allChangesHaveWhoWhatWhenAndReviewLink) === true) {
        changesWithWhoWhatWhenAndReviewLinkPct =
          changesWithWhoWhatWhenAndReviewLinkPct ?? 100;
        changesMissingWhoWhatWhenOrReviewLink =
          changesMissingWhoWhatWhenOrReviewLink ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    changesWithWhoWhatWhenAndReviewLinkPct,
    changesMissingWhoWhatWhenOrReviewLink,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiArtifactChangeRecordsReport(opts: {
  assessedAt: string;
  changeLog: { found: boolean; refs: string[] };
  whoWhatWhen: { found: boolean; refs: string[] };
  aiArtifactSignals: boolean;
  imported: AiArtifactChangeRecordsReport["importedResults"];
}): AiArtifactChangeRecordsReport {
  const notes: string[] = [];
  const changeRecordSignalsPresent =
    opts.changeLog.found || opts.whoWhatWhen.found;

  if (
    !opts.aiArtifactSignals &&
    !changeRecordSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI-artifact/change-record signals — DEP-M2 may be NOT_APPLICABLE if no production AI artifact changes occur.",
    );
  }
  if (opts.changeLog.found) {
    notes.push(`Change-log refs: ${opts.changeLog.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.whoWhatWhen.found) {
    notes.push(
      `Who/what/when refs: ${opts.whoWhatWhen.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (completePct=${opts.imported.changesWithWhoWhatWhenAndReviewLinkPct}, missing=${opts.imported.changesMissingWhoWhatWhenOrReviewLink})`,
    );
  } else if (changeRecordSignalsPresent) {
    notes.push(
      "Change-record signals alone are PARTIAL — import changesWithWhoWhatWhenAndReviewLinkPct=100 (or changesMissingWhoWhatWhenOrReviewLink=0) (measuredAt ≤90d) under imports/ai-artifact-change-records/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.changesWithWhoWhatWhenAndReviewLinkPct === 100 ||
    opts.imported.changesMissingWhoWhatWhenOrReviewLink === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiArtifactChangeRecordsReport["summary"]["statusHint"] =
    "not_demonstrated";
  let depM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((typeof opts.imported.changesWithWhoWhatWhenAndReviewLinkPct ===
      "number" &&
      opts.imported.changesWithWhoWhatWhenAndReviewLinkPct < 100) ||
      (typeof opts.imported.changesMissingWhoWhatWhenOrReviewLink ===
        "number" &&
        opts.imported.changesMissingWhoWhatWhenOrReviewLink > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.aiArtifactSignals &&
    !changeRecordSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    depM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    depM2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete who/what/when+review coverage or evidence older than 90 days — DEP-M2 fail.",
    );
  } else if (
    (changeRecordSignalsPresent || opts.imported.found) &&
    coverageOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    depM2Satisfied = true;
  } else if (changeRecordSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    depM2Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show changesWithWhoWhatWhenAndReviewLinkPct=100 or changesMissingWhoWhatWhenOrReviewLink=0 for last 30 days.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DEP-M2 PASS.",
      );
    }
  } else if (opts.aiArtifactSignals) {
    statusHint = "not_demonstrated";
    depM2Satisfied = null;
    notes.push(
      "AI artifact signals present but no change-log / who-what-when evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    depM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      changeLog: opts.changeLog,
      whoWhatWhen: opts.whoWhatWhen,
    },
    importedResults: opts.imported,
    summary: {
      aiArtifactSignalsPresent: opts.aiArtifactSignals,
      changeRecordSignalsPresent,
      depM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiArtifactChangeRecordsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiArtifactSignals = detectAiArtifactSignals(ctx.targetPath, maxFiles);

    const changeLogRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CHANGE_LOG_RE.test(path) ||
        ((AI_ARTIFACT_RE.test(path) || AI_ARTIFACT_RE.test(text)) &&
          CHANGE_LOG_RE.test(text)),
      12,
    );
    const whoWhatWhenRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        WHO_WHAT_WHEN_RE.test(path) ||
        WHO_WHAT_WHEN_RE.test(text) ||
        ((CHANGE_LOG_RE.test(path) || CHANGE_LOG_RE.test(text)) &&
          REVIEW_LINK_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiArtifactChangeRecordsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      changeLog: { found: changeLogRefs.length > 0, refs: changeLogRefs },
      whoWhatWhen: {
        found: whoWhatWhenRefs.length > 0,
        refs: whoWhatWhenRefs,
      },
      aiArtifactSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-artifact-change-records-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-artifact-change-records-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-artifact-change-records",
          "dep-m2",
          DETECTOR_ID,
          ...(report.summary.depM2Satisfied ? ["dep-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.changeLog.refs,
        ...report.signals.whoWhatWhen.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-artifact-change-records-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DEP-M2 status=${report.summary.statusHint} changeRecords=${report.summary.changeRecordSignalsPresent} satisfied=${report.summary.depM2Satisfied}; report=imports/${PLUGIN_ID}/ai-artifact-change-records-report.json`,
      nodes,
    };
  },
};
