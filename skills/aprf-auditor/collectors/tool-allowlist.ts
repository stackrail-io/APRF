/**
 * tool-allowlist — TOL-M2 / repo-tool-allowlist.
 *
 * Discovers per-agent tool allowlists and unknown-tool deny tests.
 * Import coverage under imports/tool-allowlist/ unlocks PASS (measuredAt ≤90d).
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
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "tool-allowlist";
const RELATED = ["TOL-M2"] as const;
const DETECTOR_ID = "repo-tool-allowlist";
const IMPORT_MAX_AGE_DAYS = 90;

const ALLOWLIST_RE =
  /\b(tool[_-]?allowlist|allowed[_-]?tools|per[_-]?agent[_-]?tools|explicit[_-]?tool[_-]?list)\b/i;
const MCP_ALLOWLIST_RE =
  /\b(mcp[_-]?allowlist|mcp[_-]?tool[_-]?allow|allowedMcpTools|tools:\s*\[)\b/i;

export interface ToolAllowlistReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    toolAllowlist: { found: boolean; refs: string[] };
    mcpAllowlist: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAgentsOrToolWorkloadsPresent: boolean | null;
    agentsWithExplicitToolAllowlistPct: number | null;
    unknownToolRequestsDeniedPct: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolM2Satisfied: boolean | null;
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
): ToolAllowlistReport["importedResults"] {
  const sources: string[] = [];
  let productionAgentsOrToolWorkloadsPresent: boolean | null = null;
  let agentsWithExplicitToolAllowlistPct: number | null = null;
  let unknownToolRequestsDeniedPct: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/tool-allowlist-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionAgentsOrToolWorkloadsPresent = mergeOrBool(
        productionAgentsOrToolWorkloadsPresent,
        asBool(data.productionAgentsOrToolWorkloadsPresent) ??
          asBool(data.production_agents_or_tool_workloads_present),
      );
      agentsWithExplicitToolAllowlistPct = mergeMinNum(
        agentsWithExplicitToolAllowlistPct,
        asNum(data.agentsWithExplicitToolAllowlistPct) ??
          asNum(data.agents_with_explicit_tool_allowlist_pct),
      );
      unknownToolRequestsDeniedPct = mergeMinNum(
        unknownToolRequestsDeniedPct,
        asNum(data.unknownToolRequestsDeniedPct) ??
          asNum(data.unknown_tool_requests_denied_pct),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAgentsOrToolWorkloadsPresent,
    agentsWithExplicitToolAllowlistPct,
    unknownToolRequestsDeniedPct,
    measuredAt,
    sources,
  };
}

export function buildToolAllowlistReport(opts: {
  assessedAt: string;
  toolAllowlist: { found: boolean; refs: string[] };
  mcpAllowlist: { found: boolean; refs: string[] };
  imported: ToolAllowlistReport["importedResults"];
}): ToolAllowlistReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.toolAllowlist.found || opts.mcpAllowlist.found;
  const surfaceProvedForNaOverride =
    opts.toolAllowlist.found || opts.mcpAllowlist.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No tool-allowlist signals — TOL-M2 remains not demonstrated until allowlist/deny coverage or productionAgentsOrToolWorkloadsPresent=false is imported.",
    );
  }
  if (opts.toolAllowlist.found) {
    notes.push(
      `Tool-allowlist refs: ${opts.toolAllowlist.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.mcpAllowlist.found) {
    notes.push(
      `MCP-allowlist refs: ${opts.mcpAllowlist.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionAgentsOrToolWorkloadsPresent}, allowlistPct=${opts.imported.agentsWithExplicitToolAllowlistPct}, denyPct=${opts.imported.unknownToolRequestsDeniedPct}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import agentsWithExplicitToolAllowlistPct=100 + unknownToolRequestsDeniedPct=100 (measuredAt ≤90d) under imports/tool-allowlist/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.productionAgentsOrToolWorkloadsPresent === true;
  const allowlistOk = opts.imported.agentsWithExplicitToolAllowlistPct === 100;
  const denyOk = opts.imported.unknownToolRequestsDeniedPct === 100;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionAgentsOrToolWorkloadsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.agentsWithExplicitToolAllowlistPct !== null &&
      opts.imported.agentsWithExplicitToolAllowlistPct < 100) ||
    (opts.imported.unknownToolRequestsDeniedPct !== null &&
      opts.imported.unknownToolRequestsDeniedPct < 100);
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    contradictingFail;

  let statusHint: ToolAllowlistReport["summary"]["statusHint"];
  let tolM2Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolM2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete allowlist coverage or unknown-tool deny — TOL-M2 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolM2Satisfied = null;
    notes.push(
      "Imported productionAgentsOrToolWorkloadsPresent=false — TOL-M2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionAgentsOrToolWorkloadsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionAgentsOrToolWorkloadsPresent=false ignored — in-repo allowlist signals prove the surface exists.",
    );
    if (
      surfacePresent &&
      allowlistOk &&
      denyOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      tolM2Satisfied = true;
    } else {
      statusHint = "partial";
      tolM2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolM2Satisfied = null;
  } else if (
    surfacePresent &&
    allowlistOk &&
    denyOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolM2Satisfied = true;
  } else {
    statusHint = "partial";
    tolM2Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      toolAllowlist: opts.toolAllowlist,
      mcpAllowlist: opts.mcpAllowlist,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const toolAllowlistCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const allowlistRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ALLOWLIST_RE.test(p) || ALLOWLIST_RE.test(t),
      10,
    );
    const mcpRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MCP_ALLOWLIST_RE.test(p) || MCP_ALLOWLIST_RE.test(t),
      10,
    );

    const report = buildToolAllowlistReport({
      assessedAt: ctx.assessedAt.toISOString(),
      toolAllowlist: { found: allowlistRefs.length > 0, refs: allowlistRefs },
      mcpAllowlist: { found: mcpRefs.length > 0, refs: mcpRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "tool-allowlist-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M2 status=${report.summary.statusHint} satisfied=${report.summary.tolM2Satisfied}; report=imports/${PLUGIN_ID}/tool-allowlist-report.json`,
      nodes: [
        {
          id: `${PLUGIN_ID}:report`,
          class: "ci",
          ref: `imports/${PLUGIN_ID}/tool-allowlist-report.json`,
          pluginId: PLUGIN_ID,
          signals: [
            PLUGIN_ID,
            "tol-m2",
            DETECTOR_ID,
            ...(report.summary.tolM2Satisfied ? ["tol-m2-satisfied"] : []),
          ],
          excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
          relatedCheckIds: [...RELATED],
        } satisfies EvidenceNode,
      ],
    };
  },
};
