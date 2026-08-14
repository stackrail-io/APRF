/**
 * ai-iac-cis-policy — INF-R3 / repo-ai-iac-cis-policy.
 *
 * Discovers production-AI IaC + CIS-aligned (or equivalent) policy-scan signals
 * and apply/PR wiring. Import coverage under imports/ai-iac-cis-policy/ to
 * unlock PASS (measuredAt ≤90d). N/A when no production AI infrastructure is
 * managed. Sample Terraform / CSPM exposure scans alone ≠ PASS.
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
import { withReportEvidenceTypes } from "./lib/evidence-types.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMaxNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-iac-cis-policy";
const RELATED = ["INF-R3"] as const;
const DETECTOR_ID = "repo-ai-iac-cis-policy";
const IMPORT_MAX_AGE_DAYS = 90;

const IAC_RE =
  /\b(terraform|pulumi|cloudformation|\.tf\b|cdk|helm|kustomize|infra[_-]?as[_-]?code|bicep)\b/i;

const PROD_AI_IAC_RE =
  /\b(production[_-]?(ai|ml)|prod[_-]?(ai|ml)|sagemaker|vertex[_-]?ai|bedrock|azure[_-]?openai|model[_-]?(serving|endpoint)|inference[_-]?(cluster|service|stack)|gpu[_-]?node|ai[_-]?(infra|platform|stack)|ml[_-]?(infra|platform|ops)|llm[_-]?(infra|serving)|eks|gke|aks)\b/i;

const POLICY_SCAN_RE =
  /\b(checkov|tfsec|terrascan|kics|trivy[_-]?(config|iac)|cis[_-]?(benchmark|policy|aligned)|terraform[_-]?compliance|sentinel|conftest|opa[_-]?policy|policy[_-]?as[_-]?code)\b/i;

const CI_WIRE_RE =
  /\b(checkov|tfsec|terrascan|kics|trivy|conftest|terraform[_-]?plan|atlantis|terraform[_-]?apply|pulumi[_-]?(up|preview)|on:\s*pull_request|pull_request:)\b/i;

export interface AiIacCisPolicyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    iacModules: { found: boolean; refs: string[] };
    productionAiIac: { found: boolean; refs: string[] };
    cisPolicyScanConfig: { found: boolean; refs: string[] };
    ciApplyOrPrWiring: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiInfrastructurePresent: boolean | null;
    iacCoversProductionAiInfrastructure: boolean | null;
    cisAlignedPolicyChecksOnEveryApplyOrPr: boolean | null;
    policyScanReportPresent: boolean | null;
    openCriticalFindingsUnwaived: number | null;
    criticalFindingsClosedOrWaivedWithOwnerAndExpiry: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    infR3Satisfied: boolean | null;
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

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
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
    extensions: [...SCAN_EXTENSIONS, ".tf", ".hcl", ".bicep"],
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
): AiIacCisPolicyReport["importedResults"] {
  const sources: string[] = [];
  let productionAiInfrastructurePresent: boolean | null = null;
  let iacCoversProductionAiInfrastructure: boolean | null = null;
  let cisAlignedPolicyChecksOnEveryApplyOrPr: boolean | null = null;
  let policyScanReportPresent: boolean | null = null;
  let openCriticalFindingsUnwaived: number | null = null;
  let criticalFindingsClosedOrWaivedWithOwnerAndExpiry: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-iac-cis-policy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAiInfrastructurePresent = mergeOrBool(
        productionAiInfrastructurePresent,
        asBool(data.productionAiInfrastructurePresent) ??
          asBool(data.production_ai_infrastructure_present) ??
          asBool(data.productionAiInfraPresent),
      );
      iacCoversProductionAiInfrastructure = mergeAndBool(
        iacCoversProductionAiInfrastructure,
        asBool(data.iacCoversProductionAiInfrastructure) ??
          asBool(data.iac_covers_production_ai_infrastructure) ??
          asBool(data.iacCoversProdAi),
      );
      cisAlignedPolicyChecksOnEveryApplyOrPr = mergeAndBool(
        cisAlignedPolicyChecksOnEveryApplyOrPr,
        asBool(data.cisAlignedPolicyChecksOnEveryApplyOrPr) ??
          asBool(data.cis_aligned_policy_checks_on_every_apply_or_pr) ??
          asBool(data.cisPolicyOnApplyOrPr),
      );
      policyScanReportPresent = mergeAndBool(
        policyScanReportPresent,
        asBool(data.policyScanReportPresent) ??
          asBool(data.policy_scan_report_present) ??
          asBool(data.latestPolicyScanReportPresent),
      );
      openCriticalFindingsUnwaived = mergeMaxNum(
        openCriticalFindingsUnwaived,
        asNum(data.openCriticalFindingsUnwaived) ??
          asNum(data.open_critical_findings_unwaived) ??
          asNum(data.openCriticalFindings),
      );
      criticalFindingsClosedOrWaivedWithOwnerAndExpiry = mergeAndBool(
        criticalFindingsClosedOrWaivedWithOwnerAndExpiry,
        asBool(data.criticalFindingsClosedOrWaivedWithOwnerAndExpiry) ??
          asBool(data.critical_findings_closed_or_waived_with_owner_and_expiry) ??
          asBool(data.criticalFindingsDispositioned),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiInfrastructurePresent,
    iacCoversProductionAiInfrastructure,
    cisAlignedPolicyChecksOnEveryApplyOrPr,
    policyScanReportPresent,
    openCriticalFindingsUnwaived,
    criticalFindingsClosedOrWaivedWithOwnerAndExpiry,
    measuredAt,
    sources,
  };
}

export function buildAiIacCisPolicyReport(opts: {
  assessedAt: string;
  iacModules: { found: boolean; refs: string[] };
  productionAiIac: { found: boolean; refs: string[] };
  cisPolicyScanConfig: { found: boolean; refs: string[] };
  ciApplyOrPrWiring: { found: boolean; refs: string[] };
  imported: AiIacCisPolicyReport["importedResults"];
}): AiIacCisPolicyReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.iacModules.found ||
    opts.productionAiIac.found ||
    opts.cisPolicyScanConfig.found ||
    opts.ciApplyOrPrWiring.found;
  // Only production-AI IaC proves the INF-R3 surface for N/A override —
  // bare policy-scan configs or sample Terraform must not block N/A.
  const surfaceProvedForNaOverride = opts.productionAiIac.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No production-AI IaC / CIS policy-scan signals — INF-R3 remains not demonstrated until IaC covering production AI + CIS-aligned policy checks on apply/PR with a fresh report, or an explicit N/A attest (productionAiInfrastructurePresent=false), is imported.",
    );
  }
  if (opts.iacModules.found) {
    notes.push(
      `IaC refs: ${opts.iacModules.refs.slice(0, 3).join(", ")}${opts.productionAiIac.found ? "" : "; sample IaC without production-AI coverage does not unlock PASS"}`,
    );
  }
  if (opts.productionAiIac.found) {
    notes.push(
      `Production-AI IaC refs: ${opts.productionAiIac.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.cisPolicyScanConfig.found) {
    notes.push(
      `CIS/policy-scan refs: ${opts.cisPolicyScanConfig.refs.slice(0, 3).join(", ")}; config alone does not satisfy INF-R3.`,
    );
  }
  if (opts.ciApplyOrPrWiring.found) {
    notes.push(
      `Apply/PR wiring refs: ${opts.ciApplyOrPrWiring.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.productionAiInfrastructurePresent}, iacCovers=${opts.imported.iacCoversProductionAiInfrastructure}, cisOnApply=${opts.imported.cisAlignedPolicyChecksOnEveryApplyOrPr}, report=${opts.imported.policyScanReportPresent}, openCritical=${opts.imported.openCriticalFindingsUnwaived}, waived=${opts.imported.criticalFindingsClosedOrWaivedWithOwnerAndExpiry}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import production-AI IaC coverage (or productionAiInfrastructurePresent=true + iacCoversProductionAiInfrastructure=true) plus cisAlignedPolicyChecksOnEveryApplyOrPr=true + policyScanReportPresent=true + openCriticalFindingsUnwaived=0 (or criticalFindingsClosedOrWaivedWithOwnerAndExpiry=true) with measuredAt ≤90d under imports/ai-iac-cis-policy/ to PASS. Set productionAiInfrastructurePresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopePresent =
    opts.imported.productionAiInfrastructurePresent === true;
  // PASS requires production-AI IaC coverage — generic Terraform / policy
  // config alone must not unlock INF-R3 even with perfect import metrics.
  const inventoryPresent =
    opts.productionAiIac.found ||
    (scopePresent &&
      opts.imported.iacCoversProductionAiInfrastructure === true);

  const iacOk =
    opts.productionAiIac.found ||
    opts.imported.iacCoversProductionAiInfrastructure === true;
  const cisOk = opts.imported.cisAlignedPolicyChecksOnEveryApplyOrPr === true;
  const reportOk = opts.imported.policyScanReportPresent === true;
  const findingsOk =
    opts.imported.openCriticalFindingsUnwaived === 0 ||
    opts.imported.criticalFindingsClosedOrWaivedWithOwnerAndExpiry === true;

  let statusHint: AiIacCisPolicyReport["summary"]["statusHint"];
  let infR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !(
      opts.imported.productionAiInfrastructurePresent === false &&
      !surfaceProvedForNaOverride
    ) &&
    (opts.imported.iacCoversProductionAiInfrastructure === false ||
      opts.imported.cisAlignedPolicyChecksOnEveryApplyOrPr === false ||
      opts.imported.policyScanReportPresent === false ||
      (opts.imported.openCriticalFindingsUnwaived !== null &&
        opts.imported.openCriticalFindingsUnwaived > 0 &&
        opts.imported.criticalFindingsClosedOrWaivedWithOwnerAndExpiry !==
          true));

  if (
    opts.imported.found &&
    opts.imported.productionAiInfrastructurePresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    infR3Satisfied = null;
    notes.push(
      "Imported productionAiInfrastructurePresent=false — INF-R3 NOT_APPLICABLE (organization manages no production AI infrastructure).",
    );
  } else if (
    opts.imported.productionAiInfrastructurePresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAiInfrastructurePresent=false ignored — in-repo production-AI IaC proves the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      infR3Satisfied = false;
      notes.push(
        "Imported evidence shows missing IaC coverage, missing CIS-on-apply/PR, missing report, or open unwaived critical findings — INF-R3 fail.",
      );
    } else if (
      inventoryPresent &&
      iacOk &&
      cisOk &&
      reportOk &&
      findingsOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      infR3Satisfied = true;
    } else {
      statusHint = "partial";
      infR3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    infR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    infR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing IaC coverage, missing CIS-on-apply/PR, missing report, or open unwaived critical findings — INF-R3 fail.",
    );
  } else if (
    inventoryPresent &&
    iacOk &&
    cisOk &&
    reportOk &&
    findingsOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    infR3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    infR3Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires production AI IaC coverage (in-repo production-AI IaC or productionAiInfrastructurePresent=true + iacCoversProductionAiInfrastructure=true) — sample Terraform / policy-scan signals alone are insufficient.",
      );
    }
    if (opts.imported.found && !iacOk) {
      notes.push("Import must show iacCoversProductionAiInfrastructure=true.");
    }
    if (opts.imported.found && !cisOk) {
      notes.push(
        "Import must show cisAlignedPolicyChecksOnEveryApplyOrPr=true.",
      );
    }
    if (opts.imported.found && !reportOk) {
      notes.push("Import must show policyScanReportPresent=true.");
    }
    if (opts.imported.found && !findingsOk) {
      notes.push(
        "Import must show openCriticalFindingsUnwaived=0 or criticalFindingsClosedOrWaivedWithOwnerAndExpiry=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INF-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    infR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      iacModules: opts.iacModules,
      productionAiIac: opts.productionAiIac,
      cisPolicyScanConfig: opts.cisPolicyScanConfig,
      ciApplyOrPrWiring: opts.ciApplyOrPrWiring,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      infR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiIacCisPolicyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const iacRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => IAC_RE.test(path) || IAC_RE.test(text),
      12,
    );
    const prodAiIacRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        const hasIac = IAC_RE.test(path) || IAC_RE.test(text);
        const hasProdAi =
          PROD_AI_IAC_RE.test(path) || PROD_AI_IAC_RE.test(text);
        return hasIac && hasProdAi;
      },
      10,
    );
    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => POLICY_SCAN_RE.test(path) || POLICY_SCAN_RE.test(text),
      10,
    );
    const ciRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        const inCiPath =
          /\.github\/workflows\/|gitlab-ci|\.circleci\/|atlantis/i.test(path);
        return (
          (inCiPath && (POLICY_SCAN_RE.test(text) || CI_WIRE_RE.test(text))) ||
          CI_WIRE_RE.test(path) ||
          (POLICY_SCAN_RE.test(path) && inCiPath)
        );
      },
      10,
    );

    const imported = loadImported(ctx);
    const report = withReportEvidenceTypes(
      buildAiIacCisPolicyReport({
        assessedAt: ctx.assessedAt.toISOString(),
        iacModules: { found: iacRefs.length > 0, refs: iacRefs },
        productionAiIac: {
          found: prodAiIacRefs.length > 0,
          refs: prodAiIacRefs,
        },
        cisPolicyScanConfig: { found: policyRefs.length > 0, refs: policyRefs },
        ciApplyOrPrWiring: { found: ciRefs.length > 0, refs: ciRefs },
        imported,
      }),
      [
        ...(iacRefs.length || prodAiIacRefs.length || imported.found
          ? ["iac_module"]
          : []),
        ...(policyRefs.length || ciRefs.length || imported.found
          ? ["cis_policy_scan"]
          : []),
        ...(imported.found ? ["policy_scan_report"] : []),
      ],
    );

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-iac-cis-policy-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/ai-iac-cis-policy-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-iac-cis-policy",
          "inf-r3",
          DETECTOR_ID,
          ...(report.summary.infR3Satisfied ? ["inf-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.iacModules.refs,
        ...report.signals.productionAiIac.refs,
        ...report.signals.cisPolicyScanConfig.refs,
        ...report.signals.ciApplyOrPrWiring.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-iac-cis-policy-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INF-R3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.infR3Satisfied}; report=imports/${PLUGIN_ID}/ai-iac-cis-policy-report.json`,
      nodes,
    };
  },
};
