/**
 * ai-org-aprf-sampling — ORG-R5 / repo-ai-org-aprf-sampling.
 * Org-wide cadence sampling (distinct from CMP-R3 Level-5 coverage).
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

const PLUGIN_ID = "ai-org-aprf-sampling";
const RELATED = ["ORG-R5"] as const;
const DETECTOR_ID = "repo-ai-org-aprf-sampling";
const ASSESSMENT_MAX_AGE_DAYS = 365;
const IMPORT_MAX_AGE_DAYS = 90;
const PATH_RE =
  /(internal[\s_-]*audit|independent[\s_-]*assess|aprf[\s_-]*sampl|evidence[\s_-]*sampl)/i;
const SAMPLE_RE =
  /\b(org[\s_-]*sampl|aprf[\s_-]*evidence[\s_-]*sampl|internal[\s_-]*audit|independent[\s_-]*assessment)\b/i;
const FINDINGS_RE =
  /\b(sampled[\s_-]*check|check[\s_-]*ids?|findings?)\b/i;

export interface AiOrgAprfSamplingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    sampling: { found: boolean; refs: string[] };
    findings: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    assessmentAgeDays: number | null;
    sampledCheckIdCount: number | null;
    findingsListed: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    samplingSignalsPresent: boolean;
    orgR5Satisfied: boolean | null;
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
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
  now: Date,
): AiOrgAprfSamplingReport["importedResults"] {
  const sources: string[] = [];
  let assessmentAgeDays: number | null = null;
  let sampledCheckIdCount: number | null = null;
  let findingsListed: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;
  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-org-aprf-sampling-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      assessmentAgeDays =
        asNum(data.assessmentAgeDays) ??
        daysSince(
          asStr(data.assessmentDate) ?? asStr(data.reportDate) ?? undefined,
          now,
        ) ??
        assessmentAgeDays;
      sampledCheckIdCount =
        asNum(data.sampledCheckIdCount) ??
        (Array.isArray(data.sampledCheckIds)
          ? data.sampledCheckIds.length
          : null) ??
        sampledCheckIdCount;
      findingsListed =
        asBool(data.findingsListed) ??
        asBool(data.hasFindings) ??
        findingsListed;
      ageDays = asNum(data.ageDays) ?? ageDays;
      if (asBool(data.orgR5Complete) === true) {
        assessmentAgeDays = assessmentAgeDays ?? 0;
        sampledCheckIdCount = sampledCheckIdCount ?? 1;
        findingsListed = findingsListed ?? true;
      }
    } catch {
      /* skip */
    }
  }
  return {
    found: sources.length > 0,
    assessmentAgeDays,
    sampledCheckIdCount,
    findingsListed,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiOrgAprfSamplingReport(opts: {
  assessedAt: string;
  signals: AiOrgAprfSamplingReport["signals"];
  contextSignals: boolean;
  imported: AiOrgAprfSamplingReport["importedResults"];
}): AiOrgAprfSamplingReport {
  const notes: string[] = [];
  const samplingSignalsPresent =
    opts.signals.sampling.found || opts.signals.findings.found;
  if (!opts.contextSignals && !samplingSignalsPresent && !opts.imported.found) {
    notes.push(
      "No org APRF-sampling signals — ORG-R5 may be NOT_APPLICABLE if no AI systems are in assessment scope.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (assessmentAgeDays=${opts.imported.assessmentAgeDays}, sampledChecks=${opts.imported.sampledCheckIdCount}, findings=${opts.imported.findingsListed})`,
    );
  } else if (samplingSignalsPresent) {
    notes.push(
      "Sampling signals alone are PARTIAL — import assessmentAgeDays≤365 + sampledCheckIdCount>0 + findingsListed (measuredAt ≤90d) under imports/ai-org-aprf-sampling/ to PASS.",
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
  const assessmentOk =
    opts.imported.assessmentAgeDays !== null &&
    opts.imported.assessmentAgeDays <= ASSESSMENT_MAX_AGE_DAYS;
  const sampledOk =
    opts.imported.sampledCheckIdCount !== null &&
    opts.imported.sampledCheckIdCount > 0;
  const findingsOk = opts.imported.findingsListed === true;
  const passOk =
    assessmentOk && sampledOk && findingsOk && ageOk && importFresh;
  let statusHint: AiOrgAprfSamplingReport["summary"]["statusHint"];
  let orgR5Satisfied: boolean | null = null;
  const measuredFail =
    opts.imported.found &&
    ((opts.imported.assessmentAgeDays !== null &&
      opts.imported.assessmentAgeDays > ASSESSMENT_MAX_AGE_DAYS) ||
      (opts.imported.sampledCheckIdCount !== null &&
        opts.imported.sampledCheckIdCount <= 0) ||
      opts.imported.findingsListed === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));
  if (!opts.contextSignals && !samplingSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
  } else if (measuredFail) {
    statusHint = "fail";
    orgR5Satisfied = false;
    notes.push(
      "Imported evidence shows stale report, empty sample, missing findings, or stale evidence — ORG-R5 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgR5Satisfied = true;
  } else if (samplingSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgR5Satisfied = false;
    if (opts.imported.found) {
      if (!assessmentOk) {
        notes.push(
          `Import must show assessmentAgeDays≤${ASSESSMENT_MAX_AGE_DAYS}.`,
        );
      }
      if (!sampledOk) notes.push("Import must show sampledCheckIdCount>0.");
      if (!findingsOk) notes.push("Import must show findingsListed=true.");
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-R5 PASS.",
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
    summary: { samplingSignalsPresent, orgR5Satisfied, statusHint },
    notes,
  };
}

export const aiOrgAprfSamplingCollector: Collector = {
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
    const samplingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SAMPLE_RE.test(p) || SAMPLE_RE.test(t),
    );
    const findingsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        (FINDINGS_RE.test(p) || FINDINGS_RE.test(t)) &&
        (SAMPLE_RE.test(t) || PATH_RE.test(p)),
      12,
    );
    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiOrgAprfSamplingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        sampling: { found: samplingRefs.length > 0, refs: samplingRefs },
        findings: { found: findingsRefs.length > 0, refs: findingsRefs },
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
        "ai-org-aprf-sampling-report.json",
      ),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );
    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-R5 status=${report.summary.statusHint} satisfied=${report.summary.orgR5Satisfied}`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "docs",
          ref: `imports/${PLUGIN_ID}/ai-org-aprf-sampling-report.json`,
          excerpt: redact(JSON.stringify(report.summary)),
          pluginId: PLUGIN_ID,
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: 0,
          relatedCheckIds: [...RELATED],
          signals: [
            "ai-org-aprf-sampling",
            "org-r5",
            DETECTOR_ID,
            ...(report.summary.orgR5Satisfied ? ["org-r5-satisfied"] : []),
          ],
        },
      ],
    };
  },
};
