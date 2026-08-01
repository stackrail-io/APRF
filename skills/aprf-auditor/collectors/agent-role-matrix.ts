/**
 * agent-role-matrix — AUTHZ-M3 detector executor.
 *
 * Discovers role-matrix / least-privilege / access-review signals for agent
 * and automation identities. Import coverage under imports/agent-role-matrix/
 * to unlock PASS (measuredAt ≤90d). Code/docs alone ≠ PASS.
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
  mergeAndBool,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-role-matrix";
const RELATED = ["AUTHZ-M3"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AGENT_IDENTITY_RE =
  /\b(agent[_-]?(id|identity|role|service[_-]?account)|automation[_-]?(identity|role|principal)|service[_-]?account|workload[_-]?identity|bot[_-]?user)\b/i;

const ROLE_MATRIX_RE =
  /\b(role[_-]?matrix|iam[_-]?(role|policy)|permission[_-]?matrix|agent[_-]?roles|least[_-]?privilege|non[_-]?admin[_-]?default|rbac[_-]?(matrix|export))\b/i;

const ACCESS_REVIEW_RE =
  /\b(access[_-]?review|privilege[_-]?(escalat|review)|quarterly[_-]?access|entitlement[_-]?review|role[_-]?review)\b/i;

export interface AgentRoleMatrixReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    agentIdentities: { found: boolean; refs: string[] };
    roleMatrix: { found: boolean; refs: string[] };
    accessReview: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAgentOrAutomationIdentitiesPresent: boolean | null;
    identitiesInRoleMatrixWithNonAdminDefaultPct: number | null;
    accessReviewWithin90Days: boolean | null;
    unexplainedPrivilegeEscalations: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authzM3Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".toml",
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

function loadImported(
  ctx: CollectorContext,
): AgentRoleMatrixReport["importedResults"] {
  const sources: string[] = [];
  let productionAgentOrAutomationIdentitiesPresent: boolean | null = null;
  let identitiesInRoleMatrixWithNonAdminDefaultPct: number | null = null;
  let accessReviewWithin90Days: boolean | null = null;
  let unexplainedPrivilegeEscalations: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-role-matrix-report\.json$/i.test(f)) continue;
    if (!/\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const fileMeasuredAt = parseMeasuredAt(data);
      const present =
        asBool(data.productionAgentOrAutomationIdentitiesPresent) ??
        asBool(data.production_agent_or_automation_identities_present) ??
        asBool(data.hasProductionAgentOrAutomationIdentities);
      const matrixPct =
        asNum(data.identitiesInRoleMatrixWithNonAdminDefaultPct) ??
        asNum(data.identities_in_role_matrix_with_non_admin_default_pct) ??
        asNum(data.roleMatrixCoveragePct) ??
        asNum(data.nonAdminDefaultCoveragePct);
      const reviewAge =
        asNum(data.accessReviewAgeDays) ?? asNum(data.access_review_age_days);
      const reviewWithin =
        asBool(data.accessReviewWithin90Days) ??
        asBool(data.access_review_within_90_days) ??
        (reviewAge !== null ? reviewAge <= IMPORT_MAX_AGE_DAYS : null);
      const escalations =
        asNum(data.unexplainedPrivilegeEscalations) ??
        asNum(data.unexplained_privilege_escalations) ??
        asNum(data.privilegeEscalationsUnexplained);
      measuredAt = mergeOldestMeasuredAt(measuredAt, fileMeasuredAt);
      productionAgentOrAutomationIdentitiesPresent = mergeOrBool(
        productionAgentOrAutomationIdentitiesPresent,
        present,
      );
      identitiesInRoleMatrixWithNonAdminDefaultPct = mergeMinNum(
        identitiesInRoleMatrixWithNonAdminDefaultPct,
        matrixPct,
      );
      accessReviewWithin90Days = mergeAndBool(
        accessReviewWithin90Days,
        reviewWithin,
      );
      unexplainedPrivilegeEscalations = mergeMaxNum(
        unexplainedPrivilegeEscalations,
        escalations,
      );
      // Include every alias that feeds merges so silent pollution cannot occur.
      if (
        present !== null ||
        matrixPct !== null ||
        reviewWithin !== null ||
        escalations !== null ||
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
    productionAgentOrAutomationIdentitiesPresent,
    identitiesInRoleMatrixWithNonAdminDefaultPct,
    accessReviewWithin90Days,
    unexplainedPrivilegeEscalations,
    measuredAt,
    sources,
  };
}

export function buildAgentRoleMatrixReport(opts: {
  assessedAt: string;
  agentIdentities: { found: boolean; refs: string[] };
  roleMatrix: { found: boolean; refs: string[] };
  accessReview: { found: boolean; refs: string[] };
  imported: AgentRoleMatrixReport["importedResults"];
}): AgentRoleMatrixReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.agentIdentities.found ||
    opts.roleMatrix.found ||
    opts.accessReview.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No agent/automation role-matrix signals — AUTHZ-M3 remains not demonstrated until role matrix + access-review evidence or an explicit N/A attest (productionAgentOrAutomationIdentitiesPresent=false) is imported.",
    );
  }
  if (opts.agentIdentities.found) {
    notes.push(
      `Agent/automation identity refs: ${opts.agentIdentities.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.roleMatrix.found) {
    notes.push(
      `Role-matrix / least-privilege refs: ${opts.roleMatrix.refs.slice(0, 3).join(", ")}; code alone does not satisfy AUTHZ-M3.`,
    );
  }
  if (opts.accessReview.found) {
    notes.push(
      `Access-review refs: ${opts.accessReview.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.productionAgentOrAutomationIdentitiesPresent}, matrixPct=${opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct}, reviewWithin90d=${opts.imported.accessReviewWithin90Days}, unexplainedEscalations=${opts.imported.unexplainedPrivilegeEscalations}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import identitiesInRoleMatrixWithNonAdminDefaultPct=100 + accessReviewWithin90Days=true + unexplainedPrivilegeEscalations=0 (measuredAt ≤90d) under imports/agent-role-matrix/ to PASS. Set productionAgentOrAutomationIdentitiesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.productionAgentOrAutomationIdentitiesPresent === false &&
    !gateSignalsPresent;
  const scopePresent =
    opts.imported.productionAgentOrAutomationIdentitiesPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  const matrixOk =
    opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct === 100;
  const reviewOk = opts.imported.accessReviewWithin90Days === true;
  const escalationsOk = opts.imported.unexplainedPrivilegeEscalations === 0;

  let statusHint: AgentRoleMatrixReport["summary"]["statusHint"];
  let authzM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct !== null &&
      opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct < 100) ||
      opts.imported.accessReviewWithin90Days === false ||
      (opts.imported.unexplainedPrivilegeEscalations !== null &&
        opts.imported.unexplainedPrivilegeEscalations > 0));

  if (
    opts.imported.found &&
    opts.imported.productionAgentOrAutomationIdentitiesPresent === false &&
    !gateSignalsPresent
  ) {
    statusHint = "not_applicable";
    authzM3Satisfied = null;
    notes.push(
      "Imported productionAgentOrAutomationIdentitiesPresent=false — AUTHZ-M3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAgentOrAutomationIdentitiesPresent === false &&
    gateSignalsPresent
  ) {
    notes.push(
      "Imported productionAgentOrAutomationIdentitiesPresent=false ignored — in-repo agent/role/review signals prove the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      authzM3Satisfied = false;
    } else if (matrixOk && reviewOk && escalationsOk && importFresh) {
      statusHint = "pass";
      authzM3Satisfied = true;
    } else {
      statusHint = "partial";
      authzM3Satisfied = false;
      if (!importFresh && opts.imported.found) {
        notes.push(
          "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M3 PASS.",
        );
      }
    }
  } else if (explicitFail) {
    statusHint = "fail";
    authzM3Satisfied = false;
    if (
      opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct !== null &&
      opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct < 100
    ) {
      notes.push(
        `Role-matrix non-admin coverage ${opts.imported.identitiesInRoleMatrixWithNonAdminDefaultPct}% < 100%.`,
      );
    }
    if (opts.imported.accessReviewWithin90Days === false) {
      notes.push("accessReviewWithin90Days=false — access review is stale or missing.");
    }
    if (
      opts.imported.unexplainedPrivilegeEscalations !== null &&
      opts.imported.unexplainedPrivilegeEscalations > 0
    ) {
      notes.push(
        `${opts.imported.unexplainedPrivilegeEscalations} unexplained privilege escalation(s).`,
      );
    }
  } else if (
    surfaceOk &&
    matrixOk &&
    reviewOk &&
    escalationsOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authzM3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authzM3Satisfied = false;
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authzM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      agentIdentities: opts.agentIdentities,
      roleMatrix: opts.roleMatrix,
      accessReview: opts.accessReview,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authzM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentRoleMatrixCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;
    const agentRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => AGENT_IDENTITY_RE.test(p) || AGENT_IDENTITY_RE.test(t),
    );
    const matrixRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ROLE_MATRIX_RE.test(p) || ROLE_MATRIX_RE.test(t),
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ACCESS_REVIEW_RE.test(p) || ACCESS_REVIEW_RE.test(t),
    );
    const imported = loadImported(ctx);

    const report = buildAgentRoleMatrixReport({
      assessedAt: ctx.assessedAt.toISOString(),
      agentIdentities: { found: agentRefs.length > 0, refs: agentRefs },
      roleMatrix: { found: matrixRefs.length > 0, refs: matrixRefs },
      accessReview: { found: reviewRefs.length > 0, refs: reviewRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "agent-role-matrix-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/agent-role-matrix-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              imported: {
                matrixPct:
                  report.importedResults
                    .identitiesInRoleMatrixWithNonAdminDefaultPct,
                reviewWithin90d:
                  report.importedResults.accessReviewWithin90Days,
                unexplained:
                  report.importedResults.unexplainedPrivilegeEscalations,
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
          "agent-role-matrix",
          "authz-m3",
          `authz-m3-${report.summary.statusHint}`,
          ...(report.summary.authzM3Satisfied
            ? ["authz-m3-satisfied"]
            : ["authz-m3-fail-or-incomplete"]),
          ...(report.signals.roleMatrix.found ? ["role-matrix"] : []),
          ...(report.signals.accessReview.found ? ["access-review"] : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHZ-M3 status=${report.summary.statusHint} satisfied=${report.summary.authzM3Satisfied}; report=imports/${PLUGIN_ID}/agent-role-matrix-report.json`,
      nodes,
    };
  },
};
