/**
 * context-structured-blocks — CTX-R3 / repo-context-structured-blocks.
 *
 * Discovers instruction vs data structured context sections + overwrite tests.
 * Import structuredSectionsEmitted + instructionOverwriteBlocked under
 * imports/context-structured-blocks/ to unlock PASS.
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

const PLUGIN_ID = "context-structured-blocks";
const RELATED = ["CTX-R3"] as const;
const DETECTOR_ID = "repo-context-structured-blocks";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CTX_PATH_RE =
  /(context|prompt|assembl|schema|template|message)/i;

const STRUCTURE_RE =
  /\b(structured[\s_-]*(context|block|section)|instruction[\s_-]*(block|section)|data[\s_-]*(block|section)|json[\s_-]*(schema|block)|xml[\s_-]*(schema|block)|content[\s_-]*blocks?)\b/i;

const SEPARATION_RE =
  /\b(separat(?:e|ion)|instruction[\s_-]*vs[\s_-]*data|system[\s_-]*vs[\s_-]*(user|data)|untrusted[\s_-]*data)\b/i;

const OVERWRITE_TEST_RE =
  /\b(overwrit|inject[\s_-]*into[\s_-]*system|cannot[\s_-]*override|instruction[\s_-]*immutable|red[\s_-]*team|prompt[\s_-]*injection)\b/i;

export interface ContextStructuredBlocksReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    structure: { found: boolean; refs: string[] };
    separation: { found: boolean; refs: string[] };
    overwriteTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    structuredSectionsEmitted: boolean | null;
    instructionOverwriteBlocked: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    contextSignalsPresent: boolean;
    structureSignalsPresent: boolean;
    ctxR3Satisfied: boolean | null;
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
      ".xml",
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

function detectContextSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CTX_PATH_RE.test(path) ||
        /\b(context[\s_-]*assembl|build[\s_-]*messages|prompt|rag)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextStructuredBlocksReport["importedResults"] {
  const sources: string[] = [];
  let structuredSectionsEmitted: boolean | null = null;
  let instructionOverwriteBlocked: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-structured-blocks-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      structuredSectionsEmitted =
        asBool(data.structuredSectionsEmitted) ??
        asBool(data.structured_sections_emitted) ??
        asBool(data.hasLabeledSections) ??
        structuredSectionsEmitted;
      instructionOverwriteBlocked =
        asBool(data.instructionOverwriteBlocked) ??
        asBool(data.instruction_overwrite_blocked) ??
        asBool(data.overwriteTestPassed) ??
        instructionOverwriteBlocked;

      if (asBool(data.passed) === true) {
        structuredSectionsEmitted = structuredSectionsEmitted ?? true;
        instructionOverwriteBlocked = instructionOverwriteBlocked ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    structuredSectionsEmitted,
    instructionOverwriteBlocked,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextStructuredBlocksReport(opts: {
  assessedAt: string;
  structure: { found: boolean; refs: string[] };
  separation: { found: boolean; refs: string[] };
  overwriteTests: { found: boolean; refs: string[] };
  contextSignals: boolean;
  imported: ContextStructuredBlocksReport["importedResults"];
}): ContextStructuredBlocksReport {
  const notes: string[] = [];
  const structureSignalsPresent =
    opts.structure.found || opts.separation.found;

  if (
    !opts.contextSignals &&
    !structureSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No structured-context signals — CTX-R3 may be NOT_APPLICABLE if context has no untrusted data sections.",
    );
  }
  if (opts.structure.found) {
    notes.push(`Structure refs: ${opts.structure.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No labeled structured instruction/data section signals found.");
  }
  if (opts.separation.found) {
    notes.push(
      `Separation refs: ${opts.separation.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.overwriteTests.found) {
    notes.push(
      `Overwrite-test refs: ${opts.overwriteTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (structured=${opts.imported.structuredSectionsEmitted}, overwriteBlocked=${opts.imported.instructionOverwriteBlocked})`,
    );
  } else if (structureSignalsPresent) {
    notes.push(
      "Structure signals alone are PARTIAL — import structuredSectionsEmitted + instructionOverwriteBlocked (measuredAt ≤90d) under imports/context-structured-blocks/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const structuredOk = opts.imported.structuredSectionsEmitted === true;
  const overwriteOk = opts.imported.instructionOverwriteBlocked === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextStructuredBlocksReport["summary"]["statusHint"] =
    "not_demonstrated";
  let ctxR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.structuredSectionsEmitted === false ||
      opts.imported.instructionOverwriteBlocked === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.contextSignals &&
    !structureSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    ctxR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing structured sections, overwrite not blocked, or evidence older than 90 days — CTX-R3 fail.",
    );
  } else if (
    (structureSignalsPresent || opts.imported.found) &&
    structuredOk &&
    overwriteOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxR3Satisfied = true;
  } else if (
    structureSignalsPresent ||
    opts.overwriteTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    ctxR3Satisfied = false;
    if (opts.imported.found && !structuredOk) {
      notes.push("Import must show structuredSectionsEmitted=true.");
    }
    if (opts.imported.found && !overwriteOk) {
      notes.push("Import must show instructionOverwriteBlocked=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-R3 PASS.",
      );
    }
  } else if (opts.contextSignals) {
    statusHint = "not_demonstrated";
    ctxR3Satisfied = null;
    notes.push(
      "Context signals present but no structured instruction/data separation evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      structure: opts.structure,
      separation: opts.separation,
      overwriteTests: opts.overwriteTests,
    },
    importedResults: opts.imported,
    summary: {
      contextSignalsPresent: opts.contextSignals,
      structureSignalsPresent,
      ctxR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextStructuredBlocksCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const contextSignals = detectContextSignals(ctx.targetPath, maxFiles);

    const structureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!STRUCTURE_RE.test(path) && !STRUCTURE_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          STRUCTURE_RE.test(path)
        );
      },
    );
    const separationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (STRUCTURE_RE.test(path) ||
          STRUCTURE_RE.test(text) ||
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text)) &&
        SEPARATION_RE.test(text),
      12,
    );
    const overwriteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture|redteam|red-team)/i.test(path) &&
        (STRUCTURE_RE.test(text) || SEPARATION_RE.test(text) || CTX_PATH_RE.test(text)) &&
        OVERWRITE_TEST_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildContextStructuredBlocksReport({
      assessedAt: ctx.assessedAt.toISOString(),
      structure: { found: structureRefs.length > 0, refs: structureRefs },
      separation: { found: separationRefs.length > 0, refs: separationRefs },
      overwriteTests: { found: overwriteRefs.length > 0, refs: overwriteRefs },
      contextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-structured-blocks-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/context-structured-blocks-report.json`,
        signals: [
          "context-structured-blocks",
          "ctx-r3",
          DETECTOR_ID,
          ...(report.summary.ctxR3Satisfied ? ["ctx-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of report.signals.structure.refs.slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:structure:${r}`,
        class: "code",
        ref: r,
        signals: ["context-structured-blocks-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-R3 status=${report.summary.statusHint} structure=${report.summary.structureSignalsPresent} satisfied=${report.summary.ctxR3Satisfied}; report=imports/${PLUGIN_ID}/context-structured-blocks-report.json`,
      nodes,
    };
  },
};
