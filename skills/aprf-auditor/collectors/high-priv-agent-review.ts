/**
 * high-priv-agent-review — AUTHZ-R2 detector executor.
 *
 * Discovers high-privilege agent inventory and access-review signals.
 * Import coverage under imports/high-priv-agent-review/ to unlock PASS
 * (measuredAt ≤90d). Inventory docs alone ≠ PASS.
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
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "high-priv-agent-review";
const RELATED = ["AUTHZ-R2"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const HIGH_PRIV_AGENT_RE =
  /\b(high[_-]?priv(ilege)?[_-]?agent|privileged[_-]?agent|admin[_-]?agent|superuser[_-]?agent|agent[_-]?(admin|owner|root))\b/i;

const ACCESS_REVIEW_RE =
  /\b(access[_-]?review|privilege[_-]?review|entitlement[_-]?review|keep[_/]?revoke|scope[_-]?reduction|role[_-]?review)\b/i;

const REVOKE_EVIDENCE_RE =
  /\b(revoke|scope[_-]?reduc(e|tion)|deprivileg|none[_-]?warranted|reviewer[_-]?sign[_-]?off)\b/i;

export interface HighPrivAgentReviewReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    highPrivInventory: { found: boolean; refs: string[] };
    accessReview: { found: boolean; refs: string[] };
    revokeEvidence: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highPrivilegeAgentIdentitiesPresent: boolean | null;
    everyHighPrivilegeAgentReviewedWithin90Days: boolean | null;
    revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted:
      | boolean
      | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authzR2Satisfied: boolean | null;
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
      ".md",
      ".txt",
      ".csv",
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
): HighPrivAgentReviewReport["importedResults"] {
  const sources: string[] = [];
  let highPrivilegeAgentIdentitiesPresent: boolean | null = null;
  let everyHighPrivilegeAgentReviewedWithin90Days: boolean | null = null;
  let revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted:
    | boolean
    | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/high-priv-agent-review-report\.json$/i.test(f)) continue;
    if (!/\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const fileMeasuredAt = parseMeasuredAt(data);
      const present =
        asBool(data.highPrivilegeAgentIdentitiesPresent) ??
        asBool(data.high_privilege_agent_identities_present) ??
        asBool(data.hasHighPrivilegeAgents);
      const reviewed =
        asBool(data.everyHighPrivilegeAgentReviewedWithin90Days) ??
        asBool(data.every_high_privilege_agent_reviewed_within_90_days) ??
        asBool(data.allHighPrivAgentsReviewedWithin90Days);
      const revokeCombined =
        asBool(data.revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted) ??
        asBool(
          data.revoke_or_scope_reduction_in_last_two_cycles_or_attested_none_warranted,
        );
      const revokeCycle = asBool(data.revokeOrScopeReductionInLastTwoCycles);
      const noneWarranted = asBool(data.noneWarrantedWithReviewerSignOff);
      let revokeOrNone: boolean | null = revokeCombined;
      if (revokeOrNone === null) {
        if (revokeCycle === true || noneWarranted === true) revokeOrNone = true;
        else if (revokeCycle === false && noneWarranted !== true)
          revokeOrNone = false;
      }
      measuredAt = mergeOldestMeasuredAt(measuredAt, fileMeasuredAt);
      highPrivilegeAgentIdentitiesPresent = mergeOrBool(
        highPrivilegeAgentIdentitiesPresent,
        present,
      );
      everyHighPrivilegeAgentReviewedWithin90Days = mergeAndBool(
        everyHighPrivilegeAgentReviewedWithin90Days,
        reviewed,
      );
      revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted =
        mergeAndBool(
          revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted,
          revokeOrNone,
        );
      if (
        present !== null ||
        reviewed !== null ||
        revokeOrNone !== null ||
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
    highPrivilegeAgentIdentitiesPresent,
    everyHighPrivilegeAgentReviewedWithin90Days,
    revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted,
    measuredAt,
    sources,
  };
}

export function buildHighPrivAgentReviewReport(opts: {
  assessedAt: string;
  highPrivInventory: { found: boolean; refs: string[] };
  accessReview: { found: boolean; refs: string[] };
  revokeEvidence: { found: boolean; refs: string[] };
  imported: HighPrivAgentReviewReport["importedResults"];
}): HighPrivAgentReviewReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.highPrivInventory.found ||
    opts.accessReview.found ||
    opts.revokeEvidence.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No high-privilege agent review signals — AUTHZ-R2 remains not demonstrated until inventory + ≤90d review + revoke/none-warranted evidence or an explicit N/A attest (highPrivilegeAgentIdentitiesPresent=false) is imported.",
    );
  }
  if (opts.highPrivInventory.found) {
    notes.push(
      `High-privilege agent inventory refs: ${opts.highPrivInventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.accessReview.found) {
    notes.push(
      `Access-review refs: ${opts.accessReview.refs.slice(0, 3).join(", ")}; review docs alone do not satisfy AUTHZ-R2.`,
    );
  }
  if (opts.revokeEvidence.found) {
    notes.push(
      `Revoke/scope-reduction refs: ${opts.revokeEvidence.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.highPrivilegeAgentIdentitiesPresent}, reviewedWithin90d=${opts.imported.everyHighPrivilegeAgentReviewedWithin90Days}, revokeOrNoneWarranted=${opts.imported.revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import everyHighPrivilegeAgentReviewedWithin90Days=true + revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted=true (measuredAt ≤90d) under imports/high-priv-agent-review/ to PASS. Set highPrivilegeAgentIdentitiesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.highPrivilegeAgentIdentitiesPresent === false &&
    !gateSignalsPresent;
  const scopePresent =
    opts.imported.highPrivilegeAgentIdentitiesPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  const reviewedOk =
    opts.imported.everyHighPrivilegeAgentReviewedWithin90Days === true;
  const revokeOk =
    opts.imported
      .revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted === true;

  let statusHint: HighPrivAgentReviewReport["summary"]["statusHint"];
  let authzR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.everyHighPrivilegeAgentReviewedWithin90Days === false ||
      opts.imported
        .revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted ===
        false);

  if (
    opts.imported.found &&
    opts.imported.highPrivilegeAgentIdentitiesPresent === false &&
    !gateSignalsPresent
  ) {
    statusHint = "not_applicable";
    authzR2Satisfied = null;
    notes.push(
      "Imported highPrivilegeAgentIdentitiesPresent=false — AUTHZ-R2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.highPrivilegeAgentIdentitiesPresent === false &&
    gateSignalsPresent
  ) {
    notes.push(
      "Imported highPrivilegeAgentIdentitiesPresent=false ignored — in-repo high-priv/review signals prove the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      authzR2Satisfied = false;
    } else if (reviewedOk && revokeOk && importFresh) {
      statusHint = "pass";
      authzR2Satisfied = true;
    } else {
      statusHint = "partial";
      authzR2Satisfied = false;
      if (!importFresh && opts.imported.found) {
        notes.push(
          "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-R2 PASS.",
        );
      }
    }
  } else if (explicitFail) {
    statusHint = "fail";
    authzR2Satisfied = false;
    if (opts.imported.everyHighPrivilegeAgentReviewedWithin90Days === false) {
      notes.push("everyHighPrivilegeAgentReviewedWithin90Days=false.");
    }
    if (
      opts.imported
        .revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted === false
    ) {
      notes.push(
        "revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted=false.",
      );
    }
  } else if (
    surfaceOk &&
    reviewedOk &&
    revokeOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authzR2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authzR2Satisfied = false;
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authzR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      highPrivInventory: opts.highPrivInventory,
      accessReview: opts.accessReview,
      revokeEvidence: opts.revokeEvidence,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authzR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const highPrivAgentReviewCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;
    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => HIGH_PRIV_AGENT_RE.test(p) || HIGH_PRIV_AGENT_RE.test(t),
    );
    const reviewRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ACCESS_REVIEW_RE.test(p) || ACCESS_REVIEW_RE.test(t),
    );
    const revokeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => REVOKE_EVIDENCE_RE.test(p) || REVOKE_EVIDENCE_RE.test(t),
    );
    const imported = loadImported(ctx);

    const report = buildHighPrivAgentReviewReport({
      assessedAt: ctx.assessedAt.toISOString(),
      highPrivInventory: {
        found: inventoryRefs.length > 0,
        refs: inventoryRefs,
      },
      accessReview: { found: reviewRefs.length > 0, refs: reviewRefs },
      revokeEvidence: { found: revokeRefs.length > 0, refs: revokeRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(
      importDir(ctx),
      "high-priv-agent-review-report.json",
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/high-priv-agent-review-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              imported: {
                reviewedWithin90d:
                  report.importedResults
                    .everyHighPrivilegeAgentReviewedWithin90Days,
                revokeOrNone:
                  report.importedResults
                    .revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted,
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
          "high-priv-agent-review",
          "authz-r2",
          `authz-r2-${report.summary.statusHint}`,
          ...(report.summary.authzR2Satisfied
            ? ["authz-r2-satisfied"]
            : ["authz-r2-fail-or-incomplete"]),
          ...(report.signals.accessReview.found ? ["access-review"] : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHZ-R2 status=${report.summary.statusHint} satisfied=${report.summary.authzR2Satisfied}; report=imports/${PLUGIN_ID}/high-priv-agent-review-report.json`,
      nodes,
    };
  },
};
