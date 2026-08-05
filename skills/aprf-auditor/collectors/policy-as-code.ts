/**
 * policy-as-code — AUTHZ-R1 / repo-policy-as-code detector executor.
 *
 * Discovers OPA/Cedar/IAM-as-code and CI/admission policy-check signals for
 * tool and model access. Import coverage under imports/policy-as-code/ to
 * unlock PASS (measuredAt ≤90d). Policy files alone ≠ PASS.
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
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "policy-as-code";
const DETECTOR_ID = "repo-policy-as-code";
const RELATED = ["AUTHZ-R1"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const POLICY_AS_CODE_RE =
  /\b(opa|open[_-]?policy|cedar|\.rego\b|iam[_-]?as[_-]?code|policy[_-]?as[_-]?code|conftest|gatekeeper|kyverno)\b/i;

const TOOL_MODEL_ACCESS_RE =
  /\b(tool[_-]?(access|allow|deny|policy|permission)|model[_-]?(access|allow|deny|policy|permission|rout)|mcp[_-]?(tool|allow)|function[_-]?call[_-]?(policy|allow))\b/i;

const CI_ADMISSION_RE =
  /\b(policy[_-]?check|conftest|opa[_-]?test|admission|validating[_-]?webhook|ci[_-]?policy|fail[_-]?on[_-]?deny)\b/i;

export interface PolicyAsCodeReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    policyAsCode: { found: boolean; refs: string[] };
    toolModelAccess: { found: boolean; refs: string[] };
    ciOrAdmission: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    toolOrModelAccessControlPresent: boolean | null;
    toolAndModelAccessRulesAsCode: boolean | null;
    ciOrAdmissionEnforcementPresent: boolean | null;
    lastFailingToPassingPolicyChangeShowsDenyWithin90Days: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authzR1Satisfied: boolean | null;
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
      ".rego",
      ".cedar",
      ".toml",
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
): PolicyAsCodeReport["importedResults"] {
  const sources: string[] = [];
  let toolOrModelAccessControlPresent: boolean | null = null;
  let toolAndModelAccessRulesAsCode: boolean | null = null;
  let ciOrAdmissionEnforcementPresent: boolean | null = null;
  let lastFailingToPassingPolicyChangeShowsDenyWithin90Days: boolean | null =
    null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/policy-as-code-report\.json$/i.test(f)) continue;
    if (!/\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const fileMeasuredAt = parseMeasuredAt(data);
      const present =
        asBool(data.toolOrModelAccessControlPresent) ??
        asBool(data.tool_or_model_access_control_present) ??
        asBool(data.hasToolOrModelAccessControl);
      // Do not accept generic policyAsCodePresent as a substitute for
      // tool-and-model access rules as code (too weak for AUTHZ-R1 PASS).
      const rulesAsCode =
        asBool(data.toolAndModelAccessRulesAsCode) ??
        asBool(data.tool_and_model_access_rules_as_code);
      const ciEnforcement =
        asBool(data.ciOrAdmissionEnforcementPresent) ??
        asBool(data.ci_or_admission_enforcement_present) ??
        asBool(data.ciPolicyCheckPresent);
      const denyEvidence =
        asBool(data.lastFailingToPassingPolicyChangeShowsDenyWithin90Days) ??
        asBool(
          data.last_failing_to_passing_policy_change_shows_deny_within_90_days,
        ) ??
        asBool(data.policyDenyEvidenceWithin90Days);
      measuredAt = mergeOldestMeasuredAt(measuredAt, fileMeasuredAt);
      toolOrModelAccessControlPresent = mergeOrBool(
        toolOrModelAccessControlPresent,
        present,
      );
      toolAndModelAccessRulesAsCode = mergeAndBool(
        toolAndModelAccessRulesAsCode,
        rulesAsCode,
      );
      ciOrAdmissionEnforcementPresent = mergeAndBool(
        ciOrAdmissionEnforcementPresent,
        ciEnforcement,
      );
      lastFailingToPassingPolicyChangeShowsDenyWithin90Days = mergeAndBool(
        lastFailingToPassingPolicyChangeShowsDenyWithin90Days,
        denyEvidence,
      );
      if (
        present !== null ||
        rulesAsCode !== null ||
        ciEnforcement !== null ||
        denyEvidence !== null ||
        fileMeasuredAt !== null
      ) {
        sources.push(basename(f));
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    toolOrModelAccessControlPresent,
    toolAndModelAccessRulesAsCode,
    ciOrAdmissionEnforcementPresent,
    lastFailingToPassingPolicyChangeShowsDenyWithin90Days,
    measuredAt,
    sources,
  };
}

export function buildPolicyAsCodeReport(opts: {
  assessedAt: string;
  policyAsCode: { found: boolean; refs: string[] };
  toolModelAccess: { found: boolean; refs: string[] };
  ciOrAdmission: { found: boolean; refs: string[] };
  imported: PolicyAsCodeReport["importedResults"];
}): PolicyAsCodeReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.policyAsCode.found ||
    opts.toolModelAccess.found ||
    opts.ciOrAdmission.found;
  // Only tool/model access-control signals prove the R1 surface for N/A
  // override — bare OPA/conftest mentions must not launder present=false → PASS.
  const surfaceProvedForNaOverride = opts.toolModelAccess.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No tool/model policy-as-code signals — AUTHZ-R1 remains not demonstrated until policy-as-code + CI/admission deny evidence or an explicit N/A attest (toolOrModelAccessControlPresent=false) is imported.",
    );
  }
  if (opts.policyAsCode.found) {
    notes.push(
      `Policy-as-code refs: ${opts.policyAsCode.refs.slice(0, 3).join(", ")}; policy files alone do not satisfy AUTHZ-R1.`,
    );
  }
  if (opts.toolModelAccess.found) {
    notes.push(
      `Tool/model access policy refs: ${opts.toolModelAccess.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.ciOrAdmission.found) {
    notes.push(
      `CI/admission policy-check refs: ${opts.ciOrAdmission.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.toolOrModelAccessControlPresent}, rulesAsCode=${opts.imported.toolAndModelAccessRulesAsCode}, ciOrAdmission=${opts.imported.ciOrAdmissionEnforcementPresent}, denyEvidence=${opts.imported.lastFailingToPassingPolicyChangeShowsDenyWithin90Days}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import toolAndModelAccessRulesAsCode=true + ciOrAdmissionEnforcementPresent=true + lastFailingToPassingPolicyChangeShowsDenyWithin90Days=true (measuredAt ≤90d) under imports/policy-as-code/ to PASS. Set toolOrModelAccessControlPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.toolOrModelAccessControlPresent === false &&
    !surfaceProvedForNaOverride;
  const scopePresent = opts.imported.toolOrModelAccessControlPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  const rulesOk = opts.imported.toolAndModelAccessRulesAsCode === true;
  const enforceOk = opts.imported.ciOrAdmissionEnforcementPresent === true;
  const denyOk =
    opts.imported.lastFailingToPassingPolicyChangeShowsDenyWithin90Days ===
    true;

  let statusHint: PolicyAsCodeReport["summary"]["statusHint"];
  let authzR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.toolAndModelAccessRulesAsCode === false ||
      opts.imported.ciOrAdmissionEnforcementPresent === false ||
      opts.imported.lastFailingToPassingPolicyChangeShowsDenyWithin90Days ===
        false);

  if (
    opts.imported.found &&
    opts.imported.toolOrModelAccessControlPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    authzR1Satisfied = null;
    notes.push(
      "Imported toolOrModelAccessControlPresent=false — AUTHZ-R1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.toolOrModelAccessControlPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported toolOrModelAccessControlPresent=false ignored — in-repo tool/model access-control signals prove the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      authzR1Satisfied = false;
    } else if (rulesOk && enforceOk && denyOk && importFresh) {
      statusHint = "pass";
      authzR1Satisfied = true;
    } else {
      statusHint = "partial";
      authzR1Satisfied = false;
      if (!importFresh && opts.imported.found) {
        notes.push(
          "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-R1 PASS.",
        );
      }
    }
  } else if (explicitFail) {
    statusHint = "fail";
    authzR1Satisfied = false;
    if (opts.imported.toolAndModelAccessRulesAsCode === false) {
      notes.push("toolAndModelAccessRulesAsCode=false.");
    }
    if (opts.imported.ciOrAdmissionEnforcementPresent === false) {
      notes.push("ciOrAdmissionEnforcementPresent=false.");
    }
    if (
      opts.imported.lastFailingToPassingPolicyChangeShowsDenyWithin90Days ===
      false
    ) {
      notes.push(
        "lastFailingToPassingPolicyChangeShowsDenyWithin90Days=false.",
      );
    }
  } else if (
    surfaceOk &&
    rulesOk &&
    enforceOk &&
    denyOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authzR1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authzR1Satisfied = false;
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authzR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      policyAsCode: opts.policyAsCode,
      toolModelAccess: opts.toolModelAccess,
      ciOrAdmission: opts.ciOrAdmission,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authzR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const policyAsCodeCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;
    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        POLICY_AS_CODE_RE.test(p) ||
        POLICY_AS_CODE_RE.test(t) ||
        /\.rego$/i.test(p) ||
        /\.cedar$/i.test(p),
    );
    const toolModelRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => TOOL_MODEL_ACCESS_RE.test(p) || TOOL_MODEL_ACCESS_RE.test(t),
    );
    const ciRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => CI_ADMISSION_RE.test(p) || CI_ADMISSION_RE.test(t),
    );
    const imported = loadImported(ctx);

    const report = buildPolicyAsCodeReport({
      assessedAt: ctx.assessedAt.toISOString(),
      policyAsCode: { found: policyRefs.length > 0, refs: policyRefs },
      toolModelAccess: { found: toolModelRefs.length > 0, refs: toolModelRefs },
      ciOrAdmission: { found: ciRefs.length > 0, refs: ciRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "policy-as-code-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/policy-as-code-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              imported: {
                rulesAsCode:
                  report.importedResults.toolAndModelAccessRulesAsCode,
                ciOrAdmission:
                  report.importedResults.ciOrAdmissionEnforcementPresent,
                denyEvidence:
                  report.importedResults
                    .lastFailingToPassingPolicyChangeShowsDenyWithin90Days,
                measuredAt: report.importedResults.measuredAt,
              },
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "policy-as-code",
          "authz-r1",
          DETECTOR_ID,
          `authz-r1-${report.summary.statusHint}`,
          ...(report.summary.authzR1Satisfied
            ? ["authz-r1-satisfied"]
            : ["authz-r1-fail-or-incomplete"]),
          ...(report.signals.ciOrAdmission.found ? ["ci-policy-check"] : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHZ-R1 status=${report.summary.statusHint} satisfied=${report.summary.authzR1Satisfied}; report=imports/${PLUGIN_ID}/policy-as-code-report.json`,
      nodes,
    };
  },
};
