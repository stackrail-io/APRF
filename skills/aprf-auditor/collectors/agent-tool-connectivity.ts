/**
 * agent-tool-connectivity — INF-M3 / repo-agent-tool-connectivity.
 *
 * Discovers dependency inventory + network/identity least-privilege
 * connectivity for agent/tool runtimes. Import coverage under
 * imports/agent-tool-connectivity/ to unlock PASS (measuredAt ≤90d).
 * Distinct from SEC-M4 model-path universal-proxy prevention.
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

const PLUGIN_ID = "agent-tool-connectivity";
const RELATED = ["INF-M3"] as const;
const DETECTOR_ID = "repo-agent-tool-connectivity";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DEPENDENCY_INV_RE =
  /\b(dependenc(y|ies)[_-]?(inventory|allowlist|catalog)|agent[_-]?(tool[_-]?)?dependenc|required[_-]?dependenc|tool[_-]?allowlist|service[_-]?dependenc(y|ies))\b/i;

const CONNECTIVITY_RE =
  /\b(network[_-]?polic(y|ies)|networkpolicy|security[_-]?group|egress[_-]?(gateway|allowlist|filter)|service[_-]?mesh|istio|linkerd|cilium|calico|workload[_-]?identity|zero[_-]?trust|private[_-]?endpoint|vpc[_-]?firewall|authorization[_-]?policy)\b/i;

const PROBE_RE =
  /\b((connectivity|reachability|egress|segmentation)[_-]?probe|unauthorized[_-]?(internal|service)[_-]?(deny|block|fail)|non[_-]?(allowlisted|authorized)[_-]?(deny|block)|lateral[_-]?movement[_-]?(test|probe))\b/i;

const AGENT_TOOL_RUNTIME_RE =
  /\b(agent[_-]?runtime|tool[_-]?runtime|agent[_-]?workload|tool[_-]?executor|mcp[_-]?server[_-]?runtime)\b/i;

export interface AgentToolConnectivityReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    dependencyInventory: { found: boolean; refs: string[] };
    connectivityControls: { found: boolean; refs: string[] };
    unauthorizedAccessProbe: { found: boolean; refs: string[] };
    agentToolRuntimes: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    agentOrToolRuntimesPresent: boolean | null;
    dependencyInventoryDocumented: boolean | null;
    leastPrivilegeConnectivityControlsConfigured: boolean | null;
    unauthorizedInternalServiceAccessBlockedInProbe: boolean | null;
    connectivityControlsMatchDependencyInventory: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    infM3Satisfied: boolean | null;
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
      ".ts",
      ".js",
      ".py",
      ".toml",
      ".tf",
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
): AgentToolConnectivityReport["importedResults"] {
  const sources: string[] = [];
  let agentOrToolRuntimesPresent: boolean | null = null;
  let dependencyInventoryDocumented: boolean | null = null;
  let leastPrivilegeConnectivityControlsConfigured: boolean | null = null;
  let unauthorizedInternalServiceAccessBlockedInProbe: boolean | null = null;
  let connectivityControlsMatchDependencyInventory: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-tool-connectivity-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      agentOrToolRuntimesPresent = mergeOrBool(
        agentOrToolRuntimesPresent,
        asBool(data.agentOrToolRuntimesPresent) ??
          asBool(data.agent_or_tool_runtimes_present) ??
          asBool(data.agentToolRuntimesPresent),
      );
      dependencyInventoryDocumented = mergeAndBool(
        dependencyInventoryDocumented,
        asBool(data.dependencyInventoryDocumented) ??
          asBool(data.dependency_inventory_documented) ??
          asBool(data.dependenciesDocumented),
      );
      leastPrivilegeConnectivityControlsConfigured = mergeAndBool(
        leastPrivilegeConnectivityControlsConfigured,
        asBool(data.leastPrivilegeConnectivityControlsConfigured) ??
          asBool(data.least_privilege_connectivity_controls_configured) ??
          asBool(data.connectivityControlsConfigured),
      );
      unauthorizedInternalServiceAccessBlockedInProbe = mergeAndBool(
        unauthorizedInternalServiceAccessBlockedInProbe,
        asBool(data.unauthorizedInternalServiceAccessBlockedInProbe) ??
          asBool(data.unauthorized_internal_service_access_blocked_in_probe) ??
          asBool(data.unauthorizedAccessBlocked),
      );
      connectivityControlsMatchDependencyInventory = mergeAndBool(
        connectivityControlsMatchDependencyInventory,
        asBool(data.connectivityControlsMatchDependencyInventory) ??
          asBool(data.connectivity_controls_match_dependency_inventory) ??
          asBool(data.controlsMatchInventory),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentOrToolRuntimesPresent,
    dependencyInventoryDocumented,
    leastPrivilegeConnectivityControlsConfigured,
    unauthorizedInternalServiceAccessBlockedInProbe,
    connectivityControlsMatchDependencyInventory,
    measuredAt,
    sources,
  };
}

export function buildAgentToolConnectivityReport(opts: {
  assessedAt: string;
  dependencyInventory: { found: boolean; refs: string[] };
  connectivityControls: { found: boolean; refs: string[] };
  unauthorizedAccessProbe: { found: boolean; refs: string[] };
  agentToolRuntimes: { found: boolean; refs: string[] };
  imported: AgentToolConnectivityReport["importedResults"];
}): AgentToolConnectivityReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.dependencyInventory.found ||
    opts.connectivityControls.found ||
    opts.unauthorizedAccessProbe.found ||
    opts.agentToolRuntimes.found;
  // Runtime or dependency inventory proves INF-M3 surface for N/A override.
  const surfaceProvedForNaOverride =
    opts.agentToolRuntimes.found || opts.dependencyInventory.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No agent/tool connectivity signals — INF-M3 remains not demonstrated until dependency inventory + network/identity controls + unauthorized-access probe evidence or an explicit N/A attest (agentOrToolRuntimesPresent=false) is imported.",
    );
  }
  if (opts.agentToolRuntimes.found) {
    notes.push(
      `Agent/tool runtime refs: ${opts.agentToolRuntimes.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.dependencyInventory.found) {
    notes.push(
      `Dependency-inventory refs: ${opts.dependencyInventory.refs.slice(0, 3).join(", ")}; inventory alone does not satisfy INF-M3.`,
    );
  }
  if (opts.connectivityControls.found) {
    notes.push(
      `Connectivity-control refs: ${opts.connectivityControls.refs.slice(0, 3).join(", ")}; controls alone do not prove unauthorized access is blocked.`,
    );
  }
  if (opts.unauthorizedAccessProbe.found) {
    notes.push(
      `Unauthorized-access probe refs: ${opts.unauthorizedAccessProbe.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.agentOrToolRuntimesPresent}, deps=${opts.imported.dependencyInventoryDocumented}, controls=${opts.imported.leastPrivilegeConnectivityControlsConfigured}, match=${opts.imported.connectivityControlsMatchDependencyInventory}, unauthorizedBlocked=${opts.imported.unauthorizedInternalServiceAccessBlockedInProbe}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import inventory (or present=true) plus dependencyInventoryDocumented=true + leastPrivilegeConnectivityControlsConfigured=true + connectivityControlsMatchDependencyInventory=true + unauthorizedInternalServiceAccessBlockedInProbe=true (measuredAt ≤90d) under imports/agent-tool-connectivity/ to PASS. Set agentOrToolRuntimesPresent=false for NOT_APPLICABLE. SEC-M4 model-path proxy evidence alone does not PASS INF-M3.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.agentOrToolRuntimesPresent === false &&
    !surfaceProvedForNaOverride;
  const scopePresent = opts.imported.agentOrToolRuntimesPresent === true;
  // PASS requires runtime/dependency inventory — controls or probes alone
  // must not unlock INF-M3 even with perfect import metrics.
  const inventoryPresent =
    opts.agentToolRuntimes.found ||
    opts.dependencyInventory.found ||
    scopePresent;

  const depsOk = opts.imported.dependencyInventoryDocumented === true;
  const controlsOk =
    opts.imported.leastPrivilegeConnectivityControlsConfigured === true;
  const matchOk =
    opts.imported.connectivityControlsMatchDependencyInventory === true;
  const probeOk =
    opts.imported.unauthorizedInternalServiceAccessBlockedInProbe === true;

  let statusHint: AgentToolConnectivityReport["summary"]["statusHint"];
  let infM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.dependencyInventoryDocumented === false ||
      opts.imported.leastPrivilegeConnectivityControlsConfigured === false ||
      opts.imported.connectivityControlsMatchDependencyInventory === false ||
      opts.imported.unauthorizedInternalServiceAccessBlockedInProbe === false);

  if (
    opts.imported.found &&
    opts.imported.agentOrToolRuntimesPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    infM3Satisfied = null;
    notes.push(
      "Imported agentOrToolRuntimesPresent=false — INF-M3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.agentOrToolRuntimesPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported agentOrToolRuntimesPresent=false ignored — in-repo agent/tool runtime or dependency inventory proves the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      infM3Satisfied = false;
      notes.push(
        "Imported evidence shows missing dependency inventory, connectivity controls, inventory match, or unauthorized-access deny probe — INF-M3 fail.",
      );
    } else if (
      inventoryPresent &&
      depsOk &&
      controlsOk &&
      matchOk &&
      probeOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      infM3Satisfied = true;
    } else {
      statusHint = "partial";
      infM3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    infM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    infM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing dependency inventory, connectivity controls, inventory match, or unauthorized-access deny probe — INF-M3 fail.",
    );
  } else if (
    inventoryPresent &&
    depsOk &&
    controlsOk &&
    matchOk &&
    probeOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    infM3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    infM3Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires agent/tool runtime or dependency inventory (in-repo or agentOrToolRuntimesPresent=true) — connectivity-control/probe signals alone are insufficient.",
      );
    }
    if (opts.imported.found && !depsOk) {
      notes.push("Import must show dependencyInventoryDocumented=true.");
    }
    if (opts.imported.found && !controlsOk) {
      notes.push(
        "Import must show leastPrivilegeConnectivityControlsConfigured=true.",
      );
    }
    if (opts.imported.found && !matchOk) {
      notes.push(
        "Import must show connectivityControlsMatchDependencyInventory=true.",
      );
    }
    if (opts.imported.found && !probeOk) {
      notes.push(
        "Import must show unauthorizedInternalServiceAccessBlockedInProbe=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INF-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    infM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      dependencyInventory: opts.dependencyInventory,
      connectivityControls: opts.connectivityControls,
      unauthorizedAccessProbe: opts.unauthorizedAccessProbe,
      agentToolRuntimes: opts.agentToolRuntimes,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      infM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentToolConnectivityCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const depRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DEPENDENCY_INV_RE.test(path) || DEPENDENCY_INV_RE.test(text),
      10,
    );
    const connRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CONNECTIVITY_RE.test(path) || CONNECTIVITY_RE.test(text),
      10,
    );
    const probeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROBE_RE.test(path) || PROBE_RE.test(text),
      10,
    );
    const runtimeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AGENT_TOOL_RUNTIME_RE.test(path) || AGENT_TOOL_RUNTIME_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAgentToolConnectivityReport({
      assessedAt: ctx.assessedAt.toISOString(),
      dependencyInventory: { found: depRefs.length > 0, refs: depRefs },
      connectivityControls: { found: connRefs.length > 0, refs: connRefs },
      unauthorizedAccessProbe: { found: probeRefs.length > 0, refs: probeRefs },
      agentToolRuntimes: { found: runtimeRefs.length > 0, refs: runtimeRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-tool-connectivity-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/agent-tool-connectivity-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "agent-tool-connectivity",
          "inf-m3",
          DETECTOR_ID,
          ...(report.summary.infM3Satisfied ? ["inf-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.dependencyInventory.refs,
        ...report.signals.connectivityControls.refs,
        ...report.signals.unauthorizedAccessProbe.refs,
        ...report.signals.agentToolRuntimes.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["agent-tool-connectivity-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INF-M3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.infM3Satisfied}; report=imports/${PLUGIN_ID}/agent-tool-connectivity-report.json`,
      nodes,
    };
  },
};
