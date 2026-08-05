/**
 * agent-charter-inventory — AGN-M1 / repo-agent-charter-inventory detector.
 *
 * Finds agent inventory + charter artifacts with required governance fields.
 * Import a measured inventory export under imports/agent-charter-inventory/ to
 * unlock PASS (0 missing fields). Default finding severity is high; escalate to
 * critical when inventory completeness or ownership cannot be demonstrated.
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
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-charter-inventory";
const RELATED = ["AGN-M1"] as const;
const DETECTOR_ID = "repo-agent-charter-inventory";

const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|charter|inventory)/i;

const INVENTORY_PATH_RE =
  /(agent.?inventory|agents\.(ya?ml|json|toml|md)|charters?[/\\]|AGENT\.md|agents[/\\]registry)/i;

const PURPOSE_RE =
  /\b(purpose|goal|mission|charter|description|objectives?)\b/i;
const TOOL_ALLOW_RE =
  /\b(allowedTools|tool[_-]?allowlist|allowed[_-]?tools|tools?[_-]?(list|allow)|tool[_-]?policy|mcp[_-]?tools|approved[_-]?tool|forbiddenTools)\b/i;
const DATA_SCOPE_RE =
  /\b(data[_-]?scope|corpus|corpora|knowledge[_-]?base|retrieval[_-]?scope|data[_-]?access)\b/i;
const AUTONOMY_RE =
  /\b(autonomy|max[_-]?steps|spawn[_-]?depth|wall[_-]?clock|limits?|escalation|budget|boundaries)\b/i;
const OWNER_RE =
  /\b(owner|owned[_-]?by|raci|maintainer|team|accountability)\b/i;
const REVIEW_DATE_RE =
  /\b(review[_-]?date|reviewed[_-]?at|next[_-]?review|last[_-]?reviewed)\b/i;
const LAST_UPDATED_RE =
  /\b(last[_-]?updated|updated[_-]?at|modified[_-]?at|last[_-]?modified)\b/i;
const CHARTER_VERSION_RE =
  /\b(agentVersion|agent[_-]?version|charter[_-]?version|version)\b/i;
const APPROVAL_STATUS_RE =
  /\b(approvalPolicy|approval[_-]?policy|approval[_-]?status|approved|approval[_-]?state|sign[_-]?off)\b/i;

export type AgnM1SeverityHint = "high" | "critical";

export interface AgentCharterInventoryReport {
  schemaVersion: "0.3.0";
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
    reviewDate: boolean;
    lastUpdated: boolean;
    charterVersion: boolean;
    approvalStatus: boolean;
  };
  fieldRefs: Record<string, string[]>;
  importedResults: {
    found: boolean;
    agentCount: number | null;
    missingFieldCount: number | null;
    missingOwnerCount: number | null;
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
    /** Catalog default is high; critical when completeness/ownership fails. */
    severityHint: AgnM1SeverityHint;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
  /** Gap-only guidance for assess/report flyouts (excludes informational scan notes). */
  gapNotes: string[];
}

