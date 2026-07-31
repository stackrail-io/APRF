/**
 * ai-control-evidence-matrix — CMP-M2 / repo-ai-control-evidence-matrix.
 *
 * Discovers control→evidence matrices for in-scope obligations. Import matrix
 * coverage under imports/ai-control-evidence-matrix/ to unlock PASS.
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

const PLUGIN_ID = "ai-control-evidence-matrix";
const RELATED = ["CMP-M2"] as const;
const DETECTOR_ID = "repo-ai-control-evidence-matrix";
const REVIEW_MAX_AGE_DAYS = 365;
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(control[\s_-]*evidence|evidence[\s_-]*matrix|obligation|compliance|control[\s_-]*map)/i;

const MATRIX_RE =
  /\b(control[\s_-]*(?:to[\s_-]*)?evidence|evidence[\s_-]*matrix|control[\s_-]*matrix|obligation[\s_-]*to[\s_-]*evidence|evidence[\s_-]*mapping)\b/i;

const EVIDENCE_ID_RE =
  /\b(evidence[\s_-]*(?:id|artifact)|artifact[\s_-]*id|aprf[\s_-]*check|check[\s_-]*id|control[\s_-]*id)\b/i;

const ORPHAN_RE =
  /\b(orphan[\s_-]*obligation|unmapped[\s_-]*obligation|missing[\s_-]*evidence|no[\s_-]*evidence[\s_-]*pointer)\b/i;

export interface AiControlEvidenceMatrixReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    matrix: { found: boolean; refs: string[] };
    evidenceIds: { found: boolean; refs: string[] };
    orphanHandling: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    inScopeObligationCount: number | null;
    coversAllInScopeObligations: boolean | null;
    orphanObligationCount: number | null;
    matrixReviewAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    matrixSignalsPresent: boolean;
    cmpM2Satisfied: boolean | null;
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
      ".csv",
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
): AiControlEvidenceMatrixReport["importedResults"] {
  const sources: string[] = [];
  let inScopeObligationCount: number | null = null;
  let coversAllInScopeObligations: boolean | null = null;
  let orphanObligationCount: number | null = null;
  let matrixReviewAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-control-evidence-matrix-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      inScopeObligationCount =
        asNum(data.inScopeObligationCount) ??
        asNum(data.obligationCount) ??
        inScopeObligationCount;
      coversAllInScopeObligations =
        asBool(data.coversAllInScopeObligations) ??
        asBool(data.coverageComplete) ??
        coversAllInScopeObligations;
      orphanObligationCount =
        asNum(data.orphanObligationCount) ??
        asNum(data.orphans) ??
        orphanObligationCount;
      matrixReviewAgeDays =
        asNum(data.matrixReviewAgeDays) ??
        asNum(data.reviewAgeDays) ??
        daysSince(
          (data.matrixReviewDate || data.reviewDate || data.reviewedAt) as
            | string
            | undefined,
          now,
        ) ??
        matrixReviewAgeDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const rows =
        (data.rows as unknown[]) ||
        (data.mappings as unknown[]) ||
        (data.obligations as unknown[]) ||
        [];
      if (Array.isArray(rows) && rows.length > 0) {
        inScopeObligationCount = inScopeObligationCount ?? rows.length;
        let orphans = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const r = row as Record<string, unknown>;
          const evidence =
            r.evidenceId ||
            r.evidenceIds ||
            r.artifactId ||
            r.checkId ||
            r.evidence;
          const hasEvidence =
            (typeof evidence === "string" && evidence.trim().length > 0) ||
            (Array.isArray(evidence) && evidence.length > 0) ||
            asBool(r.hasEvidence) === true;
          if (!hasEvidence) orphans += 1;
        }
        orphanObligationCount = orphanObligationCount ?? orphans;
        if (coversAllInScopeObligations == null) {
          coversAllInScopeObligations = orphans === 0;
        }
      }

      if (asBool(data.cmpM2Complete) === true) {
        coversAllInScopeObligations = coversAllInScopeObligations ?? true;
        orphanObligationCount = orphanObligationCount ?? 0;
        matrixReviewAgeDays = matrixReviewAgeDays ?? 0;
        inScopeObligationCount = inScopeObligationCount ?? 1;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    inScopeObligationCount,
    coversAllInScopeObligations,
    orphanObligationCount,
    matrixReviewAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiControlEvidenceMatrixReport(opts: {
  assessedAt: string;
  signals: AiControlEvidenceMatrixReport["signals"];
  complianceSignals: boolean;
  imported: AiControlEvidenceMatrixReport["importedResults"];
}): AiControlEvidenceMatrixReport {
  const notes: string[] = [];
  const matrixSignalsPresent =
    opts.signals.matrix.found ||
    (opts.signals.evidenceIds.found && opts.signals.orphanHandling.found);

  if (
    !opts.complianceSignals &&
    !matrixSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No control→evidence matrix signals — CMP-M2 may be NOT_APPLICABLE if there are no in-scope obligations.",
    );
  }
  if (opts.signals.matrix.found) {
    notes.push(
      `Matrix refs: ${opts.signals.matrix.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (obligations=${opts.imported.inScopeObligationCount}, covers=${opts.imported.coversAllInScopeObligations}, orphans=${opts.imported.orphanObligationCount}, reviewAgeDays=${opts.imported.matrixReviewAgeDays}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (matrixSignalsPresent) {
    notes.push(
      "Matrix signals alone are PARTIAL — import 100% coverage with 0 orphans and review ≤12 months (measuredAt ≤90d) under imports/ai-control-evidence-matrix/ to PASS.",
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
  const reviewOk =
    opts.imported.matrixReviewAgeDays !== null &&
    opts.imported.matrixReviewAgeDays <= REVIEW_MAX_AGE_DAYS;
  const passOk =
    opts.imported.coversAllInScopeObligations === true &&
    opts.imported.orphanObligationCount === 0 &&
    reviewOk &&
    ageOk &&
    importFresh;

  let statusHint: AiControlEvidenceMatrixReport["summary"]["statusHint"] =
    "not_demonstrated";
  let cmpM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllInScopeObligations === false ||
      (opts.imported.orphanObligationCount !== null &&
        opts.imported.orphanObligationCount > 0) ||
      (opts.imported.matrixReviewAgeDays !== null &&
        opts.imported.matrixReviewAgeDays > REVIEW_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.complianceSignals &&
    !matrixSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpM2Satisfied = false;
    notes.push(
      "Imported matrix shows incomplete coverage, orphans, review older than 12 months, or evidence older than 90 days — CMP-M2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpM2Satisfied = true;
  } else if (matrixSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpM2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllInScopeObligations !== true) {
        notes.push("Import must show coversAllInScopeObligations=true.");
      }
      if (opts.imported.orphanObligationCount !== 0) {
        notes.push("Import must show orphanObligationCount=0.");
      }
      if (!reviewOk) {
        notes.push(
          "Import must show matrixReviewAgeDays≤365 (review within 12 months).",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-M2 PASS.",
        );
      }
    }
  } else if (opts.complianceSignals) {
    statusHint = "not_demonstrated";
    cmpM2Satisfied = null;
    notes.push(
      "Compliance signals present but no control→evidence matrix found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpM2Satisfied = null;
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
      matrixSignalsPresent,
      cmpM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiControlEvidenceMatrixCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const complianceSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) || PATH_RE.test(text) || MATRIX_RE.test(text);

    const matrixRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MATRIX_RE.test(path) || MATRIX_RE.test(text)) && inCtx(path, text),
    );
    const evidenceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (EVIDENCE_ID_RE.test(path) || EVIDENCE_ID_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const orphanRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ORPHAN_RE.test(path) || ORPHAN_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiControlEvidenceMatrixReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        matrix: { found: matrixRefs.length > 0, refs: matrixRefs },
        evidenceIds: { found: evidenceRefs.length > 0, refs: evidenceRefs },
        orphanHandling: { found: orphanRefs.length > 0, refs: orphanRefs },
      },
      complianceSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-control-evidence-matrix-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-control-evidence-matrix-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-control-evidence-matrix",
          "cmp-m2",
          DETECTOR_ID,
          ...(report.summary.matrixSignalsPresent ? ["matrix-signals"] : []),
          ...(report.summary.cmpM2Satisfied ? ["cmp-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...matrixRefs.slice(0, 2),
      ...evidenceRefs.slice(0, 1),
      ...orphanRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-control-evidence-matrix-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-M2 status=${report.summary.statusHint} matrix=${report.summary.matrixSignalsPresent} satisfied=${report.summary.cmpM2Satisfied}; report=imports/${PLUGIN_ID}/ai-control-evidence-matrix-report.json`,
      nodes,
    };
  },
};
