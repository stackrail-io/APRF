/**
 * ai-rto-rpo-catalog — REL-M5 / repo-ai-rto-rpo-catalog.
 *
 * Discovers BCP / service-catalog / DR docs with RTO+RPO for business-critical
 * AI services + restore/failover links.
 * Import continuityDocumentationConfigured + businessCriticalAiServiceCount≥1 +
 * businessCriticalAiServicesWithNumericRtoRpoPct=100 +
 * linkedToTestedRestoreOrFailoverProcedure under imports/ai-rto-rpo-catalog/
 * to unlock PASS (measuredAt ≤90d). Legacy criticalAiFeature* keys still accepted.
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

const PLUGIN_ID = "ai-rto-rpo-catalog";
const RELATED = ["REL-M5"] as const;
const DETECTOR_ID = "repo-ai-rto-rpo-catalog";
const IMPORT_MAX_AGE_DAYS = 90;
const COVERAGE_PCT_MIN = 100;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CONTINUITY_DOC_RE =
  /\b(rto[\s_-]*rpo|rpo[\s_-]*rto|business[\s_-]*continuity|bcp|service[\s_-]*catalog|disaster[\s_-]*recovery|dr[\s_-]*(plan|runbook|catalog|doc)|continuity[\s_-]*(plan|catalog|doc))\b/i;

const RTO_RE =
  /\b(rto|recovery[\s_-]*time[\s_-]*objective|time[\s_-]*to[\s_-]*recover)\b/i;

const RPO_RE =
  /\b(rpo|recovery[\s_-]*point[\s_-]*objective|data[\s_-]*loss[\s_-]*window)\b/i;

const RESTORE_FAILOVER_RE =
  /\b(restore[\s_-]*procedure|failover[\s_-]*procedure|failover[\s_-]*test|restore[\s_-]*test|dr[\s_-]*drill|disaster[\s_-]*recovery[\s_-]*test)\b/i;

const BUSINESS_CRITICAL_AI_RE =
  /\b(business[\s_-]*critical[\s_-]*ai|critical[\s_-]*ai[\s_-]*service|mission[\s_-]*critical[\s_-]*ai|tier[\s_-]*3[\s_-]*ai|critical[\s_-]*ai[\s_-]*capability)\b/i;

export interface AiRtoRpoCatalogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    continuityDoc: { found: boolean; refs: string[] };
    rto: { found: boolean; refs: string[] };
    rpo: { found: boolean; refs: string[] };
    restoreFailover: { found: boolean; refs: string[] };
    businessCriticalAi: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    continuityDocumentationConfigured: boolean | null;
    businessCriticalAiServiceCount: number | null;
    businessCriticalAiServicesWithNumericRtoRpoPct: number | null;
    linkedToTestedRestoreOrFailoverProcedure: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    continuitySignalsPresent: boolean;
    relM5Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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

function loadImported(
  ctx: CollectorContext,
): AiRtoRpoCatalogReport["importedResults"] {
  const sources: string[] = [];
  let continuityDocumentationConfigured: boolean | null = null;
  let businessCriticalAiServiceCount: number | null = null;
  let businessCriticalAiServicesWithNumericRtoRpoPct: number | null = null;
  let linkedToTestedRestoreOrFailoverProcedure: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-rto-rpo-catalog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      continuityDocumentationConfigured =
        asBool(data.continuityDocumentationConfigured) ??
        asBool(data.continuity_documentation_configured) ??
        asBool(data.rtoRpoCatalogConfigured) ??
        asBool(data.rto_rpo_catalog_configured) ??
        asBool(data.bcpDocumented) ??
        asBool(data.serviceCatalogDocumented) ??
        asBool(data.drDocumentationConfigured) ??
        asBool(data.catalogConfigured) ??
        continuityDocumentationConfigured;
      businessCriticalAiServiceCount =
        asNum(data.businessCriticalAiServiceCount) ??
        asNum(data.business_critical_ai_service_count) ??
        asNum(data.criticalAiFeatureCount) ??
        asNum(data.critical_ai_feature_count) ??
        asNum(data.criticalFeatureCount) ??
        businessCriticalAiServiceCount;
      businessCriticalAiServicesWithNumericRtoRpoPct =
        asNum(data.businessCriticalAiServicesWithNumericRtoRpoPct) ??
        asNum(data.business_critical_ai_services_with_numeric_rto_rpo_pct) ??
        asNum(data.criticalAiFeaturesWithNumericRtoRpoPct) ??
        asNum(data.critical_ai_features_with_numeric_rto_rpo_pct) ??
        asNum(data.coveragePct) ??
        businessCriticalAiServicesWithNumericRtoRpoPct;
      linkedToTestedRestoreOrFailoverProcedure =
        asBool(data.linkedToTestedRestoreOrFailoverProcedure) ??
        asBool(data.linked_to_tested_restore_or_failover_procedure) ??
        asBool(data.restoreOrFailoverLinkedAndTested) ??
        linkedToTestedRestoreOrFailoverProcedure;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    continuityDocumentationConfigured,
    businessCriticalAiServiceCount,
    businessCriticalAiServicesWithNumericRtoRpoPct,
    linkedToTestedRestoreOrFailoverProcedure,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiRtoRpoCatalogReport(opts: {
  assessedAt: string;
  continuityDoc: { found: boolean; refs: string[] };
  rto: { found: boolean; refs: string[] };
  rpo: { found: boolean; refs: string[] };
  restoreFailover: { found: boolean; refs: string[] };
  businessCriticalAi: { found: boolean; refs: string[] };
  imported: AiRtoRpoCatalogReport["importedResults"];
}): AiRtoRpoCatalogReport {
  const notes: string[] = [];
  const continuitySignalsPresent =
    opts.continuityDoc.found ||
    opts.rto.found ||
    opts.rpo.found ||
    opts.restoreFailover.found ||
    opts.businessCriticalAi.found;

  if (!continuitySignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI continuity/RTO/RPO signals — REL-M5 may be NOT_APPLICABLE if no business-critical AI services are in scope.",
    );
  }
  if (opts.continuityDoc.found) {
    notes.push(
      `Continuity-doc refs: ${opts.continuityDoc.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (docs=${opts.imported.continuityDocumentationConfigured}, services=${opts.imported.businessCriticalAiServiceCount}, coveragePct=${opts.imported.businessCriticalAiServicesWithNumericRtoRpoPct}, linked=${opts.imported.linkedToTestedRestoreOrFailoverProcedure})`,
    );
  } else if (continuitySignalsPresent) {
    notes.push(
      "Continuity signals alone are PARTIAL — import continuityDocumentationConfigured=true + businessCriticalAiServiceCount≥1 + businessCriticalAiServicesWithNumericRtoRpoPct=100 + linkedToTestedRestoreOrFailoverProcedure=true (measuredAt ≤90d) under imports/ai-rto-rpo-catalog/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const docsOk = opts.imported.continuityDocumentationConfigured === true;
  const serviceOk =
    opts.imported.businessCriticalAiServiceCount !== null &&
    opts.imported.businessCriticalAiServiceCount >= 1;
  const coverageOk =
    opts.imported.businessCriticalAiServicesWithNumericRtoRpoPct !== null &&
    opts.imported.businessCriticalAiServicesWithNumericRtoRpoPct >=
      COVERAGE_PCT_MIN;
  const linkedOk =
    opts.imported.linkedToTestedRestoreOrFailoverProcedure === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiRtoRpoCatalogReport["summary"]["statusHint"];
  let relM5Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.continuityDocumentationConfigured === false ||
      (typeof opts.imported.businessCriticalAiServiceCount === "number" &&
        opts.imported.businessCriticalAiServiceCount < 1) ||
      (typeof opts.imported.businessCriticalAiServicesWithNumericRtoRpoPct ===
        "number" &&
        opts.imported.businessCriticalAiServicesWithNumericRtoRpoPct <
          COVERAGE_PCT_MIN) ||
      opts.imported.linkedToTestedRestoreOrFailoverProcedure === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!continuitySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relM5Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relM5Satisfied = false;
    notes.push(
      "Imported evidence shows missing continuity/service-catalog/DR docs, zero business-critical AI services, coverage <100%, unlinked/untested restore/failover, or evidence older than 90 days — REL-M5 fail.",
    );
  } else if (
    (continuitySignalsPresent || opts.imported.found) &&
    docsOk &&
    serviceOk &&
    coverageOk &&
    linkedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relM5Satisfied = true;
  } else if (continuitySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relM5Satisfied = false;
    if (opts.imported.found && !docsOk) {
      notes.push("Import must show continuityDocumentationConfigured=true.");
    }
    if (opts.imported.found && !serviceOk) {
      notes.push("Import must show businessCriticalAiServiceCount≥1.");
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show businessCriticalAiServicesWithNumericRtoRpoPct=100.",
      );
    }
    if (opts.imported.found && !linkedOk) {
      notes.push(
        "Import must show linkedToTestedRestoreOrFailoverProcedure=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-M5 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relM5Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      continuityDoc: opts.continuityDoc,
      rto: opts.rto,
      rpo: opts.rpo,
      restoreFailover: opts.restoreFailover,
      businessCriticalAi: opts.businessCriticalAi,
    },
    importedResults: opts.imported,
    summary: {
      continuitySignalsPresent,
      relM5Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiRtoRpoCatalogCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const continuityDoc = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CONTINUITY_DOC_RE.test(path) || CONTINUITY_DOC_RE.test(text),
      10,
    );
    const rto = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RTO_RE.test(path) || RTO_RE.test(text)) &&
        (CONTINUITY_DOC_RE.test(path + text) ||
          BUSINESS_CRITICAL_AI_RE.test(path + text) ||
          /rpo|ai|continuity|dr|service/i.test(path + text)),
      8,
    );
    const rpo = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RPO_RE.test(path) || RPO_RE.test(text)) &&
        (CONTINUITY_DOC_RE.test(path + text) ||
          BUSINESS_CRITICAL_AI_RE.test(path + text) ||
          /rto|ai|continuity|dr|service/i.test(path + text)),
      8,
    );
    const restoreFailover = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        RESTORE_FAILOVER_RE.test(path) || RESTORE_FAILOVER_RE.test(text),
      8,
    );
    const businessCriticalAi = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        BUSINESS_CRITICAL_AI_RE.test(path) ||
        BUSINESS_CRITICAL_AI_RE.test(text),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiRtoRpoCatalogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      continuityDoc: { found: continuityDoc.length > 0, refs: continuityDoc },
      rto: { found: rto.length > 0, refs: rto },
      rpo: { found: rpo.length > 0, refs: rpo },
      restoreFailover: {
        found: restoreFailover.length > 0,
        refs: restoreFailover,
      },
      businessCriticalAi: {
        found: businessCriticalAi.length > 0,
        refs: businessCriticalAi,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-rto-rpo-catalog-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-rto-rpo-catalog-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-rto-rpo-catalog",
          "rel-m5",
          DETECTOR_ID,
          ...(report.summary.relM5Satisfied ? ["rel-m5-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.continuityDoc.refs,
        ...report.signals.rto.refs,
        ...report.signals.rpo.refs,
        ...report.signals.restoreFailover.refs,
        ...report.signals.businessCriticalAi.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-rto-rpo-catalog-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-M5 status=${report.summary.statusHint} signals=${report.summary.continuitySignalsPresent} satisfied=${report.summary.relM5Satisfied}; report=imports/${PLUGIN_ID}/ai-rto-rpo-catalog-report.json`,
      nodes,
    };
  },
};
