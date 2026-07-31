/**
 * ai-independent-assessment — CMP-R3 / repo-ai-independent-assessment.
 *
 * Discovers Level-5 independent/internal-audit assessments. Import coverage
 * under imports/ai-independent-assessment/ to unlock PASS.
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

const PLUGIN_ID = "ai-independent-assessment";
const RELATED = ["CMP-R3"] as const;
const DETECTOR_ID = "repo-ai-independent-assessment";
const ASSESSMENT_MAX_AGE_DAYS = 365;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(independent[\s_-]*assess|internal[\s_-]*audit|level[\s_-]*5|aprf[\s_-]*assess|external[\s_-]*audit)/i;

const ASSESSMENT_RE =
  /\b(independent[\s_-]*assessment|internal[\s_-]*audit|third[\s_-]*party[\s_-]*assess|external[\s_-]*audit|assurance[\s_-]*report)\b/i;

const LEVEL5_RE =
  /\b(level[\s_-]*5|l5[\s_-]*system|maturity[\s_-]*level[\s_-]*5|criticality[\s_-]*5)\b/i;

const FINDINGS_RE =
  /\b(sampled[\s_-]*check|check[\s_-]*ids?|findings?|remediation[\s_-]*owner|corrective[\s_-]*action)\b/i;

export interface AiIndependentAssessmentReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    assessment: { found: boolean; refs: string[] };
    level5: { found: boolean; refs: string[] };
    findings: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    coversAllLevel5Systems: boolean | null;
    level5SystemCount: number | null;
    level5SystemsMissing: number | null;
    sampledCheckIdCount: number | null;
    findingsHaveRemediationOwners: boolean | null;
    assessmentAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    assessmentSignalsPresent: boolean;
    cmpR3Satisfied: boolean | null;
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
      ".pdf",
      ".csv",
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
}

function loadImported(
  ctx: CollectorContext,
  now: Date,
): AiIndependentAssessmentReport["importedResults"] {
  const sources: string[] = [];
  let coversAllLevel5Systems: boolean | null = null;
  let level5SystemCount: number | null = null;
  let level5SystemsMissing: number | null = null;
  let sampledCheckIdCount: number | null = null;
  let findingsHaveRemediationOwners: boolean | null = null;
  let assessmentAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-independent-assessment-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      coversAllLevel5Systems =
        asBool(data.coversAllLevel5Systems) ??
        asBool(data.coversAllLevel5) ??
        coversAllLevel5Systems;
      level5SystemCount =
        asNum(data.level5SystemCount) ??
        asNum(data.level5Count) ??
        level5SystemCount;
      level5SystemsMissing =
        asNum(data.level5SystemsMissing) ??
        asNum(data.missingLevel5Count) ??
        level5SystemsMissing;
      sampledCheckIdCount =
        asNum(data.sampledCheckIdCount) ??
        (Array.isArray(data.sampledCheckIds)
          ? data.sampledCheckIds.length
          : null) ??
        sampledCheckIdCount;
      findingsHaveRemediationOwners =
        asBool(data.findingsHaveRemediationOwners) ??
        asBool(data.allFindingsHaveOwners) ??
        findingsHaveRemediationOwners;
      assessmentAgeDays =
        asNum(data.assessmentAgeDays) ??
        daysSince(
          (data.assessmentDate ||
            data.assessedOn ||
            data.reportDate) as string | undefined,
          now,
        ) ??
        assessmentAgeDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const systems =
        (data.level5Systems as unknown[]) ||
        (data.systems as unknown[]) ||
        [];
      if (Array.isArray(systems) && systems.length > 0) {
        level5SystemCount = level5SystemCount ?? systems.length;
        let missing = 0;
        for (const s of systems) {
          if (!s || typeof s !== "object") continue;
          const row = s as Record<string, unknown>;
          if (asBool(row.inScope) === false || asBool(row.covered) === false) {
            missing += 1;
          }
        }
        level5SystemsMissing = level5SystemsMissing ?? missing;
        if (coversAllLevel5Systems == null) {
          coversAllLevel5Systems = missing === 0;
        }
      }

      const findings = (data.findings as unknown[]) || [];
      if (Array.isArray(findings) && findings.length > 0) {
        let missingOwner = 0;
        for (const fnd of findings) {
          if (!fnd || typeof fnd !== "object") continue;
          const row = fnd as Record<string, unknown>;
          const owner =
            row.remediationOwner ||
            row.owner ||
            row.remediation_owner;
          if (!owner) missingOwner += 1;
        }
        if (findingsHaveRemediationOwners == null) {
          findingsHaveRemediationOwners = missingOwner === 0;
        }
      }

      if (asBool(data.cmpR3Complete) === true) {
        coversAllLevel5Systems = coversAllLevel5Systems ?? true;
        level5SystemsMissing = level5SystemsMissing ?? 0;
        level5SystemCount = level5SystemCount ?? 1;
        sampledCheckIdCount = sampledCheckIdCount ?? 1;
        findingsHaveRemediationOwners =
          findingsHaveRemediationOwners ?? true;
        assessmentAgeDays = assessmentAgeDays ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    coversAllLevel5Systems,
    level5SystemCount,
    level5SystemsMissing,
    sampledCheckIdCount,
    findingsHaveRemediationOwners,
    assessmentAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiIndependentAssessmentReport(opts: {
  assessedAt: string;
  signals: AiIndependentAssessmentReport["signals"];
  assessmentContextSignals: boolean;
  imported: AiIndependentAssessmentReport["importedResults"];
}): AiIndependentAssessmentReport {
  const notes: string[] = [];
  const assessmentSignalsPresent =
    opts.signals.assessment.found ||
    opts.signals.level5.found ||
    opts.signals.findings.found;

  if (
    !opts.assessmentContextSignals &&
    !assessmentSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No independent-assessment signals — CMP-R3 may be NOT_APPLICABLE if there are no Level-5 AI systems.",
    );
  }
  if (opts.signals.assessment.found) {
    notes.push(
      `Assessment refs: ${opts.signals.assessment.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (coversAll=${opts.imported.coversAllLevel5Systems}, l5=${opts.imported.level5SystemCount}, missing=${opts.imported.level5SystemsMissing}, sampledChecks=${opts.imported.sampledCheckIdCount}, owners=${opts.imported.findingsHaveRemediationOwners}, assessmentAgeDays=${opts.imported.assessmentAgeDays})`,
    );
  } else if (assessmentSignalsPresent) {
    notes.push(
      "Assessment signals alone are PARTIAL — import Level-5 coverage + sampled Check IDs + remediation owners + assessmentAgeDays≤365 (measuredAt ≤90d) under imports/ai-independent-assessment/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const assessmentFresh =
    opts.imported.assessmentAgeDays !== null &&
    opts.imported.assessmentAgeDays <= ASSESSMENT_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    IMPORT_MAX_AGE_DAYS,
  );
  const coverageOk = opts.imported.coversAllLevel5Systems === true;
  const sampledOk =
    opts.imported.sampledCheckIdCount !== null &&
    opts.imported.sampledCheckIdCount > 0;
  const ownersOk = opts.imported.findingsHaveRemediationOwners === true;
  const passOk =
    coverageOk && sampledOk && ownersOk && assessmentFresh && ageOk && importFresh;

  let statusHint: AiIndependentAssessmentReport["summary"]["statusHint"] =
    "not_demonstrated";
  let cmpR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllLevel5Systems === false ||
      (opts.imported.level5SystemsMissing !== null &&
        opts.imported.level5SystemsMissing > 0) ||
      (opts.imported.sampledCheckIdCount !== null &&
        opts.imported.sampledCheckIdCount <= 0) ||
      opts.imported.findingsHaveRemediationOwners === false ||
      (opts.imported.assessmentAgeDays !== null &&
        opts.imported.assessmentAgeDays > ASSESSMENT_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.assessmentContextSignals &&
    !assessmentSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpR3Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete Level-5 coverage, empty sample, missing remediation owners, stale assessment (>12 months), or evidence older than 90 days — CMP-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpR3Satisfied = true;
  } else if (assessmentSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpR3Satisfied = false;
    if (opts.imported.found) {
      if (!coverageOk) {
        notes.push("Import must show coversAllLevel5Systems=true.");
      }
      if (!sampledOk) {
        notes.push("Import must show sampledCheckIdCount>0 (or sampledCheckIds).");
      }
      if (!ownersOk) {
        notes.push("Import must show findingsHaveRemediationOwners=true.");
      }
      if (!assessmentFresh) {
        notes.push(
          `Import must show assessmentAgeDays≤${ASSESSMENT_MAX_AGE_DAYS}.`,
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-R3 PASS.",
        );
      }
    }
  } else if (opts.assessmentContextSignals) {
    statusHint = "not_demonstrated";
    cmpR3Satisfied = null;
    notes.push(
      "Assessment-context signals present but no independent/internal-audit report found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpR3Satisfied = null;
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
      assessmentSignalsPresent,
      cmpR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiIndependentAssessmentCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const assessmentContextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) =>
          PATH_RE.test(path) ||
          PATH_RE.test(text) ||
          LEVEL5_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      ASSESSMENT_RE.test(text) ||
      LEVEL5_RE.test(text);

    const assessmentRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ASSESSMENT_RE.test(path) || ASSESSMENT_RE.test(text)) &&
        inCtx(path, text),
    );
    const level5Refs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LEVEL5_RE.test(path) || LEVEL5_RE.test(text)) && inCtx(path, text),
      12,
    );
    const findingsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FINDINGS_RE.test(path) || FINDINGS_RE.test(text)) &&
        (ASSESSMENT_RE.test(text) || PATH_RE.test(path)),
      12,
    );

    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiIndependentAssessmentReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        assessment: { found: assessmentRefs.length > 0, refs: assessmentRefs },
        level5: { found: level5Refs.length > 0, refs: level5Refs },
        findings: { found: findingsRefs.length > 0, refs: findingsRefs },
      },
      assessmentContextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-independent-assessment-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-independent-assessment-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-independent-assessment",
          "cmp-r3",
          DETECTOR_ID,
          ...(report.summary.assessmentSignalsPresent
            ? ["assessment-signals"]
            : []),
          ...(report.summary.cmpR3Satisfied ? ["cmp-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...assessmentRefs.slice(0, 2),
      ...level5Refs.slice(0, 1),
      ...findingsRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-independent-assessment-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-R3 status=${report.summary.statusHint} assessment=${report.summary.assessmentSignalsPresent} satisfied=${report.summary.cmpR3Satisfied}; report=imports/${PLUGIN_ID}/ai-independent-assessment-report.json`,
      nodes,
    };
  },
};
