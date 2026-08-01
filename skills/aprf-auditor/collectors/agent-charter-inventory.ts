/**
 * agent-charter-inventory — AGN-M1 / repo-agent-charter-inventory detector.
 *
 * Finds agent inventory + charter artifacts with required fields (purpose, tool
 * allowlist, data scope, autonomy limits, owner). Import a measured inventory
 * export under imports/agent-charter-inventory/ to unlock PASS (0 missing fields).
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
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-charter-inventory";
const RELATED = ["AGN-M1"] as const;
const DETECTOR_ID = "repo-agent-charter-inventory";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|charter|inventory)/i;

const INVENTORY_PATH_RE =
  /(agent.?inventory|agents\.(ya?ml|json|toml|md)|charters?[/\\]|AGENT\.md|agents[/\\]registry)/i;

const PURPOSE_RE =
  /\b(purpose|goal|mission|charter|description|objectives?)\b/i;
const TOOL_ALLOW_RE =
  /\b(tool[_-]?allowlist|allowed[_-]?tools|tools?[_-]?(list|allow)|tool[_-]?policy|mcp[_-]?tools)\b/i;
const DATA_SCOPE_RE =
  /\b(data[_-]?scope|corpus|corpora|knowledge[_-]?base|retrieval[_-]?scope|data[_-]?access)\b/i;
const AUTONOMY_RE =
  /\b(autonomy|max[_-]?steps|spawn[_-]?depth|wall[_-]?clock|limits?|escalation|budget)\b/i;
const OWNER_RE =
  /\b(owner|owned[_-]?by|raci|maintainer|team|accountability)\b/i;

export interface AgentCharterInventoryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  inventory: { found: boolean; refs: string[] };
  charters: { found: boolean; refs: string[] };
  fields: {
    purpose: boolean;
    toolAllowlist: boolean;
    dataScope: boolean;
    autonomyLimits: boolean;
    owner: boolean;
  };
  fieldRefs: Record<string, string[]>;
  importedResults: {
    found: boolean;
    agentCount: number | null;
    missingFieldCount: number | null;
    complete: boolean | null;
    coversAllProductionAgents: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    inventoryPresent: boolean;
    allRequiredFieldsPresent: boolean;
    agnM1Satisfied: boolean | null;
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
  limit = 20,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".py",
      ".ts",
      ".js",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
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

function detectAgentSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AGENT_PATH_RE.test(path) ||
        /\b(AgentExecutor|create_react_agent|langgraph|CrewAI|AutoGen|multi-?agent)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AgentCharterInventoryReport["importedResults"] {
  const sources: string[] = [];
  let agentCount: number | null = null;
  let missingFieldCount: number | null = null;
  let complete: boolean | null = null;
  let coversAllProductionAgents: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-charter-inventory-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      coversAllProductionAgents =
        asBool(data.coversAllProductionAgents) ??
        asBool(data.covers_all_production_agents) ??
        asBool(data.inventoryComplete) ??
        coversAllProductionAgents;
      if (typeof data.agentCount === "number") agentCount = data.agentCount;
      if (typeof data.missingFieldCount === "number") {
        missingFieldCount = data.missingFieldCount;
      }
      if (typeof data.complete === "boolean") complete = data.complete;

      const agents = Array.isArray(data.agents)
        ? (data.agents as Array<Record<string, unknown>>)
        : Array.isArray(data.inventory)
          ? (data.inventory as Array<Record<string, unknown>>)
          : [];
      if (agents.length) {
        agentCount = (agentCount ?? 0) + agents.length;
        let missing = 0;
        for (const a of agents) {
          const required = [
            "purpose",
            "toolAllowlist",
            "tool_allowlist",
            "tools",
            "dataScope",
            "data_scope",
            "autonomyLimits",
            "autonomy",
            "owner",
          ];
          const hasPurpose = !!(a.purpose || a.goal || a.mission);
          const hasTools = !!(
            a.toolAllowlist ||
            a.tool_allowlist ||
            a.tools ||
            a.allowed_tools
          );
          const hasData = !!(a.dataScope || a.data_scope || a.corpus);
          const hasAutonomy = !!(
            a.autonomyLimits ||
            a.autonomy ||
            a.max_steps ||
            a.limits
          );
          const hasOwner = !!(a.owner || a.owned_by || a.team);
          if (!hasPurpose || !hasTools || !hasData || !hasAutonomy || !hasOwner) {
            missing++;
          }
          void required;
        }
        missingFieldCount = (missingFieldCount ?? 0) + missing;
        complete =
          complete === null
            ? missing === 0
            : complete && missing === 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentCount,
    missingFieldCount,
    complete,
    coversAllProductionAgents,
    measuredAt,
    sources,
  };
}

export function buildAgentCharterInventoryReport(opts: {
  assessedAt: string;
  inventory: { found: boolean; refs: string[] };
  charters: { found: boolean; refs: string[] };
  fields: AgentCharterInventoryReport["fields"];
  fieldRefs: Record<string, string[]>;
  agentSignals: boolean;
  imported: AgentCharterInventoryReport["importedResults"];
}): AgentCharterInventoryReport {
  const notes: string[] = [];
  const allFields =
    opts.fields.purpose &&
    opts.fields.toolAllowlist &&
    opts.fields.dataScope &&
    opts.fields.autonomyLimits &&
    opts.fields.owner;

  if (!opts.agentSignals && !opts.inventory.found && !opts.charters.found) {
    notes.push(
      "No agent/charter signals — AGN-M1 may be NOT_APPLICABLE if there are no production agents.",
    );
  }
  if (opts.inventory.found) {
    notes.push(
      `Inventory refs: ${opts.inventory.refs.slice(0, 4).join(", ")}`,
    );
  } else {
    notes.push(
      "No agent inventory manifest found (agents.yaml / charters/ / AGENT.md / registry).",
    );
  }
  if (opts.charters.found) {
    notes.push(`Charter-like refs: ${opts.charters.refs.slice(0, 4).join(", ")}`);
  }
  for (const [k, present] of Object.entries(opts.fields)) {
    if (present) {
      notes.push(
        `Field ${k}: ${opts.fieldRefs[k]?.slice(0, 2).join(", ") || "present"}`,
      );
    } else {
      notes.push(`Required charter field missing in repo scan: ${k}`);
    }
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (agents=${opts.imported.agentCount}, missingFields=${opts.imported.missingFieldCount}, complete=${opts.imported.complete})`,
    );
  } else if (opts.inventory.found || allFields) {
    notes.push(
      "Repo charter/inventory signals alone are PARTIAL — import inventory export with 0 missing fields to PASS.",
    );
  }

  let statusHint: AgentCharterInventoryReport["summary"]["statusHint"];
  let agnM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.missingFieldCount !== null &&
      opts.imported.missingFieldCount > 0) ||
      opts.imported.complete === false);

  if (!opts.agentSignals && !opts.inventory.found && !opts.imported.found) {
    statusHint = "not_applicable";
    agnM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    agnM1Satisfied = false;
    notes.push(
      "Imported inventory has agents missing required charter fields — AGN-M1 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.complete === true &&
    (opts.imported.missingFieldCount === null ||
      opts.imported.missingFieldCount === 0) &&
    (opts.imported.agentCount === null || opts.imported.agentCount > 0) &&
    opts.imported.coversAllProductionAgents === true &&
    measuredAtFresh(opts.imported.measuredAt)
  ) {
    statusHint = "pass";
    agnM1Satisfied = true;
  } else if (opts.inventory.found || opts.charters.found || allFields || opts.imported.found) {
    statusHint = "partial";
    agnM1Satisfied = false;
    if (opts.imported.found && opts.imported.coversAllProductionAgents !== true) {
      notes.push(
        "Import missing coversAllProductionAgents=true — cannot prove inventory lists every production agent.",
      );
    }
    if (opts.imported.found && !measuredAtFresh(opts.imported.measuredAt)) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-M1 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    agnM1Satisfied = null;
    notes.push(
      "Agent signals present but no inventory/charter artifacts with required fields.",
    );
  } else {
    statusHint = "not_demonstrated";
    agnM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    inventory: opts.inventory,
    charters: opts.charters,
    fields: opts.fields,
    fieldRefs: opts.fieldRefs,
    importedResults: opts.imported,
    summary: {
      agentSignalsPresent: opts.agentSignals,
      inventoryPresent: opts.inventory.found,
      allRequiredFieldsPresent: allFields,
      agnM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentCharterInventoryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;

    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        INVENTORY_PATH_RE.test(path) ||
        (/\binventory\b/i.test(path) && AGENT_PATH_RE.test(path + text)) ||
        (/\bagents?\b/i.test(path) &&
          /\b(owner|charter|purpose)\b/i.test(text)),
    );
    const inventory = {
      found: inventoryRefs.length > 0,
      refs: inventoryRefs,
    };

    const charterRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /charter/i.test(path) ||
        (AGENT_PATH_RE.test(path) &&
          PURPOSE_RE.test(text) &&
          (TOOL_ALLOW_RE.test(text) || OWNER_RE.test(text))),
    );
    const charters = { found: charterRefs.length > 0, refs: charterRefs };

    const fieldScan = (
      pattern: RegExp,
    ): { found: boolean; refs: string[] } => {
      const refs = collectRefs(
        ctx.targetPath,
        maxFiles,
        (path, text) =>
          (AGENT_PATH_RE.test(path) ||
            INVENTORY_PATH_RE.test(path) ||
            /charter/i.test(path)) &&
          pattern.test(text),
        12,
      );
      return { found: refs.length > 0, refs };
    };

    const purpose = fieldScan(PURPOSE_RE);
    const tools = fieldScan(TOOL_ALLOW_RE);
    const data = fieldScan(DATA_SCOPE_RE);
    const autonomy = fieldScan(AUTONOMY_RE);
    const owner = fieldScan(OWNER_RE);

    const fields = {
      purpose: purpose.found,
      toolAllowlist: tools.found,
      dataScope: data.found,
      autonomyLimits: autonomy.found,
      owner: owner.found,
    };
    const fieldRefs: Record<string, string[]> = {
      purpose: purpose.refs,
      toolAllowlist: tools.refs,
      dataScope: data.refs,
      autonomyLimits: autonomy.refs,
      owner: owner.refs,
    };

    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);
    const imported = loadImported(ctx);

    const report = buildAgentCharterInventoryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      inventory,
      charters,
      fields,
      fieldRefs,
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-charter-inventory-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/agent-charter-inventory-report.json`,
        excerpt: redact(
          JSON.stringify(
            { summary: report.summary, notes: report.notes.slice(0, 5) },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "agent-charter-inventory",
          "agn-m1",
          DETECTOR_ID,
          ...(report.summary.agnM1Satisfied
            ? ["agn-m1-satisfied"]
            : ["agn-m1-incomplete"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-M1 status=${report.summary.statusHint} inventory=${report.summary.inventoryPresent} fields=${report.summary.allRequiredFieldsPresent} satisfied=${report.summary.agnM1Satisfied}; report=imports/${PLUGIN_ID}/agent-charter-inventory-report.json`,
      nodes,
    };
  },
};