function agentHasGovernanceField(
  a: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.some((k) => {
    const v = a[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number" || typeof v === "boolean") return true;
    if (typeof v === "object") return true;
    return false;
  });
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
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
    if (isSkippedScanRelPath(r)) continue;
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
  let missingOwnerCount: number | null = null;
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
        let missingOwners = 0;
        for (const a of agents) {
          const hasPurpose = agentHasGovernanceField(a, [
            "purpose",
            "goal",
            "mission",
          ]);
          const hasTools = agentHasGovernanceField(a, [
            "allowedTools",
            "allowed_tools",
            "toolAllowlist",
            "tool_allowlist",
            "tools",
            "approvedToolPolicy",
            "approved_tool_policy",
          ]);
          const hasData = agentHasGovernanceField(a, [
            "dataScope",
            "data_scope",
            "corpus",
          ]);
          const hasAutonomy = agentHasGovernanceField(a, [
            "autonomy",
            "autonomyLimits",
            "autonomyBoundaries",
            "autonomy_boundaries",
            "max_steps",
            "limits",
          ]);
          const hasOwner = agentHasGovernanceField(a, [
            "owner",
            "owned_by",
            "team",
          ]);
          const hasReview = agentHasGovernanceField(a, [
            "reviewDate",
            "review_date",
            "reviewedAt",
            "reviewed_at",
            "nextReview",
          ]);
          const hasUpdated = agentHasGovernanceField(a, [
            "lastUpdated",
            "last_updated",
            "updatedAt",
            "updated_at",
            "modifiedAt",
          ]);
          const hasVersion = agentHasGovernanceField(a, [
            "agentVersion",
            "agent_version",
            "charterVersion",
            "charter_version",
            "version",
          ]);
          const hasApproval = agentHasGovernanceField(a, [
            "approvalPolicy",
            "approval_policy",
            "approvalStatus",
            "approval_status",
            "approved",
            "approvalState",
          ]);
          if (!hasOwner) missingOwners++;
          if (
            !hasPurpose ||
            !hasTools ||
            !hasData ||
            !hasAutonomy ||
            !hasOwner ||
            !hasReview ||
            !hasUpdated ||
            !hasVersion ||
            !hasApproval
          ) {
            missing++;
          }
        }
        missingFieldCount = (missingFieldCount ?? 0) + missing;
        missingOwnerCount = (missingOwnerCount ?? 0) + missingOwners;
        complete =
          complete === null ? missing === 0 : complete && missing === 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentCount,
    missingFieldCount,
    missingOwnerCount,
    complete,
    coversAllProductionAgents,
    measuredAt,
    sources,
  };
}

function allRequiredFieldsPresent(
  fields: AgentCharterInventoryReport["fields"],
): boolean {
  return (
    fields.purpose &&
    fields.toolAllowlist &&
    fields.dataScope &&
    fields.autonomyLimits &&
    fields.owner &&
    fields.reviewDate &&
    fields.lastUpdated &&
    fields.charterVersion &&
    fields.approvalStatus
  );
}

