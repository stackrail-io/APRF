/**
 * ai-user-rationale — EXP-R1 / repo-ai-user-rationale.
 *
 * Discovers material-decision catalogs + user-facing rationale coverage.
 * Import materialDecisionCatalogConfigured +
 * sampleCaseCount≥20 +
 * materialTypesWithUserRationalePct=100 +
 * rationaleGapsTrackedWithOwners under imports/ai-user-rationale/
 * to unlock PASS (measuredAt ≤90d).
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
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-user-rationale";
const RELATED = ["EXP-R1"] as const;
const DETECTOR_ID = "repo-ai-user-rationale";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_SAMPLE_CASES = 20;

const CATALOG_RE =
  /\b(decision[_-]?catalog|material[_-]?decision|automated[_-]?decision[_-]?(type|catalog)|decision[_-]?type[_-]?(registry|inventory))\b/i;

const RATIONALE_RE =
  /\b(user[_-]?facing[_-]?(rationale|reason|explanation)|rationale[_-]?(field|text|ui)|decision[_-]?reason|why[_-]?(this|decision)|explanation[_-]?(ui|panel|modal))\b/i;

const SAMPLE_RE =
  /\b(rationale[_-]?sample|20[_-]?case|coverage[_-]?sample|material[_-]?decision[_-]?sample|ui[_-]?rationale[_-]?(test|sample))\b/i;

export interface AiUserRationaleReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    catalog: { found: boolean; refs: string[] };
    rationale: { found: boolean; refs: string[] };
    sample: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    materialDecisionCatalogConfigured: boolean | null;
    sampleCaseCount: number | null;
    materialTypesWithUserRationalePct: number | null;
    rationaleGapsTrackedWithOwners: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    rationaleSignalsPresent: boolean;
    expR1Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".pdf"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): AiUserRationaleReport["importedResults"] {
  const sources: string[] = [];
  let materialDecisionCatalogConfigured: boolean | null = null;
  let sampleCaseCount: number | null = null;
  let materialTypesWithUserRationalePct: number | null = null;
  let rationaleGapsTrackedWithOwners: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-user-rationale-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      materialDecisionCatalogConfigured =
        asBool(data.materialDecisionCatalogConfigured) ??
        asBool(data.material_decision_catalog_configured) ??
        asBool(data.decisionCatalogConfigured) ??
        asBool(data.materialCatalogConfigured) ??
        materialDecisionCatalogConfigured;
      sampleCaseCount =
        asNum(data.sampleCaseCount) ??
        asNum(data.sample_case_count) ??
        asNum(data.sampleSize) ??
        asNum(data.casesSampled) ??
        sampleCaseCount;
      materialTypesWithUserRationalePct =
        asNum(data.materialTypesWithUserRationalePct) ??
        asNum(data.material_types_with_user_rationale_pct) ??
        asNum(data.rationaleCoveragePct) ??
        asNum(data.userRationaleCoveragePct) ??
        materialTypesWithUserRationalePct;
      rationaleGapsTrackedWithOwners =
        asBool(data.rationaleGapsTrackedWithOwners) ??
        asBool(data.rationale_gaps_tracked_with_owners) ??
        asBool(data.gapsTrackedWithOwners) ??
        asBool(data.noRationaleGaps) ??
        rationaleGapsTrackedWithOwners;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    materialDecisionCatalogConfigured,
    sampleCaseCount,
    materialTypesWithUserRationalePct,
    rationaleGapsTrackedWithOwners,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiUserRationaleReport(opts: {
  assessedAt: string;
  catalog: { found: boolean; refs: string[] };
  rationale: { found: boolean; refs: string[] };
  sample: { found: boolean; refs: string[] };
  imported: AiUserRationaleReport["importedResults"];
}): AiUserRationaleReport {
  const notes: string[] = [];
  const rationaleSignalsPresent =
    opts.catalog.found || opts.rationale.found || opts.sample.found;

  if (!rationaleSignalsPresent && !opts.imported.found) {
    notes.push(
      "No user-facing rationale signals — EXP-R1 may be NOT_APPLICABLE if there are no material automated decisions.",
    );
  }
  if (opts.catalog.found) {
    notes.push(`Catalog refs: ${opts.catalog.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.rationale.found) {
    notes.push(
      `Rationale refs: ${opts.rationale.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.sample.found) {
    notes.push(`Sample refs: ${opts.sample.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (catalog=${opts.imported.materialDecisionCatalogConfigured}, sample=${opts.imported.sampleCaseCount}, coveragePct=${opts.imported.materialTypesWithUserRationalePct}, gapsOwned=${opts.imported.rationaleGapsTrackedWithOwners})`,
    );
  } else if (rationaleSignalsPresent) {
    notes.push(
      "Rationale signals alone are PARTIAL — import materialDecisionCatalogConfigured=true + sampleCaseCount≥20 + materialTypesWithUserRationalePct=100 + rationaleGapsTrackedWithOwners=true (measuredAt ≤90d) under imports/ai-user-rationale/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const catalogOk = opts.imported.materialDecisionCatalogConfigured === true;
  const sampleOk =
    opts.imported.sampleCaseCount !== null &&
    opts.imported.sampleCaseCount >= MIN_SAMPLE_CASES;
  const coverageOk = opts.imported.materialTypesWithUserRationalePct === 100;
  const gapsOk = opts.imported.rationaleGapsTrackedWithOwners === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiUserRationaleReport["summary"]["statusHint"];
  let expR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.materialDecisionCatalogConfigured === false ||
      (opts.imported.sampleCaseCount !== null &&
        opts.imported.sampleCaseCount < MIN_SAMPLE_CASES) ||
      (opts.imported.materialTypesWithUserRationalePct !== null &&
        opts.imported.materialTypesWithUserRationalePct < 100) ||
      opts.imported.rationaleGapsTrackedWithOwners === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!rationaleSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing material-decision catalog, sample <20, coverage <100%, unowned gaps, or attest older than 90 days — EXP-R1 fail.",
    );
  } else if (
    (rationaleSignalsPresent || opts.imported.found) &&
    catalogOk &&
    sampleOk &&
    coverageOk &&
    gapsOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expR1Satisfied = true;
  } else if (rationaleSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expR1Satisfied = false;
    if (opts.imported.found && !catalogOk) {
      notes.push("Import must show materialDecisionCatalogConfigured=true.");
    }
    if (opts.imported.found && !sampleOk) {
      notes.push(`Import must show sampleCaseCount≥${MIN_SAMPLE_CASES}.`);
    }
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show materialTypesWithUserRationalePct=100.");
    }
    if (opts.imported.found && !gapsOk) {
      notes.push("Import must show rationaleGapsTrackedWithOwners=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      catalog: opts.catalog,
      rationale: opts.rationale,
      sample: opts.sample,
    },
    importedResults: opts.imported,
    summary: {
      rationaleSignalsPresent,
      expR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiUserRationaleCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const catalogRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CATALOG_RE.test(path) || CATALOG_RE.test(text),
      10,
    );
    const rationaleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RATIONALE_RE.test(path) || RATIONALE_RE.test(text),
      10,
    );
    const sampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        SAMPLE_RE.test(path) ||
        (/(sample|test|fixture|screenshot)/i.test(path) &&
          (SAMPLE_RE.test(text) || RATIONALE_RE.test(text))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiUserRationaleReport({
      assessedAt: ctx.assessedAt.toISOString(),
      catalog: { found: catalogRefs.length > 0, refs: catalogRefs },
      rationale: { found: rationaleRefs.length > 0, refs: rationaleRefs },
      sample: { found: sampleRefs.length > 0, refs: sampleRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-user-rationale-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-user-rationale-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-user-rationale",
          "exp-r1",
          DETECTOR_ID,
          ...(report.summary.expR1Satisfied ? ["exp-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.catalog.refs,
        ...report.signals.rationale.refs,
        ...report.signals.sample.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-user-rationale-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-R1 status=${report.summary.statusHint} signals=${report.summary.rationaleSignalsPresent} satisfied=${report.summary.expR1Satisfied}; report=imports/${PLUGIN_ID}/ai-user-rationale-report.json`,
      nodes,
    };
  },
};
