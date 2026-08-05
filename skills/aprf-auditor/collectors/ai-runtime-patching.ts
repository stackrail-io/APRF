/**
 * ai-runtime-patching — INF-M2 / repo-ai-runtime-patching.
 *
 * Discovers patching-SLA, AI runtime inventory, CVE/age-scan, and waiver
 * signals. Import coverage under imports/ai-runtime-patching/ to unlock PASS
 * (measuredAt ≤90d). Pinning / :latest absence alone ≠ PASS.
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
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-runtime-patching";
const RELATED = ["INF-M2"] as const;
const DETECTOR_ID = "repo-ai-runtime-patching";
const IMPORT_MAX_AGE_DAYS = 90;

const SLA_RE =
  /\b(patch(ing)?[_-]?sla|patch[_-]?polic(y|ies)|vulnerability[_-]?remediation[_-]?(sla|policy)|critical[_-]?(fix|patch)[_-]?(within|window|sla)|image[_-]?patch[_-]?sla)\b/i;

const RUNTIME_INV_RE =
  /\b(ai[_-]?runtime[_-]?(inventory|environment)|production[_-]?(ai[_-]?)?runtime|sagemaker|vertex[_-]?ai|databricks|cloud[_-]?run|azure[_-]?container[_-]?apps|lambda[_-]?(ai|ml)|base[_-]?image[_-]?inventory|container[_-]?inventory|runtime[_-]?support[_-]?matrix)\b/i;

const CVE_AGE_RE =
  /\b(trivy|grype|docker[_-]?scout|ecr[_-]?(inspector|scan)|artifact[_-]?registry[_-]?scan|defender[_-]?for[_-]?containers|image[_-]?age|cve[_-]?(backlog|scan|report)|vulnerabilit(y|ies)[_-]?(scan|report|backlog)|supported[_-]?runtime)\b/i;

const WAIVER_RE =
  /\b(patch[_-]?waiver|sla[_-]?waiver|exception[_-]?register|time[_-]?boxed[_-]?(waiver|exception)|risk[_-]?acceptance[_-]?patch)\b/i;

export interface AiRuntimePatchingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    patchingSla: { found: boolean; refs: string[] };
    runtimeInventory: { found: boolean; refs: string[] };
    cveOrAgeScan: { found: boolean; refs: string[] };
    waivers: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiRuntimeEnvironmentsPresent: boolean | null;
    patchingSlaDocumented: boolean | null;
    productionAiRuntimesWithinDocumentedPatchingSlaPct: number | null;
    openSlaBreachesWithoutApprovedWaiver: number | null;
    vulnerabilityOrImageAgeReportPresent: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    infM2Satisfied: boolean | null;
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
    extensions: [
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".toml",
      ".tf",
    ],
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
): AiRuntimePatchingReport["importedResults"] {
  const sources: string[] = [];
  let productionAiRuntimeEnvironmentsPresent: boolean | null = null;
  let patchingSlaDocumented: boolean | null = null;
  let productionAiRuntimesWithinDocumentedPatchingSlaPct: number | null = null;
  let openSlaBreachesWithoutApprovedWaiver: number | null = null;
  let vulnerabilityOrImageAgeReportPresent: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-runtime-patching-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAiRuntimeEnvironmentsPresent = mergeOrBool(
        productionAiRuntimeEnvironmentsPresent,
        asBool(data.productionAiRuntimeEnvironmentsPresent) ??
          asBool(data.production_ai_runtime_environments_present) ??
          asBool(data.productionAiRuntimesPresent),
      );
      patchingSlaDocumented = mergeAndBool(
        patchingSlaDocumented,
        asBool(data.patchingSlaDocumented) ??
          asBool(data.patching_sla_documented) ??
          asBool(data.slaDocumented),
      );
      productionAiRuntimesWithinDocumentedPatchingSlaPct = mergeMinNum(
        productionAiRuntimesWithinDocumentedPatchingSlaPct,
        asNum(data.productionAiRuntimesWithinDocumentedPatchingSlaPct) ??
          asNum(
            data.production_ai_runtimes_within_documented_patching_sla_pct,
          ) ??
          asNum(data.withinSlaPct),
      );
      openSlaBreachesWithoutApprovedWaiver = mergeMaxNum(
        openSlaBreachesWithoutApprovedWaiver,
        asNum(data.openSlaBreachesWithoutApprovedWaiver) ??
          asNum(data.open_sla_breaches_without_approved_waiver) ??
          asNum(data.openSlaBreaches),
      );
      vulnerabilityOrImageAgeReportPresent = mergeAndBool(
        vulnerabilityOrImageAgeReportPresent,
        asBool(data.vulnerabilityOrImageAgeReportPresent) ??
          asBool(data.vulnerability_or_image_age_report_present) ??
          asBool(data.cveOrAgeReportPresent),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiRuntimeEnvironmentsPresent,
    patchingSlaDocumented,
    productionAiRuntimesWithinDocumentedPatchingSlaPct,
    openSlaBreachesWithoutApprovedWaiver,
    vulnerabilityOrImageAgeReportPresent,
    measuredAt,
    sources,
  };
}

export function buildAiRuntimePatchingReport(opts: {
  assessedAt: string;
  patchingSla: { found: boolean; refs: string[] };
  runtimeInventory: { found: boolean; refs: string[] };
  cveOrAgeScan: { found: boolean; refs: string[] };
  waivers: { found: boolean; refs: string[] };
  imported: AiRuntimePatchingReport["importedResults"];
}): AiRuntimePatchingReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.patchingSla.found ||
    opts.runtimeInventory.found ||
    opts.cveOrAgeScan.found ||
    opts.waivers.found;
  // Only runtime inventory proves the INF-M2 surface for N/A override —
  // bare SLA / CVE / waiver mentions must not launder present=false.
  const surfaceProvedForNaOverride = opts.runtimeInventory.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI runtime patching signals — INF-M2 remains not demonstrated until SLA + inventory/scan evidence or an explicit N/A attest (productionAiRuntimeEnvironmentsPresent=false) is imported.",
    );
  }
  if (opts.patchingSla.found) {
    notes.push(
      `Patching-SLA refs: ${opts.patchingSla.refs.slice(0, 3).join(", ")}; SLA docs alone do not satisfy INF-M2.`,
    );
  }
  if (opts.runtimeInventory.found) {
    notes.push(
      `Runtime-inventory refs: ${opts.runtimeInventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.cveOrAgeScan.found) {
    notes.push(
      `CVE/age-scan refs: ${opts.cveOrAgeScan.refs.slice(0, 3).join(", ")}; scan config alone does not prove SLA compliance.`,
    );
  }
  if (opts.waivers.found) {
    notes.push(
      `Waiver-register refs: ${opts.waivers.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.productionAiRuntimeEnvironmentsPresent}, slaDoc=${opts.imported.patchingSlaDocumented}, withinSlaPct=${opts.imported.productionAiRuntimesWithinDocumentedPatchingSlaPct}, openBreaches=${opts.imported.openSlaBreachesWithoutApprovedWaiver}, vulnReport=${opts.imported.vulnerabilityOrImageAgeReportPresent}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import inventory (or present=true) plus patchingSlaDocumented=true + productionAiRuntimesWithinDocumentedPatchingSlaPct=100 + openSlaBreachesWithoutApprovedWaiver=0 + vulnerabilityOrImageAgeReportPresent=true (measuredAt ≤90d) under imports/ai-runtime-patching/ to PASS. Set productionAiRuntimeEnvironmentsPresent=false for NOT_APPLICABLE. Tag pinning without SLA proof does not PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.productionAiRuntimeEnvironmentsPresent === false &&
    !surfaceProvedForNaOverride;
  const scopePresent =
    opts.imported.productionAiRuntimeEnvironmentsPresent === true;
  // PASS requires runtime inventory — SLA / CVE / waiver docs alone must not
  // unlock INF-M2 even with perfect import metrics.
  const inventoryPresent = opts.runtimeInventory.found || scopePresent;

  const slaDocOk = opts.imported.patchingSlaDocumented === true;
  const withinSlaOk =
    opts.imported.productionAiRuntimesWithinDocumentedPatchingSlaPct === 100;
  const breachesOk = opts.imported.openSlaBreachesWithoutApprovedWaiver === 0;
  const reportOk = opts.imported.vulnerabilityOrImageAgeReportPresent === true;

  let statusHint: AiRuntimePatchingReport["summary"]["statusHint"];
  let infM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.patchingSlaDocumented === false ||
      (opts.imported.productionAiRuntimesWithinDocumentedPatchingSlaPct !==
        null &&
        opts.imported.productionAiRuntimesWithinDocumentedPatchingSlaPct <
          100) ||
      (opts.imported.openSlaBreachesWithoutApprovedWaiver !== null &&
        opts.imported.openSlaBreachesWithoutApprovedWaiver > 0) ||
      opts.imported.vulnerabilityOrImageAgeReportPresent === false);

  if (
    opts.imported.found &&
    opts.imported.productionAiRuntimeEnvironmentsPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    infM2Satisfied = null;
    notes.push(
      "Imported productionAiRuntimeEnvironmentsPresent=false — INF-M2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAiRuntimeEnvironmentsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAiRuntimeEnvironmentsPresent=false ignored — in-repo AI runtime inventory proves the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      infM2Satisfied = false;
      notes.push(
        "Imported evidence shows missing SLA, within-SLA <100%, unwaived breaches, or missing vuln/age report — INF-M2 fail.",
      );
    } else if (
      inventoryPresent &&
      slaDocOk &&
      withinSlaOk &&
      breachesOk &&
      reportOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      infM2Satisfied = true;
    } else {
      statusHint = "partial";
      infM2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    infM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    infM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing SLA, within-SLA <100%, unwaived breaches, or missing vuln/age report — INF-M2 fail.",
    );
  } else if (
    inventoryPresent &&
    slaDocOk &&
    withinSlaOk &&
    breachesOk &&
    reportOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    infM2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    infM2Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires production AI runtime inventory (in-repo or productionAiRuntimeEnvironmentsPresent=true) — SLA/CVE/waiver signals alone are insufficient.",
      );
    }
    if (opts.imported.found && !slaDocOk) {
      notes.push("Import must show patchingSlaDocumented=true.");
    }
    if (opts.imported.found && !withinSlaOk) {
      notes.push(
        "Import must show productionAiRuntimesWithinDocumentedPatchingSlaPct=100.",
      );
    }
    if (opts.imported.found && !breachesOk) {
      notes.push(
        "Import must show openSlaBreachesWithoutApprovedWaiver=0.",
      );
    }
    if (opts.imported.found && !reportOk) {
      notes.push(
        "Import must show vulnerabilityOrImageAgeReportPresent=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INF-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    infM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      patchingSla: opts.patchingSla,
      runtimeInventory: opts.runtimeInventory,
      cveOrAgeScan: opts.cveOrAgeScan,
      waivers: opts.waivers,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      infM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiRuntimePatchingCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const slaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SLA_RE.test(path) || SLA_RE.test(text),
      10,
    );
    const invRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RUNTIME_INV_RE.test(path) || RUNTIME_INV_RE.test(text),
      10,
    );
    const cveRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CVE_AGE_RE.test(path) || CVE_AGE_RE.test(text),
      10,
    );
    const waiverRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => WAIVER_RE.test(path) || WAIVER_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiRuntimePatchingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      patchingSla: { found: slaRefs.length > 0, refs: slaRefs },
      runtimeInventory: { found: invRefs.length > 0, refs: invRefs },
      cveOrAgeScan: { found: cveRefs.length > 0, refs: cveRefs },
      waivers: { found: waiverRefs.length > 0, refs: waiverRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-runtime-patching-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/ai-runtime-patching-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-runtime-patching",
          "inf-m2",
          DETECTOR_ID,
          ...(report.summary.infM2Satisfied ? ["inf-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.patchingSla.refs,
        ...report.signals.runtimeInventory.refs,
        ...report.signals.cveOrAgeScan.refs,
        ...report.signals.waivers.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-runtime-patching-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INF-M2 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.infM2Satisfied}; report=imports/${PLUGIN_ID}/ai-runtime-patching-report.json`,
      nodes,
    };
  },
};
