/**
 * ai-acceptable-use-policy — ORG-M1 / repo-ai-acceptable-use-policy.
 *
 * Discovers AI acceptable-use / prohibited-applications policies. Import
 * coverage under imports/ai-acceptable-use-policy/ to unlock PASS.
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

const PLUGIN_ID = "ai-acceptable-use-policy";
const RELATED = ["ORG-M1"] as const;
const DETECTOR_ID = "repo-ai-acceptable-use-policy";
const REVIEW_MAX_AGE_DAYS = 365;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(acceptable[\s_-]*use|prohibited[\s_-]*application|ai[\s_-]*policy|ai[\s_-]*governance|use[\s_-]*of[\s_-]*ai)/i;

const POLICY_RE =
  /\b(ai[\s_-]*policy|acceptable[\s_-]*use[\s_-]*policy|prohibited[\s_-]*applications?|ai[\s_-]*acceptable[\s_-]*use)\b/i;

const ACCEPTABLE_RE =
  /\b(acceptable[\s_-]*use|permitted[\s_-]*use|allowed[\s_-]*use[\s_-]*cases?)\b/i;

const PROHIBITED_RE =
  /\b(prohibited[\s_-]*applications?|forbidden[\s_-]*use|disallowed[\s_-]*use|banned[\s_-]*use[\s_-]*cases?)\b/i;

const META_RE =
  /\b(version|owner|reviewed|review[\s_-]*date|last[\s_-]*reviewed|policy[\s_-]*owner)\b/i;

export interface AiAcceptableUsePolicyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    policy: { found: boolean; refs: string[] };
    acceptableUse: { found: boolean; refs: string[] };
    prohibited: { found: boolean; refs: string[] };
    metadata: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    hasVersion: boolean | null;
    hasOwner: boolean | null;
    hasAcceptableUseSection: boolean | null;
    hasProhibitedApplicationsSection: boolean | null;
    reviewAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    policySignalsPresent: boolean;
    orgM1Satisfied: boolean | null;
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
      ".html",
      ".pdf",
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

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
): AiAcceptableUsePolicyReport["importedResults"] {
  const sources: string[] = [];
  let hasVersion: boolean | null = null;
  let hasOwner: boolean | null = null;
  let hasAcceptableUseSection: boolean | null = null;
  let hasProhibitedApplicationsSection: boolean | null = null;
  let reviewAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-acceptable-use-policy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      hasVersion =
        asBool(data.hasVersion) ??
        (asStr(data.version) ? true : null) ??
        hasVersion;
      hasOwner =
        asBool(data.hasOwner) ??
        (asStr(data.owner) || asStr(data.ownerId) ? true : null) ??
        hasOwner;
      hasAcceptableUseSection =
        asBool(data.hasAcceptableUseSection) ??
        asBool(data.acceptableUse) ??
        hasAcceptableUseSection;
      hasProhibitedApplicationsSection =
        asBool(data.hasProhibitedApplicationsSection) ??
        asBool(data.prohibitedApplications) ??
        hasProhibitedApplicationsSection;
      reviewAgeDays =
        asNum(data.reviewAgeDays) ??
        daysSince(
          asStr(data.reviewDate) ??
            asStr(data.reviewedAt) ??
            asStr(data.lastReviewed) ??
            undefined,
          now,
        ) ??
        reviewAgeDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.orgM1Complete) === true) {
        hasVersion = hasVersion ?? true;
        hasOwner = hasOwner ?? true;
        hasAcceptableUseSection = hasAcceptableUseSection ?? true;
        hasProhibitedApplicationsSection =
          hasProhibitedApplicationsSection ?? true;
        reviewAgeDays = reviewAgeDays ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    hasVersion,
    hasOwner,
    hasAcceptableUseSection,
    hasProhibitedApplicationsSection,
    reviewAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiAcceptableUsePolicyReport(opts: {
  assessedAt: string;
  signals: AiAcceptableUsePolicyReport["signals"];
  policyContextSignals: boolean;
  imported: AiAcceptableUsePolicyReport["importedResults"];
}): AiAcceptableUsePolicyReport {
  const notes: string[] = [];
  const policySignalsPresent =
    opts.signals.policy.found ||
    (opts.signals.acceptableUse.found && opts.signals.prohibited.found);

  if (
    !opts.policyContextSignals &&
    !policySignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI acceptable-use policy signals — ORG-M1 may be NOT_APPLICABLE if the organization does not use AI.",
    );
  }
  if (opts.signals.policy.found) {
    notes.push(
      `Policy refs: ${opts.signals.policy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (version=${opts.imported.hasVersion}, owner=${opts.imported.hasOwner}, acceptable=${opts.imported.hasAcceptableUseSection}, prohibited=${opts.imported.hasProhibitedApplicationsSection}, reviewAgeDays=${opts.imported.reviewAgeDays})`,
    );
  } else if (policySignalsPresent) {
    notes.push(
      "Policy signals alone are PARTIAL — import version + owner + both sections + review ≤12 months (measuredAt ≤90d) under imports/ai-acceptable-use-policy/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const reviewOk =
    opts.imported.reviewAgeDays !== null &&
    opts.imported.reviewAgeDays <= REVIEW_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    IMPORT_MAX_AGE_DAYS,
  );
  const sectionsOk =
    opts.imported.hasAcceptableUseSection === true &&
    opts.imported.hasProhibitedApplicationsSection === true;
  const metaOk =
    opts.imported.hasVersion === true && opts.imported.hasOwner === true;
  const passOk = metaOk && sectionsOk && reviewOk && ageOk && importFresh;

  let statusHint: AiAcceptableUsePolicyReport["summary"]["statusHint"] =
    "not_demonstrated";
  let orgM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.hasVersion === false ||
      opts.imported.hasOwner === false ||
      opts.imported.hasAcceptableUseSection === false ||
      opts.imported.hasProhibitedApplicationsSection === false ||
      (opts.imported.reviewAgeDays !== null &&
        opts.imported.reviewAgeDays > REVIEW_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.policyContextSignals &&
    !policySignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    orgM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    orgM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing version/owner/sections, stale review (>12 months), or evidence older than 90 days — ORG-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgM1Satisfied = true;
  } else if (policySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgM1Satisfied = false;
    if (opts.imported.found) {
      if (!metaOk) {
        notes.push("Import must show hasVersion=true and hasOwner=true.");
      }
      if (!sectionsOk) {
        notes.push(
          "Import must show hasAcceptableUseSection=true and hasProhibitedApplicationsSection=true.",
        );
      }
      if (!reviewOk) {
        notes.push(
          `Import must show reviewAgeDays≤${REVIEW_MAX_AGE_DAYS}.`,
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-M1 PASS.",
        );
      }
    }
  } else if (opts.policyContextSignals) {
    statusHint = "not_demonstrated";
    orgM1Satisfied = null;
    notes.push(
      "AI-policy context signals present but no acceptable-use / prohibited-applications policy found.",
    );
  } else {
    statusHint = "not_demonstrated";
    orgM1Satisfied = null;
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
      policySignalsPresent,
      orgM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiAcceptableUsePolicyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const policyContextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) || PATH_RE.test(text) || POLICY_RE.test(text);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (POLICY_RE.test(path) || POLICY_RE.test(text)) && inCtx(path, text),
    );
    const acceptableRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ACCEPTABLE_RE.test(path) || ACCEPTABLE_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const prohibitedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROHIBITED_RE.test(path) || PROHIBITED_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const metaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        META_RE.test(text) &&
        (POLICY_RE.test(text) || PATH_RE.test(path) || PATH_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiAcceptableUsePolicyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        policy: { found: policyRefs.length > 0, refs: policyRefs },
        acceptableUse: {
          found: acceptableRefs.length > 0,
          refs: acceptableRefs,
        },
        prohibited: { found: prohibitedRefs.length > 0, refs: prohibitedRefs },
        metadata: { found: metaRefs.length > 0, refs: metaRefs },
      },
      policyContextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-acceptable-use-policy-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-acceptable-use-policy-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-acceptable-use-policy",
          "org-m1",
          DETECTOR_ID,
          ...(report.summary.policySignalsPresent ? ["policy-signals"] : []),
          ...(report.summary.orgM1Satisfied ? ["org-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...policyRefs.slice(0, 2),
        ...acceptableRefs.slice(0, 1),
        ...prohibitedRefs.slice(0, 1),
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
        signals: ["ai-acceptable-use-policy-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-M1 status=${report.summary.statusHint} policy=${report.summary.policySignalsPresent} satisfied=${report.summary.orgM1Satisfied}; report=imports/${PLUGIN_ID}/ai-acceptable-use-policy-report.json`,
      nodes,
    };
  },
};
