/**
 * ai-improvement-backlog — ORG-R3 / repo-ai-improvement-backlog.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
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

const PLUGIN_ID = "ai-improvement-backlog";
const RELATED = ["ORG-R3"] as const;
const DETECTOR_ID = "repo-ai-improvement-backlog";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_LINKAGE_PCT = 80;
const MIN_CLOSED_OR_PLANNED_PCT = 50;
const PATH_RE =
  /(improvement[\s_-]*backlog|continual[\s_-]*improvement|incident[\s_-]*backlog|eval[\s_-]*fail)/i;
const BACKLOG_RE =
  /\b(improvement[\s_-]*backlog|continual[\s_-]*improvement|post[\s_-]*incident[\s_-]*action|eval[\s_-]*failure[\s_-]*ticket)\b/i;
const LINK_RE =
  /\b(linked[\s_-]*from[\s_-]*incident|sev[\s_-]*[12]|critical[\s_-]*eval|backlog[\s_-]*item)\b/i;

export interface AiImprovementBacklogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    backlog: { found: boolean; refs: string[] };
    linkage: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    linkageRatePct: number | null;
    closedOrPlannedRatePct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    backlogSignalsPresent: boolean;
    orgR3Satisfied: boolean | null;
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
function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  for (const f of walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [".yml", ".yaml", ".json", ".md", ".txt", ".csv"],
  })) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): AiImprovementBacklogReport["importedResults"] {
  const sources: string[] = [];
  let linkageRatePct: number | null = null;
  let closedOrPlannedRatePct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;
  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-improvement-backlog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      linkageRatePct =
        asNum(data.linkageRatePct) ??
        asNum(data.incidentEvalToBacklogRatePct) ??
        linkageRatePct;
      closedOrPlannedRatePct =
        asNum(data.closedOrPlannedRatePct) ??
        asNum(data.backlogClosedOrPlannedPct) ??
        closedOrPlannedRatePct;
      ageDays = asNum(data.ageDays) ?? ageDays;
      const events = asNum(data.sev12AndCriticalEvalCount);
      const linked = asNum(data.backlogLinkedCount);
      if (
        linkageRatePct == null &&
        events !== null &&
        linked !== null &&
        events > 0
      ) {
        linkageRatePct = Math.round((linked / events) * 100);
      }
      if (asBool(data.orgR3Complete) === true) {
        linkageRatePct = linkageRatePct ?? MIN_LINKAGE_PCT;
        closedOrPlannedRatePct =
          closedOrPlannedRatePct ?? MIN_CLOSED_OR_PLANNED_PCT;
      }
    } catch {
      /* skip */
    }
  }
  return {
    found: sources.length > 0,
    linkageRatePct,
    closedOrPlannedRatePct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiImprovementBacklogReport(opts: {
  assessedAt: string;
  signals: AiImprovementBacklogReport["signals"];
  contextSignals: boolean;
  imported: AiImprovementBacklogReport["importedResults"];
}): AiImprovementBacklogReport {
  const notes: string[] = [];
  const backlogSignalsPresent =
    opts.signals.backlog.found || opts.signals.linkage.found;
  if (!opts.contextSignals && !backlogSignalsPresent && !opts.imported.found) {
    notes.push(
      "No improvement-backlog signals — ORG-R3 may be NOT_APPLICABLE if there is no AI incident/eval practice.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (linkage=${opts.imported.linkageRatePct}%, closedOrPlanned=${opts.imported.closedOrPlannedRatePct}%)`,
    );
  } else if (backlogSignalsPresent) {
    notes.push(
      `Backlog signals alone are PARTIAL — import linkageRatePct≥${MIN_LINKAGE_PCT} and closedOrPlannedRatePct≥${MIN_CLOSED_OR_PLANNED_PCT} (measuredAt ≤90d) under imports/ai-improvement-backlog/ to PASS.`,
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
  const linkageOk =
    opts.imported.linkageRatePct !== null &&
    opts.imported.linkageRatePct >= MIN_LINKAGE_PCT;
  const closedOk =
    opts.imported.closedOrPlannedRatePct !== null &&
    opts.imported.closedOrPlannedRatePct >= MIN_CLOSED_OR_PLANNED_PCT;
  const passOk = linkageOk && closedOk && ageOk && importFresh;
  let statusHint: AiImprovementBacklogReport["summary"]["statusHint"];
  let orgR3Satisfied: boolean | null = null;
  const measuredFail =
    opts.imported.found &&
    ((opts.imported.linkageRatePct !== null &&
      opts.imported.linkageRatePct < MIN_LINKAGE_PCT) ||
      (opts.imported.closedOrPlannedRatePct !== null &&
        opts.imported.closedOrPlannedRatePct < MIN_CLOSED_OR_PLANNED_PCT) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));
  if (!opts.contextSignals && !backlogSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
  } else if (measuredFail) {
    statusHint = "fail";
    orgR3Satisfied = false;
    notes.push(
      "Imported evidence shows linkage/closure below thresholds or stale evidence — ORG-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgR3Satisfied = true;
  } else if (backlogSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgR3Satisfied = false;
    if (opts.imported.found) {
      if (!linkageOk) {
        notes.push(`Import must show linkageRatePct≥${MIN_LINKAGE_PCT}.`);
      }
      if (!closedOk) {
        notes.push(
          `Import must show closedOrPlannedRatePct≥${MIN_CLOSED_OR_PLANNED_PCT}.`,
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-R3 PASS.",
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
    summary: { backlogSignalsPresent, orgR3Satisfied, statusHint },
    notes,
  };
}

export const aiImprovementBacklogCollector: Collector = {
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
    const backlogRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => BACKLOG_RE.test(p) || BACKLOG_RE.test(t),
    );
    const linkRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        (LINK_RE.test(p) || LINK_RE.test(t)) &&
        (BACKLOG_RE.test(t) || PATH_RE.test(p)),
      12,
    );
    const imported = loadImported(ctx);
    const report = buildAiImprovementBacklogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        backlog: { found: backlogRefs.length > 0, refs: backlogRefs },
        linkage: { found: linkRefs.length > 0, refs: linkRefs },
      },
      contextSignals,
      imported,
    });
    ensureDir(join(ctx.outputDir, "imports", PLUGIN_ID));
    writeFileSync(
      join(
        ctx.outputDir,
        "imports",
        PLUGIN_ID,
        "ai-improvement-backlog-report.json",
      ),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );
    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-R3 status=${report.summary.statusHint} satisfied=${report.summary.orgR3Satisfied}`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "docs",
          ref: `imports/${PLUGIN_ID}/ai-improvement-backlog-report.json`,
          excerpt: redact(JSON.stringify(report.summary)),
          pluginId: PLUGIN_ID,
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: 0,
          relatedCheckIds: [...RELATED],
          signals: [
            "ai-improvement-backlog",
            "org-r3",
            DETECTOR_ID,
            ...(report.summary.orgR3Satisfied ? ["org-r3-satisfied"] : []),
          ],
        },
      ],
    };
  },
};
