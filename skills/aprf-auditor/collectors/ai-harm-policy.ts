/**
 * ai-harm-policy — SAF-M1 / repo-ai-harm-policy.
 *
 * Discovers domain-specific AI safety policies (harm categories +
 * refusal/escalation). Import hasVersion +
 * hasOwner + domainMinimumHarmCategoriesWithRefuseEscalateMapped +
 * reviewAgeDays≤365 under imports/ai-harm-policy/ to unlock PASS
 * (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-harm-policy";
const RELATED = ["SAF-M1"] as const;
const DETECTOR_ID = "repo-ai-harm-policy";
const REVIEW_MAX_AGE_DAYS = 365;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const TAXONOMY_RE =
  /\b(harm[_-]?(taxonomy|categories|policy)|content[_-]?safety[_-]?(policy|taxonomy)|refusal[_-]?(policy|matrix)|escalation[_-]?(policy|matrix)|refuse[_-]?(vs|versus|or)[_-]?escalate)\b/i;

const CATEGORY_RE =
  /\b(self[_-]?harm|csam|child[_-]?sexual|hate[_-]?speech|violence|fraud|illegal[_-]?activity|privacy[_-]?violation|harm[_-]?categor)\b/i;

const ACTION_RE =
  /\b(refuse|refusal|block|escalate|escalation|human[_-]?review|handoff)\b/i;

const META_RE =
  /\b(version|owner|reviewed|review[_-]?date|last[_-]?reviewed|policy[_-]?owner)\b/i;

export interface AiHarmPolicyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    taxonomy: { found: boolean; refs: string[] };
    categories: { found: boolean; refs: string[] };
    actions: { found: boolean; refs: string[] };
    metadata: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    hasVersion: boolean | null;
    hasOwner: boolean | null;
    domainMinimumHarmCategoriesWithRefuseEscalateMapped: boolean | null;
    reviewAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    policySignalsPresent: boolean;
    safM1Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".pdf", ".html"],
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

function loadImported(
  ctx: CollectorContext,
): AiHarmPolicyReport["importedResults"] {
  const sources: string[] = [];
  let hasVersion: boolean | null = null;
  let hasOwner: boolean | null = null;
  let domainMinimumHarmCategoriesWithRefuseEscalateMapped: boolean | null =
    null;
  let reviewAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-harm-policy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      reviewAgeDays =
        asNum(data.reviewAgeDays) ??
        asNum(data.review_age_days) ??
        asNum(data.policyReviewAgeDays) ??
        reviewAgeDays;
      hasVersion =
        asBool(data.hasVersion) ??
        asBool(data.has_version) ??
        asBool(data.versionPresent) ??
        hasVersion;
      hasOwner =
        asBool(data.hasOwner) ??
        asBool(data.has_owner) ??
        asBool(data.ownerPresent) ??
        hasOwner;
      domainMinimumHarmCategoriesWithRefuseEscalateMapped =
        asBool(
          data.domainMinimumHarmCategoriesWithRefuseEscalateMapped,
        ) ??
        asBool(
          data.domain_minimum_harm_categories_with_refuse_escalate_mapped,
        ) ??
        asBool(data.harmCategoriesMappedWithRefuseEscalate) ??
        asBool(data.taxonomyCoverageComplete) ??
        domainMinimumHarmCategoriesWithRefuseEscalateMapped;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    hasVersion,
    hasOwner,
    domainMinimumHarmCategoriesWithRefuseEscalateMapped,
    reviewAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiHarmPolicyReport(opts: {
  assessedAt: string;
  taxonomy: { found: boolean; refs: string[] };
  categories: { found: boolean; refs: string[] };
  actions: { found: boolean; refs: string[] };
  metadata: { found: boolean; refs: string[] };
  imported: AiHarmPolicyReport["importedResults"];
}): AiHarmPolicyReport {
  const notes: string[] = [];
  const policySignalsPresent =
    opts.taxonomy.found ||
    (opts.categories.found && opts.actions.found) ||
    opts.metadata.found;

  if (!policySignalsPresent && !opts.imported.found) {
    notes.push(
      "No domain-specific AI safety policy signals — SAF-M1 may be NOT_APPLICABLE if there is no AI user- or tool-facing behavior in scope.",
    );
  }
  if (opts.taxonomy.found) {
    notes.push(`Taxonomy refs: ${opts.taxonomy.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.categories.found) {
    notes.push(
      `Category refs: ${opts.categories.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.actions.found) {
    notes.push(`Action refs: ${opts.actions.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (version=${opts.imported.hasVersion}, owner=${opts.imported.hasOwner}, mapped=${opts.imported.domainMinimumHarmCategoriesWithRefuseEscalateMapped}, reviewAgeDays=${opts.imported.reviewAgeDays})`,
    );
  } else if (policySignalsPresent) {
    notes.push(
      "Policy signals alone are PARTIAL — import hasVersion=true + hasOwner=true + domainMinimumHarmCategoriesWithRefuseEscalateMapped=true + reviewAgeDays≤365 (measuredAt ≤90d) under imports/ai-harm-policy/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const reviewOk =
    opts.imported.reviewAgeDays !== null &&
    opts.imported.reviewAgeDays <= REVIEW_MAX_AGE_DAYS;
  const metaOk =
    opts.imported.hasVersion === true && opts.imported.hasOwner === true;
  const mappedOk =
    opts.imported.domainMinimumHarmCategoriesWithRefuseEscalateMapped === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiHarmPolicyReport["summary"]["statusHint"];
  let safM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.hasVersion === false ||
      opts.imported.hasOwner === false ||
      opts.imported.domainMinimumHarmCategoriesWithRefuseEscalateMapped ===
        false ||
      (opts.imported.reviewAgeDays !== null &&
        opts.imported.reviewAgeDays > REVIEW_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!policySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing version/owner/mappings, review older than 12 months, or attest older than 90 days — SAF-M1 fail.",
    );
  } else if (
    (policySignalsPresent || opts.imported.found) &&
    metaOk &&
    mappedOk &&
    reviewOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    safM1Satisfied = true;
  } else if (policySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safM1Satisfied = false;
    if (opts.imported.found && !metaOk) {
      notes.push("Import must show hasVersion=true and hasOwner=true.");
    }
    if (opts.imported.found && !mappedOk) {
      notes.push(
        "Import must show domainMinimumHarmCategoriesWithRefuseEscalateMapped=true.",
      );
    }
    if (opts.imported.found && !reviewOk) {
      notes.push("Import must show reviewAgeDays≤365.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      taxonomy: opts.taxonomy,
      categories: opts.categories,
      actions: opts.actions,
      metadata: opts.metadata,
    },
    importedResults: opts.imported,
    summary: {
      policySignalsPresent,
      safM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiHarmPolicyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const taxonomyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TAXONOMY_RE.test(path) || TAXONOMY_RE.test(text),
      10,
    );
    const categoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CATEGORY_RE.test(path) || CATEGORY_RE.test(text),
      10,
    );
    const actionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        ACTION_RE.test(path) ||
        (TAXONOMY_RE.test(path) && ACTION_RE.test(text)),
      10,
    );
    const metadataRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TAXONOMY_RE.test(path) || TAXONOMY_RE.test(text)) &&
        META_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiHarmPolicyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      taxonomy: { found: taxonomyRefs.length > 0, refs: taxonomyRefs },
      categories: { found: categoryRefs.length > 0, refs: categoryRefs },
      actions: { found: actionRefs.length > 0, refs: actionRefs },
      metadata: { found: metadataRefs.length > 0, refs: metadataRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-harm-policy-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-harm-policy-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-harm-policy",
          "saf-m1",
          DETECTOR_ID,
          ...(report.summary.safM1Satisfied ? ["saf-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.taxonomy.refs,
        ...report.signals.categories.refs,
        ...report.signals.actions.refs,
        ...report.signals.metadata.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-harm-policy-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-M1 status=${report.summary.statusHint} signals=${report.summary.policySignalsPresent} satisfied=${report.summary.safM1Satisfied}; report=imports/${PLUGIN_ID}/ai-harm-policy-report.json`,
      nodes,
    };
  },
};
