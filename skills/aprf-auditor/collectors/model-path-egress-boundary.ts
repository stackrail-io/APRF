/**
 * model-path-egress-boundary — SEC-M4 / repo-model-path-egress-boundary.
 *
 * Discovers model/tool trust boundaries + egress allowlists + reachability probes.
 * Import trustBoundaryArchitectureDocumented +
 * modelToolRuntimeEgressAllowlistConfigured +
 * unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity=0 +
 * probeShowsOnlyAllowlistedDestinations under
 * imports/model-path-egress-boundary/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "model-path-egress-boundary";
const RELATED = ["SEC-M4"] as const;
const DETECTOR_ID = "repo-model-path-egress-boundary";
const IMPORT_MAX_AGE_DAYS = 90;

const TRUST_RE =
  /\b(trust[_-]?boundar|model[_-]?path|tool[_-]?runtime[_-]?(identit|egress)|model[_-]?(identit|egress)|universal[_-]?proxy)\b/i;

const EGRESS_RE =
  /\b(egress[_-]?(allowlist|policy|filter)|network[_-]?policy|networkpolicy|security[_-]?group|destination[_-]?allowlist|cilium|calico)\b/i;

const PROBE_RE =
  /\b((egress|reachability|network)[_-]?probe|allowlist[_-]?probe|non[_-]?allowlist(ed)?[_-]?(deny|fail)|admin[_-]?(api|endpoint).{0,30}(block|deny|unreachable))\b/i;

const ADMIN_DS_RE =
  /\b(internal[_-]?admin|admin[_-]?api|data[_-]?store|database[_-]?egress|unrestricted[_-]?(route|egress))\b/i;

export interface ModelPathEgressBoundaryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    trustBoundary: { found: boolean; refs: string[] };
    egress: { found: boolean; refs: string[] };
    probe: { found: boolean; refs: string[] };
    adminDataStore: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    modelToolRuntimeCanInitiateNetworkCalls: boolean | null;
    trustBoundaryArchitectureDocumented: boolean | null;
    modelToolRuntimeEgressAllowlistConfigured: boolean | null;
    unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity: number | null;
    probeShowsOnlyAllowlistedDestinations: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secM4Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".tf"],
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
): ModelPathEgressBoundaryReport["importedResults"] {
  const sources: string[] = [];
  let modelToolRuntimeCanInitiateNetworkCalls: boolean | null = null;
  let trustBoundaryArchitectureDocumented: boolean | null = null;
  let modelToolRuntimeEgressAllowlistConfigured: boolean | null = null;
  let unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity:
    | number
    | null = null;
  let probeShowsOnlyAllowlistedDestinations: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-path-egress-boundary-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      modelToolRuntimeCanInitiateNetworkCalls =
        asBool(data.modelToolRuntimeCanInitiateNetworkCalls) ??
        asBool(data.model_tool_runtime_can_initiate_network_calls) ??
        asBool(data.runtimeCanInitiateNetworkCalls) ??
        modelToolRuntimeCanInitiateNetworkCalls;
      trustBoundaryArchitectureDocumented =
        asBool(data.trustBoundaryArchitectureDocumented) ??
        asBool(data.trust_boundary_architecture_documented) ??
        asBool(data.trustBoundaryDocumented) ??
        trustBoundaryArchitectureDocumented;
      modelToolRuntimeEgressAllowlistConfigured =
        asBool(data.modelToolRuntimeEgressAllowlistConfigured) ??
        asBool(data.model_tool_runtime_egress_allowlist_configured) ??
        asBool(data.egressAllowlistConfigured) ??
        modelToolRuntimeEgressAllowlistConfigured;
      unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity =
        asNum(
          data.unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity,
        ) ??
        asNum(
          data.unrestricted_internal_admin_or_data_store_routes_from_model_identity,
        ) ??
        asNum(data.unrestrictedInternalRoutes) ??
        unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity;
      probeShowsOnlyAllowlistedDestinations =
        asBool(data.probeShowsOnlyAllowlistedDestinations) ??
        asBool(data.probe_shows_only_allowlisted_destinations) ??
        asBool(data.allowlistedOnlyReachability) ??
        probeShowsOnlyAllowlistedDestinations;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    modelToolRuntimeCanInitiateNetworkCalls,
    trustBoundaryArchitectureDocumented,
    modelToolRuntimeEgressAllowlistConfigured,
    unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity,
    probeShowsOnlyAllowlistedDestinations,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelPathEgressBoundaryReport(opts: {
  assessedAt: string;
  trustBoundary: { found: boolean; refs: string[] };
  egress: { found: boolean; refs: string[] };
  probe: { found: boolean; refs: string[] };
  adminDataStore: { found: boolean; refs: string[] };
  imported: ModelPathEgressBoundaryReport["importedResults"];
}): ModelPathEgressBoundaryReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.trustBoundary.found ||
    opts.egress.found ||
    opts.probe.found ||
    opts.adminDataStore.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No model-path egress boundary signals — SEC-M4 remains not demonstrated until trust/egress/probe evidence or an explicit N/A attest (modelToolRuntimeCanInitiateNetworkCalls=false) is imported.",
    );
  }
  if (opts.trustBoundary.found) {
    notes.push(
      `Trust-boundary refs: ${opts.trustBoundary.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.egress.found) {
    notes.push(`Egress/policy refs: ${opts.egress.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.probe.found) {
    notes.push(`Probe refs: ${opts.probe.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (trust=${opts.imported.trustBoundaryArchitectureDocumented}, allowlist=${opts.imported.modelToolRuntimeEgressAllowlistConfigured}, unrestrictedRoutes=${opts.imported.unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity}, probeOk=${opts.imported.probeShowsOnlyAllowlistedDestinations})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Boundary signals alone are PARTIAL — import trustBoundaryArchitectureDocumented=true + modelToolRuntimeEgressAllowlistConfigured=true + unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity=0 + probeShowsOnlyAllowlistedDestinations=true (measuredAt ≤90d) under imports/model-path-egress-boundary/ to PASS. Set modelToolRuntimeCanInitiateNetworkCalls=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const trustOk = opts.imported.trustBoundaryArchitectureDocumented === true;
  const allowlistOk =
    opts.imported.modelToolRuntimeEgressAllowlistConfigured === true;
  const routesOk =
    opts.imported.unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity ===
    0;
  const probeOk = opts.imported.probeShowsOnlyAllowlistedDestinations === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const scopeAbsent =
    opts.imported.modelToolRuntimeCanInitiateNetworkCalls === false;

  let statusHint: ModelPathEgressBoundaryReport["summary"]["statusHint"];
  let secM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.trustBoundaryArchitectureDocumented === false ||
      opts.imported.modelToolRuntimeEgressAllowlistConfigured === false ||
      (opts.imported
        .unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity !==
        null &&
        opts.imported
          .unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity > 0) ||
      opts.imported.probeShowsOnlyAllowlistedDestinations === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    secM4Satisfied = null;
    notes.push(
      "Imported modelToolRuntimeCanInitiateNetworkCalls=false — SEC-M4 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    secM4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing trust boundary/allowlist, unrestricted internal routes >0, failed allowlisted-only probe, or attest older than 90 days — SEC-M4 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    trustOk &&
    allowlistOk &&
    routesOk &&
    probeOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secM4Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secM4Satisfied = false;
    if (opts.imported.found && !trustOk) {
      notes.push(
        "Import must show trustBoundaryArchitectureDocumented=true.",
      );
    }
    if (opts.imported.found && !allowlistOk) {
      notes.push(
        "Import must show modelToolRuntimeEgressAllowlistConfigured=true.",
      );
    }
    if (opts.imported.found && !routesOk) {
      notes.push(
        "Import must show unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity=0.",
      );
    }
    if (opts.imported.found && !probeOk) {
      notes.push(
        "Import must show probeShowsOnlyAllowlistedDestinations=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-M4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      trustBoundary: opts.trustBoundary,
      egress: opts.egress,
      probe: opts.probe,
      adminDataStore: opts.adminDataStore,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelPathEgressBoundaryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const trustRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TRUST_RE.test(path) || TRUST_RE.test(text),
      10,
    );
    const egressRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EGRESS_RE.test(path) || EGRESS_RE.test(text),
      10,
    );
    const probeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROBE_RE.test(path) || PROBE_RE.test(text),
      10,
    );
    const adminRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ADMIN_DS_RE.test(path) || ADMIN_DS_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildModelPathEgressBoundaryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      trustBoundary: { found: trustRefs.length > 0, refs: trustRefs },
      egress: { found: egressRefs.length > 0, refs: egressRefs },
      probe: { found: probeRefs.length > 0, refs: probeRefs },
      adminDataStore: { found: adminRefs.length > 0, refs: adminRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-path-egress-boundary-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/model-path-egress-boundary-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-path-egress-boundary",
          "sec-m4",
          DETECTOR_ID,
          ...(report.summary.secM4Satisfied ? ["sec-m4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.trustBoundary.refs,
        ...report.signals.egress.refs,
        ...report.signals.probe.refs,
        ...report.signals.adminDataStore.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-path-egress-boundary-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-M4 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secM4Satisfied}; report=imports/${PLUGIN_ID}/model-path-egress-boundary-report.json`,
      nodes,
    };
  },
};
