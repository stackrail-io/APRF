/**
 * context-source-acl — CTX-M2 / repo-context-source-acl.
 *
 * Discovers source labeling + ACL checks on retrieved/tool context inclusion.
 * Import unauthorizedChunksIncluded=0 + unlabeledIncludedCount=0 under
 * imports/context-source-acl/ to unlock PASS.
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

const PLUGIN_ID = "context-source-acl";
const RELATED = ["CTX-M2"] as const;
const DETECTOR_ID = "repo-context-source-acl";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CTX_PATH_RE =
  /(context|rag|retriev|tool[_-]?(result|output)|chunk|assembl|prompt)/i;

const LABEL_RE =
  /\b(source[_-]?(label|type|tag)|chunk[_-]?(type|source|label)|provenance|citation|content[_-]?type|tool[_-]?result[_-]?label)\b/i;

const ACL_RE =
  /\b(acl|access[_-]?(check|control)|authori[sz](e|ation)|permission|entitlement|document[_-]?acl|row[_-]?level|rbac|allowed[_-]?(docs|chunks)|unauthorized)\b/i;

const EXCLUSION_TEST_RE =
  /\b(exclud|deny|block|filter|unauthorized|acl[_-]?(fail|deny)|no[_-]?access|forbidden[_-]?chunk)\b/i;

export interface ContextSourceAclReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    labels: { found: boolean; refs: string[] };
    acl: { found: boolean; refs: string[] };
    exclusionTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    unauthorizedChunksIncluded: number | null;
    unlabeledIncludedCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    retrievalSignalsPresent: boolean;
    labelOrAclSignalsPresent: boolean;
    ctxM2Satisfied: boolean | null;
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

function detectRetrievalSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CTX_PATH_RE.test(path) ||
        /\b(retriev|vector[_-]?store|tool[_-]?result|rag|similarity[_-]?search)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextSourceAclReport["importedResults"] {
  const sources: string[] = [];
  let unauthorizedChunksIncluded: number | null = null;
  let unlabeledIncludedCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-source-acl-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      unauthorizedChunksIncluded =
        asNum(data.unauthorizedChunksIncluded) ??
        asNum(data.unauthorized_chunks_included) ??
        unauthorizedChunksIncluded;
      unlabeledIncludedCount =
        asNum(data.unlabeledIncludedCount) ??
        asNum(data.unlabeled_included_count) ??
        unlabeledIncludedCount;

      const unauthorizedRate = asNum(data.unauthorizedExclusionRatePct);
      if (unauthorizedRate === 100 && unauthorizedChunksIncluded === null) {
        unauthorizedChunksIncluded = 0;
      }
      const labeledRate = asNum(data.labeledChunkRatePct);
      if (labeledRate === 100 && unlabeledIncludedCount === null) {
        unlabeledIncludedCount = 0;
      }
      if (asBool(data.unauthorizedExcludedAt100) === true) {
        unauthorizedChunksIncluded = 0;
      }
      if (asBool(data.allIncludedChunksLabeled) === true) {
        unlabeledIncludedCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    unauthorizedChunksIncluded,
    unlabeledIncludedCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextSourceAclReport(opts: {
  assessedAt: string;
  labels: { found: boolean; refs: string[] };
  acl: { found: boolean; refs: string[] };
  exclusionTests: { found: boolean; refs: string[] };
  retrievalSignals: boolean;
  imported: ContextSourceAclReport["importedResults"];
}): ContextSourceAclReport {
  const notes: string[] = [];
  const labelOrAclSignalsPresent = opts.labels.found || opts.acl.found;

  if (
    !opts.retrievalSignals &&
    !labelOrAclSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No retrieval/tool-context signals — CTX-M2 may be NOT_APPLICABLE if context has no retrieved or tool-sourced content.",
    );
  }
  if (opts.labels.found) {
    notes.push(`Source-label refs: ${opts.labels.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No source-label/type signals found on context assembly paths.");
  }
  if (opts.acl.found) {
    notes.push(`ACL/access-check refs: ${opts.acl.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No ACL/access-check signals found on retrieval/tool inclusion.");
  }
  if (opts.exclusionTests.found) {
    notes.push(
      `Exclusion-test refs: ${opts.exclusionTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (unauthorizedIncluded=${opts.imported.unauthorizedChunksIncluded}, unlabeled=${opts.imported.unlabeledIncludedCount})`,
    );
  } else if (labelOrAclSignalsPresent) {
    notes.push(
      "Label/ACL signals alone are PARTIAL — import unauthorizedChunksIncluded=0 and unlabeledIncludedCount=0 (measuredAt ≤90d) under imports/context-source-acl/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const unauthorizedOk =
    opts.imported.unauthorizedChunksIncluded !== null &&
    opts.imported.unauthorizedChunksIncluded === 0;
  const labeledOk =
    opts.imported.unlabeledIncludedCount !== null &&
    opts.imported.unlabeledIncludedCount === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextSourceAclReport["summary"]["statusHint"] =
    "not_demonstrated";
  let ctxM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.unauthorizedChunksIncluded !== null &&
      opts.imported.unauthorizedChunksIncluded > 0) ||
      (opts.imported.unlabeledIncludedCount !== null &&
        opts.imported.unlabeledIncludedCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.retrievalSignals &&
    !labelOrAclSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    ctxM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxM2Satisfied = false;
    notes.push(
      "Imported evidence shows unauthorized inclusions, unlabeled chunks, or evidence older than 90 days — CTX-M2 fail.",
    );
  } else if (
    labelOrAclSignalsPresent &&
    unauthorizedOk &&
    labeledOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxM2Satisfied = true;
  } else if (
    labelOrAclSignalsPresent ||
    opts.exclusionTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    ctxM2Satisfied = false;
    if (opts.imported.found && !unauthorizedOk) {
      notes.push("Import must show unauthorizedChunksIncluded=0.");
    }
    if (opts.imported.found && !labeledOk) {
      notes.push("Import must show unlabeledIncludedCount=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-M2 PASS.",
      );
    }
  } else if (opts.retrievalSignals) {
    statusHint = "not_demonstrated";
    ctxM2Satisfied = null;
    notes.push(
      "Retrieval/tool signals present but no source-label or ACL inclusion evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      labels: opts.labels,
      acl: opts.acl,
      exclusionTests: opts.exclusionTests,
    },
    importedResults: opts.imported,
    summary: {
      retrievalSignalsPresent: opts.retrievalSignals,
      labelOrAclSignalsPresent,
      ctxM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextSourceAclCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const retrievalSignals = detectRetrievalSignals(ctx.targetPath, maxFiles);

    const labelRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!LABEL_RE.test(path) && !LABEL_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          LABEL_RE.test(path)
        );
      },
    );
    const aclRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!ACL_RE.test(path) && !ACL_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          ACL_RE.test(path)
        );
      },
    );
    const exclusionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture)/i.test(path) &&
        (ACL_RE.test(text) || LABEL_RE.test(text) || CTX_PATH_RE.test(text)) &&
        EXCLUSION_TEST_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildContextSourceAclReport({
      assessedAt: ctx.assessedAt.toISOString(),
      labels: { found: labelRefs.length > 0, refs: labelRefs },
      acl: { found: aclRefs.length > 0, refs: aclRefs },
      exclusionTests: { found: exclusionRefs.length > 0, refs: exclusionRefs },
      retrievalSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-source-acl-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/context-source-acl-report.json`,
        signals: [
          "context-source-acl",
          "ctx-m2",
          DETECTOR_ID,
          ...(report.summary.ctxM2Satisfied ? ["ctx-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.labels.refs,
        ...report.signals.acl.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        signals: ["context-source-acl-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-M2 status=${report.summary.statusHint} signals=${report.summary.labelOrAclSignalsPresent} satisfied=${report.summary.ctxM2Satisfied}; report=imports/${PLUGIN_ID}/context-source-acl-report.json`,
      nodes,
    };
  },
};