function severityHintFor(
  statusHint: AgentCharterInventoryReport["summary"]["statusHint"],
  opts: {
    agentSignals: boolean;
    inventoryFound: boolean;
    imported: AgentCharterInventoryReport["importedResults"];
  },
): AgnM1SeverityHint {
  if (statusHint === "pass" || statusHint === "not_applicable") return "high";

  const completenessUnproven =
    (opts.imported.found && opts.imported.coversAllProductionAgents !== true) ||
    (!opts.imported.found && opts.agentSignals);
  const unenumerable =
    statusHint === "not_demonstrated" && opts.agentSignals && !opts.inventoryFound;
  const ownerless =
    (opts.imported.missingOwnerCount ?? 0) > 0 ||
    (opts.imported.found &&
      opts.imported.complete === false &&
      (opts.imported.missingOwnerCount ?? 0) > 0);

  if (completenessUnproven || unenumerable || ownerless) return "critical";
  return "high";
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
  const gapNotes: string[] = [];
  const pushInfo = (msg: string) => {
    notes.push(msg);
  };
  const pushGap = (msg: string) => {
    notes.push(msg);
    gapNotes.push(msg);
  };
  const allFields = allRequiredFieldsPresent(opts.fields);

  if (!opts.agentSignals && !opts.inventory.found && !opts.charters.found) {
    pushInfo(
      "No agent/charter signals — AGN-M1 may be NOT_APPLICABLE if there are no production agents.",
    );
  }
  if (opts.inventory.found) {
    pushInfo(`Inventory refs: ${opts.inventory.refs.slice(0, 4).join(", ")}`);
  } else {
    pushGap(
      "No agent inventory manifest found (agents.yaml / charters/ / AGENT.md / registry).",
    );
  }
  if (opts.charters.found) {
    pushInfo(`Charter-like refs: ${opts.charters.refs.slice(0, 4).join(", ")}`);
  }
  for (const [k, present] of Object.entries(opts.fields)) {
    if (present) {
      pushInfo(
        `Field ${k}: ${opts.fieldRefs[k]?.slice(0, 2).join(", ") || "present"}`,
      );
    } else {
      pushGap(`Required charter field missing in repo scan: ${k}`);
    }
  }
  if (opts.imported.found) {
    pushInfo(
      `Imported: ${opts.imported.sources.join(", ")} (agents=${opts.imported.agentCount}, missingFields=${opts.imported.missingFieldCount}, missingOwners=${opts.imported.missingOwnerCount}, complete=${opts.imported.complete})`,
    );
  } else if (opts.inventory.found || allFields || opts.charters.found || opts.agentSignals) {
    pushGap(
      "Repo scan cannot unlock AGN-M1 PASS alone — need a measured inventory export (complete=true, 0 missing governance fields, coversAllProductionAgents=true, fresh measuredAt ≤90d) under imports/agent-charter-inventory/.",
    );
    pushGap(
      "Agent count from tags/release branches is not enough: AGN-M1 requires purpose, owner, approved tool policy, data scope, autonomy boundaries, review date, last updated, charter version, and approval status per production agent.",
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
    pushGap(
      "Imported inventory has agents missing required governance metadata — AGN-M1 fail.",
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
      pushGap(
        "Import missing coversAllProductionAgents=true — cannot prove inventory lists every production agent (escalate severity to critical).",
      );
    }
    if (opts.imported.found && opts.imported.complete !== true) {
      pushGap(
        "Import missing complete=true — required to unlock AGN-M1 PASS.",
      );
    }
    if (opts.imported.found && !measuredAtFresh(opts.imported.measuredAt)) {
      pushGap(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-M1 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    agnM1Satisfied = null;
    pushGap(
      "Agent signals present but production agents cannot be enumerated via inventory/charter artifacts (escalate severity to critical).",
    );
  } else {
    statusHint = "not_demonstrated";
    agnM1Satisfied = null;
  }

  const severityHint = severityHintFor(statusHint, {
    agentSignals: opts.agentSignals,
    inventoryFound: opts.inventory.found,
    imported: opts.imported,
  });
  if (
    severityHint === "critical" &&
    statusHint !== "pass" &&
    statusHint !== "not_applicable"
  ) {
    pushGap(
      "severityHint=critical — inventory completeness or accountable ownership cannot be demonstrated.",
    );
  } else if (statusHint !== "pass" && statusHint !== "not_applicable") {
    pushInfo(
      "severityHint=high — missing charter/governance metadata on known agents (not an immediate exploit class by default).",
    );
  }

  return {
    schemaVersion: "0.3.0",
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
      severityHint,
      statusHint,
    },
    notes,
    gapNotes: gapNotes.slice(0, 8),
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
    const reviewDate = fieldScan(REVIEW_DATE_RE);
    const lastUpdated = fieldScan(LAST_UPDATED_RE);
    const charterVersion = fieldScan(CHARTER_VERSION_RE);
    const approvalStatus = fieldScan(APPROVAL_STATUS_RE);

    const fields = {
      purpose: purpose.found,
      toolAllowlist: tools.found,
      dataScope: data.found,
      autonomyLimits: autonomy.found,
      owner: owner.found,
      reviewDate: reviewDate.found,
      lastUpdated: lastUpdated.found,
      charterVersion: charterVersion.found,
      approvalStatus: approvalStatus.found,
    };
    const fieldRefs: Record<string, string[]> = {
      purpose: purpose.refs,
      toolAllowlist: tools.refs,
      dataScope: data.refs,
      autonomyLimits: autonomy.refs,
      owner: owner.refs,
      reviewDate: reviewDate.refs,
      lastUpdated: lastUpdated.refs,
      charterVersion: charterVersion.refs,
      approvalStatus: approvalStatus.refs,
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
      detail: `AGN-M1 status=${report.summary.statusHint} severity=${report.summary.severityHint} inventory=${report.summary.inventoryPresent} fields=${report.summary.allRequiredFieldsPresent} satisfied=${report.summary.agnM1Satisfied}; report=imports/${PLUGIN_ID}/agent-charter-inventory-report.json`,
      nodes,
    };
  },
};
