/**
 * credential-egress-controls — SEC2-R2 / repo-credential-egress-controls.
 *
 * Discovers egress allowlist/policy for credential-holding runtimes and
 * deny-log signals. Import coverage under imports/credential-egress-controls/
 * unlocks PASS (measuredAt ≤90d). Allowlist docs alone ≠ PASS; SEC-M4 ≠ PASS.
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
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "credential-egress-controls";
const RELATED = ["SEC2-R2"] as const;
const DETECTOR_ID = "repo-credential-egress-controls";
const IMPORT_MAX_AGE_DAYS = 90;

const EGRESS_POLICY_RE =
  /\b(egress[_-]?(allowlist|allow[_-]?list|policy|filter|control)|network[_-]?policy|cilium[_-]?network|istio[_-]?(authorization|egress)|egress[_-]?gateway|destination[_-]?rule|vpc[_-]?egress|outbound[_-]?(allowlist|proxy)|credential[_-]?egress)\b/i;

const CREDENTIAL_RUNTIME_RE =
  /\b(runtime[_-]?(credential|secret|api[_-]?key)|credential[_-]?holding|service[_-]?account[_-]?(key|token)|workload[_-]?identity|aws[_-]?access[_-]?key|api[_-]?key[_-]?egress)\b/i;

const DESTINATION_RE =
  /\b(allowed[_-]?destination|documented[_-]?destination|destination[_-]?(allowlist|inventory)|egress[_-]?destination|approved[_-]?(endpoint|host|fqdn))\b/i;

const DENY_LOG_RE =
  /\b(egress[_-]?deny|denied[_-]?egress|connection[_-]?denied|outbound[_-]?blocked|networkpolicy[_-]?denied|denied[_-]?by[_-]?policy|sample[_-]?deny)\b/i;

export interface CredentialEgressControlsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    egressPolicy: { found: boolean; refs: string[] };
    credentialRuntime: { found: boolean; refs: string[] };
    documentedDestinations: { found: boolean; refs: string[] };
    denyLogs: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    runtimesHoldingCredentialsPresent: boolean | null;
    egressAllowlistOrPolicyConfigured: boolean | null;
    credentialEgressDestinationsDocumented: boolean | null;
    denyEventCountProvingEnforcementInLast90Days: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    allowlistPresent: boolean;
    sec2R2Satisfied: boolean | null;
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
  limit = 12,
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
      ".tf",
      ".toml",
      ".ts",
      ".js",
      ".py",
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
): CredentialEgressControlsReport["importedResults"] {
  const sources: string[] = [];
  let runtimesHoldingCredentialsPresent: boolean | null = null;
  let egressAllowlistOrPolicyConfigured: boolean | null = null;
  let credentialEgressDestinationsDocumented: boolean | null = null;
  let denyEventCountProvingEnforcementInLast90Days: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/credential-egress-controls-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      runtimesHoldingCredentialsPresent = mergeOrBool(
        runtimesHoldingCredentialsPresent,
        asBool(data.runtimesHoldingCredentialsPresent) ??
          asBool(data.runtimes_holding_credentials_present) ??
          asBool(data.credentialHoldingRuntimesPresent),
      );
      egressAllowlistOrPolicyConfigured = mergeAndBool(
        egressAllowlistOrPolicyConfigured,
        asBool(data.egressAllowlistOrPolicyConfigured) ??
          asBool(data.egress_allowlist_or_policy_configured) ??
          asBool(data.egressAllowlistConfigured),
      );
      credentialEgressDestinationsDocumented = mergeAndBool(
        credentialEgressDestinationsDocumented,
        asBool(data.credentialEgressDestinationsDocumented) ??
          asBool(data.credential_egress_destinations_documented) ??
          asBool(data.destinationsDocumented),
      );
      const denyCount =
        asNum(data.denyEventCountProvingEnforcementInLast90Days) ??
        asNum(data.deny_event_count_proving_enforcement_in_last_90_days) ??
        asNum(data.denyEventCount);
      const denyBool =
        asBool(data.denyEventObservedInLast90Days) ??
        asBool(data.deny_event_observed_in_last_90_days);
      const fromBool = denyBool === true ? 1 : denyBool === false ? 0 : null;
      denyEventCountProvingEnforcementInLast90Days = mergeMaxNum(
        denyEventCountProvingEnforcementInLast90Days,
        denyCount ?? fromBool,
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    runtimesHoldingCredentialsPresent,
    egressAllowlistOrPolicyConfigured,
    credentialEgressDestinationsDocumented,
    denyEventCountProvingEnforcementInLast90Days,
    measuredAt,
    sources,
  };
}

export function buildCredentialEgressControlsReport(opts: {
  assessedAt: string;
  egressPolicy: { found: boolean; refs: string[] };
  credentialRuntime: { found: boolean; refs: string[] };
  documentedDestinations: { found: boolean; refs: string[] };
  denyLogs: { found: boolean; refs: string[] };
  imported: CredentialEgressControlsReport["importedResults"];
}): CredentialEgressControlsReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.egressPolicy.found ||
    opts.credentialRuntime.found ||
    opts.documentedDestinations.found ||
    opts.denyLogs.found;
  // Any credential-egress surface signal blocks N/A launder.
  const surfaceProvedForNaOverride = gateSignalsPresent;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No credential-egress-controls signals — SEC2-R2 remains not demonstrated until egress allowlist/policy + deny-event evidence or an explicit N/A attest (runtimesHoldingCredentialsPresent=false) is imported.",
    );
  }
  if (opts.egressPolicy.found) {
    notes.push(
      `Egress-policy refs: ${opts.egressPolicy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.credentialRuntime.found) {
    notes.push(
      `Credential-runtime refs: ${opts.credentialRuntime.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.documentedDestinations.found) {
    notes.push(
      `Destination docs refs: ${opts.documentedDestinations.refs.slice(0, 3).join(", ")}; docs alone ≠ PASS without deny-event import.`,
    );
  }
  if (opts.denyLogs.found) {
    notes.push(
      `Deny-log refs: ${opts.denyLogs.refs.slice(0, 3).join(", ")}; path/text hints alone do not prove ≥1 deny in ≤90d — import count.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (runtimesPresent=${opts.imported.runtimesHoldingCredentialsPresent}, allowlist=${opts.imported.egressAllowlistOrPolicyConfigured}, destinations=${opts.imported.credentialEgressDestinationsDocumented}, denyCount=${opts.imported.denyEventCountProvingEnforcementInLast90Days}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import allowlist/policy (or present via in-repo signals) plus credentialEgressDestinationsDocumented=true + denyEventCountProvingEnforcementInLast90Days≥1 (measuredAt ≤90d) under imports/credential-egress-controls/ to PASS. Set runtimesHoldingCredentialsPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const allowlistPresent =
    opts.egressPolicy.found ||
    opts.imported.egressAllowlistOrPolicyConfigured === true;
  // Destination docs in-repo are supporting only — import must attest.
  const destinationsOk =
    opts.imported.credentialEgressDestinationsDocumented === true;
  const denyOk =
    (opts.imported.denyEventCountProvingEnforcementInLast90Days ?? 0) >= 1;

  let statusHint: CredentialEgressControlsReport["summary"]["statusHint"];
  let sec2R2Satisfied: boolean | null = null;

  const naCandidate =
    opts.imported.found &&
    opts.imported.runtimesHoldingCredentialsPresent === false &&
    !surfaceProvedForNaOverride;
  // Vacuous control=false fields under N/A must not force fail.
  const explicitFail =
    opts.imported.found &&
    !naCandidate &&
    ((opts.imported.egressAllowlistOrPolicyConfigured === false &&
      !opts.egressPolicy.found) ||
      opts.imported.credentialEgressDestinationsDocumented === false ||
      (opts.imported.denyEventCountProvingEnforcementInLast90Days !== null &&
        opts.imported.denyEventCountProvingEnforcementInLast90Days < 1));

  if (explicitFail) {
    statusHint = "fail";
    sec2R2Satisfied = false;
    if (
      opts.imported.runtimesHoldingCredentialsPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(
        "Imported runtimesHoldingCredentialsPresent=false ignored — in-repo egress policy, credential-runtime, destination, or deny-log signals prove the surface exists.",
      );
    }
    notes.push(
      "Imported evidence shows missing allowlist/policy, undocumented destinations, or 0 deny events — SEC2-R2 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.runtimesHoldingCredentialsPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2R2Satisfied = null;
    notes.push(
      "Imported runtimesHoldingCredentialsPresent=false — SEC2-R2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.runtimesHoldingCredentialsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported runtimesHoldingCredentialsPresent=false ignored — in-repo egress policy, credential-runtime, destination, or deny-log signals prove the surface exists.",
    );
    if (
      allowlistPresent &&
      destinationsOk &&
      denyOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2R2Satisfied = true;
    } else {
      statusHint = "partial";
      sec2R2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2R2Satisfied = null;
  } else if (
    allowlistPresent &&
    destinationsOk &&
    denyOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sec2R2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2R2Satisfied = false;
    if (opts.imported.found && !allowlistPresent) {
      notes.push(
        "PASS requires egress allowlist/policy (in-repo or egressAllowlistOrPolicyConfigured=true).",
      );
    }
    if (opts.imported.found && !destinationsOk) {
      notes.push(
        "Import must show credentialEgressDestinationsDocumented=true.",
      );
    }
    if (opts.imported.found && !denyOk) {
      notes.push(
        "Import must show denyEventCountProvingEnforcementInLast90Days≥1 (or denyEventObservedInLast90Days=true).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC2-R2 PASS.",
      );
    }
    if (
      opts.documentedDestinations.found &&
      opts.imported.credentialEgressDestinationsDocumented !== true
    ) {
      notes.push(
        "In-repo destination docs found but PASS still requires credentialEgressDestinationsDocumented=true in import.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2R2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      egressPolicy: opts.egressPolicy,
      credentialRuntime: opts.credentialRuntime,
      documentedDestinations: opts.documentedDestinations,
      denyLogs: opts.denyLogs,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      allowlistPresent,
      sec2R2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const credentialEgressControlsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const egressRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EGRESS_POLICY_RE.test(path) || EGRESS_POLICY_RE.test(text),
      10,
    );
    const credRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CREDENTIAL_RUNTIME_RE.test(path) || CREDENTIAL_RUNTIME_RE.test(text),
      10,
    );
    const destRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DESTINATION_RE.test(path) || DESTINATION_RE.test(text),
      10,
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DENY_LOG_RE.test(path) || DENY_LOG_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildCredentialEgressControlsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      egressPolicy: { found: egressRefs.length > 0, refs: egressRefs },
      credentialRuntime: { found: credRefs.length > 0, refs: credRefs },
      documentedDestinations: { found: destRefs.length > 0, refs: destRefs },
      denyLogs: { found: denyRefs.length > 0, refs: denyRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "credential-egress-controls-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/credential-egress-controls-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "credential-egress-controls",
          "sec2-r2",
          DETECTOR_ID,
          ...(report.summary.sec2R2Satisfied ? ["sec2-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-R2 status=${report.summary.statusHint} allowlist=${report.summary.allowlistPresent} satisfied=${report.summary.sec2R2Satisfied}; report=imports/${PLUGIN_ID}/credential-egress-controls-report.json`,
      nodes,
    };
  },
};
