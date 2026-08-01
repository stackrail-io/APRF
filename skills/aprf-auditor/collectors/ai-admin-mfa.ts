/**
 * ai-admin-mfa — AUTHN-M3 / repo-ai-admin-mfa.
 *
 * Discovers IdP/MFA policy and break-glass inventory signals. Import
 * aiControlPlaneAdminRolesMfaEnforcedPct=100 +
 * breakGlassAccountCount ≤ documentedBreakGlassMaximum +
 * breakGlassMonitoringEnabled=true under imports/ai-admin-mfa/ to unlock PASS
 * (measuredAt ≤90d). Set aiControlPlaneAdminAccessPresent=false for N/A.
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

const PLUGIN_ID = "ai-admin-mfa";
const RELATED = ["AUTHN-M3"] as const;
const DETECTOR_ID = "repo-ai-admin-mfa";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MFA_RE =
  /\b(mfa|multi[_-]?factor|2fa|two[_-]?factor|otp|totp|webauthn|authenticator)\b/i;

const ADMIN_ROLE_RE =
  /\b(ai[_-]?(admin|control[_-]?plane)|control[_-]?plane[_-]?admin|prompt[_-]?admin|model[_-]?admin|tool[_-]?admin|deploy[_-]?admin|idp[_-]?(role|group|policy))\b/i;

const BREAK_GLASS_RE =
  /\b(break[_-]?glass|emergency[_-]?(access|account)|breakglass)\b/i;

const MONITORING_RE =
  /\b(break[_-]?glass.{0,40}(monitor|alert|siem|audit)|monitor.{0,40}break[_-]?glass|alert.{0,40}break[_-]?glass)\b/i;

export interface AiAdminMfaReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    mfa: { found: boolean; refs: string[] };
    adminRoles: { found: boolean; refs: string[] };
    breakGlass: { found: boolean; refs: string[] };
    monitoring: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    aiControlPlaneAdminAccessPresent: boolean | null;
    aiControlPlaneAdminRolesMfaEnforcedPct: number | null;
    breakGlassAccountCount: number | null;
    documentedBreakGlassMaximum: number | null;
    breakGlassMonitoringEnabled: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authnM3Satisfied: boolean | null;
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
): AiAdminMfaReport["importedResults"] {
  const sources: string[] = [];
  let aiControlPlaneAdminAccessPresent: boolean | null = null;
  let aiControlPlaneAdminRolesMfaEnforcedPct: number | null = null;
  let breakGlassAccountCount: number | null = null;
  let documentedBreakGlassMaximum: number | null = null;
  let breakGlassMonitoringEnabled: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-admin-mfa-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      ageDays = mergeMaxNum(
        ageDays,
        asNum(data.ageDays) ?? asNum(data.age_days),
      );
      aiControlPlaneAdminAccessPresent = mergeOrBool(
        aiControlPlaneAdminAccessPresent,
        asBool(data.aiControlPlaneAdminAccessPresent) ??
          asBool(data.ai_control_plane_admin_access_present) ??
          asBool(data.hasAiControlPlaneAdminAccess),
      );
      aiControlPlaneAdminRolesMfaEnforcedPct = mergeMinNum(
        aiControlPlaneAdminRolesMfaEnforcedPct,
        asNum(data.aiControlPlaneAdminRolesMfaEnforcedPct) ??
          asNum(data.ai_control_plane_admin_roles_mfa_enforced_pct) ??
          asNum(data.adminRolesMfaEnforcedPct) ??
          asNum(data.mfaEnforcedPct),
      );
      breakGlassAccountCount = mergeMaxNum(
        breakGlassAccountCount,
        asNum(data.breakGlassAccountCount) ??
          asNum(data.break_glass_account_count) ??
          asNum(data.breakGlassCount),
      );
      documentedBreakGlassMaximum = mergeMinNum(
        documentedBreakGlassMaximum,
        asNum(data.documentedBreakGlassMaximum) ??
          asNum(data.documented_break_glass_maximum) ??
          asNum(data.breakGlassMaximum) ??
          asNum(data.maxBreakGlassAccounts),
      );
      breakGlassMonitoringEnabled = mergeAndBool(
        breakGlassMonitoringEnabled,
        asBool(data.breakGlassMonitoringEnabled) ??
          asBool(data.break_glass_monitoring_enabled) ??
          asBool(data.breakGlassMonitored),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    aiControlPlaneAdminAccessPresent,
    aiControlPlaneAdminRolesMfaEnforcedPct,
    breakGlassAccountCount,
    documentedBreakGlassMaximum,
    breakGlassMonitoringEnabled,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiAdminMfaReport(opts: {
  assessedAt: string;
  mfa: { found: boolean; refs: string[] };
  adminRoles: { found: boolean; refs: string[] };
  breakGlass: { found: boolean; refs: string[] };
  monitoring: { found: boolean; refs: string[] };
  imported: AiAdminMfaReport["importedResults"];
}): AiAdminMfaReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.mfa.found ||
    opts.adminRoles.found ||
    opts.breakGlass.found ||
    opts.monitoring.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI admin MFA / break-glass signals — AUTHN-M3 remains not demonstrated until IdP/break-glass evidence or an explicit N/A attest (aiControlPlaneAdminAccessPresent=false) is imported.",
    );
  }
  if (opts.mfa.found) {
    notes.push(`MFA refs: ${opts.mfa.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.adminRoles.found) {
    notes.push(
      `Admin-role refs: ${opts.adminRoles.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.breakGlass.found) {
    notes.push(
      `Break-glass refs: ${opts.breakGlass.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.monitoring.found) {
    notes.push(
      `Break-glass monitoring refs: ${opts.monitoring.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.aiControlPlaneAdminAccessPresent}, mfaPct=${opts.imported.aiControlPlaneAdminRolesMfaEnforcedPct}, breakGlass=${opts.imported.breakGlassAccountCount}/${opts.imported.documentedBreakGlassMaximum}, monitored=${opts.imported.breakGlassMonitoringEnabled}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import aiControlPlaneAdminRolesMfaEnforcedPct=100 + breakGlassAccountCount ≤ documentedBreakGlassMaximum + breakGlassMonitoringEnabled=true (measuredAt ≤90d) under imports/ai-admin-mfa/ to PASS. Set aiControlPlaneAdminAccessPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const mfaOk = opts.imported.aiControlPlaneAdminRolesMfaEnforcedPct === 100;
  const breakGlassBoundOk =
    opts.imported.breakGlassAccountCount !== null &&
    opts.imported.documentedBreakGlassMaximum !== null &&
    opts.imported.breakGlassAccountCount <=
      opts.imported.documentedBreakGlassMaximum;
  const monitoringOk = opts.imported.breakGlassMonitoringEnabled === true;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
  );
  // Explicit present=false wins N/A — in-repo regex alone must not block it.
  const scopeAbsent =
    opts.imported.aiControlPlaneAdminAccessPresent === false;
  const scopePresent = opts.imported.aiControlPlaneAdminAccessPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  let statusHint: AiAdminMfaReport["summary"]["statusHint"];
  let authnM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported.aiControlPlaneAdminRolesMfaEnforcedPct !== null &&
      opts.imported.aiControlPlaneAdminRolesMfaEnforcedPct < 100) ||
      (opts.imported.breakGlassAccountCount !== null &&
        opts.imported.documentedBreakGlassMaximum !== null &&
        opts.imported.breakGlassAccountCount >
          opts.imported.documentedBreakGlassMaximum) ||
      // Attested monitoring=false always fails — docs regex cannot unlock PASS.
      opts.imported.breakGlassMonitoringEnabled === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    authnM3Satisfied = null;
    notes.push(
      "Imported aiControlPlaneAdminAccessPresent=false — AUTHN-M3 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    authnM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    authnM3Satisfied = false;
    notes.push(
      "Imported evidence shows MFA <100%, break-glass over documented maximum, monitoring disabled, or attest older than 90 days — AUTHN-M3 fail.",
    );
  } else if (
    surfaceOk &&
    mfaOk &&
    breakGlassBoundOk &&
    monitoringOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authnM3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authnM3Satisfied = false;
    if (opts.imported.found && !surfaceOk) {
      notes.push(
        "Import must set aiControlPlaneAdminAccessPresent=true (or discover in-repo IdP/break-glass signals) — coverage metrics alone without an attested surface cannot unlock PASS.",
      );
    }
    if (opts.imported.found && !mfaOk) {
      notes.push(
        "Import must show aiControlPlaneAdminRolesMfaEnforcedPct=100.",
      );
    }
    if (opts.imported.found && !breakGlassBoundOk) {
      notes.push(
        "Import must show breakGlassAccountCount and documentedBreakGlassMaximum with count ≤ maximum.",
      );
    }
    if (opts.imported.found && !monitoringOk) {
      notes.push("Import must show breakGlassMonitoringEnabled=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AUTHN-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authnM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      mfa: opts.mfa,
      adminRoles: opts.adminRoles,
      breakGlass: opts.breakGlass,
      monitoring: opts.monitoring,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authnM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiAdminMfaCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const mfaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MFA_RE.test(path) || MFA_RE.test(text),
      10,
    );
    const adminRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ADMIN_ROLE_RE.test(path) || ADMIN_ROLE_RE.test(text),
      10,
    );
    const breakGlassRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BREAK_GLASS_RE.test(path) || BREAK_GLASS_RE.test(text),
      10,
    );
    const monitoringRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MONITORING_RE.test(path) || MONITORING_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiAdminMfaReport({
      assessedAt: ctx.assessedAt.toISOString(),
      mfa: { found: mfaRefs.length > 0, refs: mfaRefs },
      adminRoles: { found: adminRefs.length > 0, refs: adminRefs },
      breakGlass: { found: breakGlassRefs.length > 0, refs: breakGlassRefs },
      monitoring: { found: monitoringRefs.length > 0, refs: monitoringRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-admin-mfa-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: `imports/${PLUGIN_ID}/ai-admin-mfa-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-admin-mfa",
          "authn-m3",
          DETECTOR_ID,
          ...(report.summary.authnM3Satisfied ? ["authn-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.mfa.refs,
        ...report.signals.adminRoles.refs,
        ...report.signals.breakGlass.refs,
        ...report.signals.monitoring.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-admin-mfa-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHN-M3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.authnM3Satisfied}; report=imports/${PLUGIN_ID}/ai-admin-mfa-report.json`,
      nodes,
    };
  },
};
