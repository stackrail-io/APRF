/**
 * ai-external-tool-inventory — SCI-M2 / repo-ai-external-tool-inventory.
 *
 * Discovers MCP / agent-plugin / tool-registry / high-impact integration pins.
 * Import coverage under imports/ai-external-tool-inventory/ unlocks PASS
 * (measuredAt ≤90d). Package lockfiles / CI Action SHA pins alone ≠ PASS.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import { ensureDir, listImportFiles, readText, redact } from "./lib/fs.ts";
import { asNum, collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-external-tool-inventory";
const RELATED = ["SCI-M2"] as const;
const DETECTOR_ID = "repo-ai-external-tool-inventory";
const IMPORT_MAX_AGE_DAYS = 90;

const MCP_RE =
  /\b(mcp[_-]?(server|config|json)|model[_-]?context[_-]?protocol|mcpServers|StdioServerParameters)\b/i;
const PLUGIN_RE =
  /\b(agent[_-]?plugin|tool[_-]?(plugin|extension)|langchain[_-]?tool|crewai[_-]?tool)\b/i;
const TOOL_REG_RE =
  /\b(tool[_-]?(catalog|registry|inventory|allowlist)|external[_-]?ai[_-]?tool)\b/i;
const PIN_RE =
  /\b(version[_-]?pin|pinned[_-]?version|@sha256:|commit[_-]?sha|exact[_-]?version)\b/i;

export interface AiExternalToolInventoryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    mcp: { found: boolean; refs: string[] };
    agentPlugin: { found: boolean; refs: string[] };
    toolRegistry: { found: boolean; refs: string[] };
    versionPin: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiExternalToolsOrIntegrationsPresent: boolean | null;
    entriesWithPinOwnerReviewPct: number | null;
    unpinnedLatestOrFloatingEntries: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    sciM2Satisfied: boolean | null;
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

function loadImported(
  ctx: CollectorContext,
): AiExternalToolInventoryReport["importedResults"] {
  const sources: string[] = [];
  let productionAiExternalToolsOrIntegrationsPresent: boolean | null = null;
  let entriesWithPinOwnerReviewPct: number | null = null;
  let unpinnedLatestOrFloatingEntries: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-external-tool-inventory-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAiExternalToolsOrIntegrationsPresent = mergeOrBool(
        productionAiExternalToolsOrIntegrationsPresent,
        asBool(data.productionAiExternalToolsOrIntegrationsPresent) ??
          asBool(data.production_ai_external_tools_or_integrations_present),
      );
      entriesWithPinOwnerReviewPct = mergeMinNum(
        entriesWithPinOwnerReviewPct,
        asNum(data.entriesWithPinOwnerReviewPct) ??
          asNum(data.entries_with_pin_owner_review_pct) ??
          asNum(data.pinOwnerReviewCoveragePct),
      );
      unpinnedLatestOrFloatingEntries = mergeMaxNum(
        unpinnedLatestOrFloatingEntries,
        asNum(data.unpinnedLatestOrFloatingEntries) ??
          asNum(data.unpinned_latest_or_floating_entries),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiExternalToolsOrIntegrationsPresent,
    entriesWithPinOwnerReviewPct,
    unpinnedLatestOrFloatingEntries,
    measuredAt,
    sources,
  };
}

export function buildAiExternalToolInventoryReport(opts: {
  assessedAt: string;
  mcp: { found: boolean; refs: string[] };
  agentPlugin: { found: boolean; refs: string[] };
  toolRegistry: { found: boolean; refs: string[] };
  versionPin: { found: boolean; refs: string[] };
  imported: AiExternalToolInventoryReport["importedResults"];
}): AiExternalToolInventoryReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.mcp.found ||
    opts.agentPlugin.found ||
    opts.toolRegistry.found ||
    opts.versionPin.found;
  const surfaceProvedForNaOverride =
    opts.mcp.found || opts.agentPlugin.found || opts.toolRegistry.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI external-tool inventory signals — SCI-M2 remains not demonstrated until inventory + pin/owner/review coverage or productionAiExternalToolsOrIntegrationsPresent=false is imported.",
    );
  }
  if (opts.mcp.found) {
    notes.push(`MCP refs: ${opts.mcp.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.agentPlugin.found) {
    notes.push(
      `Agent-plugin refs: ${opts.agentPlugin.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.toolRegistry.found) {
    notes.push(
      `Tool-registry refs: ${opts.toolRegistry.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionAiExternalToolsOrIntegrationsPresent}, pinOwnerReviewPct=${opts.imported.entriesWithPinOwnerReviewPct}, unpinned=${opts.imported.unpinnedLatestOrFloatingEntries}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import entriesWithPinOwnerReviewPct=100 + unpinnedLatestOrFloatingEntries=0 (measuredAt ≤90d) under imports/ai-external-tool-inventory/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const coverageOk = opts.imported.entriesWithPinOwnerReviewPct === 100;
  const unpinnedOk = opts.imported.unpinnedLatestOrFloatingEntries === 0;
  const inventoryPresent =
    surfaceProvedForNaOverride ||
    opts.imported.productionAiExternalToolsOrIntegrationsPresent === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionAiExternalToolsOrIntegrationsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.unpinnedLatestOrFloatingEntries !== null &&
      opts.imported.unpinnedLatestOrFloatingEntries > 0) ||
    (opts.imported.entriesWithPinOwnerReviewPct !== null &&
      opts.imported.entriesWithPinOwnerReviewPct < 100);
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: AiExternalToolInventoryReport["summary"]["statusHint"];
  let sciM2Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    sciM2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete pin/owner/review coverage or unpinned latest/floating entries — SCI-M2 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    sciM2Satisfied = null;
    notes.push(
      "Imported productionAiExternalToolsOrIntegrationsPresent=false — SCI-M2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAiExternalToolsOrIntegrationsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAiExternalToolsOrIntegrationsPresent=false ignored — in-repo MCP/plugin/tool-registry signals prove the surface exists.",
    );
    if (
      inventoryPresent &&
      coverageOk &&
      unpinnedOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sciM2Satisfied = true;
    } else {
      statusHint = "partial";
      sciM2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciM2Satisfied = null;
  } else if (
    inventoryPresent &&
    coverageOk &&
    unpinnedOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sciM2Satisfied = true;
  } else {
    statusHint = "partial";
    sciM2Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      mcp: opts.mcp,
      agentPlugin: opts.agentPlugin,
      toolRegistry: opts.toolRegistry,
      versionPin: opts.versionPin,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      sciM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiExternalToolInventoryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const mcpRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MCP_RE.test(p) || MCP_RE.test(t),
      10,
    );
    const pluginRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => PLUGIN_RE.test(p) || PLUGIN_RE.test(t),
      10,
    );
    const regRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => TOOL_REG_RE.test(p) || TOOL_REG_RE.test(t),
      10,
    );
    const pinRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => PIN_RE.test(p) || PIN_RE.test(t),
      10,
    );

    const report = buildAiExternalToolInventoryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      mcp: { found: mcpRefs.length > 0, refs: mcpRefs },
      agentPlugin: { found: pluginRefs.length > 0, refs: pluginRefs },
      toolRegistry: { found: regRefs.length > 0, refs: regRefs },
      versionPin: { found: pinRefs.length > 0, refs: pinRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-external-tool-inventory-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-external-tool-inventory-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          PLUGIN_ID,
          "sci-m2",
          DETECTOR_ID,
          "mcp-package-pinned",
          ...(report.summary.sciM2Satisfied ? ["sci-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-M2 status=${report.summary.statusHint} satisfied=${report.summary.sciM2Satisfied}; report=imports/${PLUGIN_ID}/ai-external-tool-inventory-report.json`,
      nodes,
    };
  },
};
