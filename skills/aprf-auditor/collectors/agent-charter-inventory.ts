/**
 * agent-charter-inventory — AGN-M1 / repo-agent-charter-inventory detector.
 *
 * Finds agent inventory + charter artifacts with required governance fields.
 * Import a measured inventory export under imports/agent-charter-inventory/ to
 * unlock PASS (0 missing fields + completeness evidence). Default finding
 * severity is high; escalate to critical when inventory completeness or
 * ownership cannot be demonstrated. Frameworks/SDKs/libraries alone are N/A.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { getGeneratedCatalog } from "@stackrail-io/aprf-engine";
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

const PLUGIN_ID = "agent-charter-inventory";
const RELATED = ["AGN-M1"] as const;
const DETECTOR_ID = "repo-agent-charter-inventory";

const LIFECYCLE_STATUSES = new Set([
  "active",
  "deprecated",
  "retired",
  "experimental",
]);

const COMPLETENESS_EVIDENCE = new Set([
  "runtime-registry",
  "deployment-manifest",
  "cmdb",
  "platform-registry",
  "approved-attestation",
]);

/** AGN-M1 applicability from catalog YAML. */
function agnM1ScopeLists(): {
  appliesTo: string[];
  notApplicableTo: string[];
} {
  const rule = getGeneratedCatalog().rules.find((r) => r.id === "AGN-M1");
  return {
    appliesTo: rule?.applicability.appliesTo ?? [],
    notApplicableTo: rule?.applicability.notApplicableTo ?? [],
  };
}

/** Agent-ish paths — bare "charter"/"inventory" left to INVENTORY_PATH_RE. */
const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|agent[_-]?charter|agent[_-]?inventory)/i;

const INVENTORY_PATH_RE =
  /(agent.?inventory|agents\.(ya?ml|json|toml|md)|charters?[/\\]|AGENT\.md|agents[/\\]registry)/i;

/** Framework / SDK / library surfaces — N/A unless production inventory exists. */
const FRAMEWORK_ONLY_RE =
  /\b(langgraph|crewai|autogen|openai[_-]?agents([_-]?sdk)?|agents?[_-]?sdk|langchain)\b/i;

/** Agent-specific production runtime cues (not bare cmdb/catalog/k8s). */
const PRODUCTION_RUNTIME_RE =
  /\b(production[_-]?agent|deployed[_-]?agent|agent[_-]?runtime|agent[_-]?fleet|agent[_-]?cmdb|agent[_-]?(service[_-]?)?catalog)\b/i;

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
const APPROVAL_RE =
  /\b(approvalPolicy|approval[_-]?policy|approval[_-]?status|approvedBy|approvalDate|approval\s*:)\b/i;
const LIFECYCLE_RE =
  /\b(lifecycleStatus|lifecycle[_-]?status|lifecycle)\b/i;
/** Prefer explicit production-identifier keys over bare "system"/"application". */
const PRODUCTION_ID_RE =
  /\b(deploymentId|deployment[_-]?id|productionId|production[_-]?id|environment\s*[:=])\b/i;
const CHANGE_CONTROL_RE =
  /\b(changeJustification|change[_-]?justification|revisionHistory|revision[_-]?history)\b/i;

export type AgnM1SeverityHint = "high" | "critical";

export interface AgentCharterInventoryReport {
  schemaVersion: "0.4.0";
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
    productionIdentifier: boolean;
    lifecycleStatus: boolean;
    changeControl: boolean;
    reviewDate: boolean;
    lastUpdated: boolean;
    charterVersion: boolean;
    approval: boolean;
  };
  fieldRefs: Record<string, string[]>;
  importedResults: {
    found: boolean;
    agentCount: number | null;
    missingFieldCount: number | null;
    missingOwnerCount: number | null;
    complete: boolean | null;
    coversAllProductionAgents: boolean | null;
    completenessEvidence: string | null;
    productionAgentsPresent: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    inventoryPresent: boolean;
    allRequiredFieldsPresent: boolean;
    completenessProven: boolean;
    inScope: boolean;
    naReason: string | null;
    appliesTo: string[];
    notApplicableTo: string[];
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

function agentHasLifecycle(a: Record<string, unknown>): boolean {
  // Do not accept generic `status` (health/deploy fields collide).
  const raw = a.lifecycleStatus ?? a.lifecycle_status ?? a.lifecycle;
  if (typeof raw !== "string") return false;
  return LIFECYCLE_STATUSES.has(raw.trim().toLowerCase());
}

function agentHasProductionIdentifier(a: Record<string, unknown>): boolean {
  return agentHasGovernanceField(a, [
    "environment",
    "system",
    "application",
    "deploymentId",
    "deployment_id",
    "productionId",
    "production_id",
  ]);
}

function agentHasChangeControl(a: Record<string, unknown>): boolean {
  if (
    agentHasGovernanceField(a, [
      "changeJustification",
      "change_justification",
      "changeReason",
      "change_reason",
    ])
  ) {
    return true;
  }
  const hist = a.revisionHistory ?? a.revision_history;
  return Array.isArray(hist) && hist.length > 0;
}

function agentHasStructuredApproval(a: Record<string, unknown>): boolean {
  const nested = a.approval;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const o = nested as Record<string, unknown>;
    return (
      agentHasGovernanceField(o, ["approvedBy", "approved_by"]) &&
      agentHasGovernanceField(o, [
        "approvalDate",
        "approval_date",
        "approvedAt",
        "approved_at",
      ]) &&
      agentHasGovernanceField(o, [
        "approvalStatus",
        "approval_status",
        "status",
      ])
    );
  }
  return (
    agentHasGovernanceField(a, ["approvedBy", "approved_by"]) &&
    agentHasGovernanceField(a, [
      "approvalDate",
      "approval_date",
      "approvedAt",
      "approved_at",
    ]) &&
    agentHasGovernanceField(a, ["approvalStatus", "approval_status"])
  );
}

function exceptionExpiryWithin90d(
  raw: unknown,
  measuredAt: string | null,
  now: Date = new Date(),
): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const expiryMs = Date.parse(raw.trim());
  if (Number.isNaN(expiryMs)) return false;
  const baseMs = measuredAt ? Date.parse(measuredAt) : now.getTime();
  const grantMs = Number.isNaN(baseMs) ? now.getTime() : baseMs;
  const windowMs = 90 * 24 * 60 * 60 * 1000;
  // Expiry must be on/after grant and within 90 days of the grant/measurement.
  return expiryMs >= grantMs && expiryMs - grantMs <= windowMs;
}

/**
 * When exceptions are present, each needs justification, approver, expiry ≤90d
 * from measuredAt (or now), and compensating controls.
 */
function agentExceptionsValid(
  a: Record<string, unknown>,
  measuredAt: string | null,
): boolean {
  const ex = a.exceptions;
  if (ex == null) return true;
  if (!Array.isArray(ex)) return false;
  if (ex.length === 0) return true;
  return ex.every((row) => {
    if (!row || typeof row !== "object") return false;
    const e = row as Record<string, unknown>;
    const expiryRaw =
      e.expiry ?? e.expiryDate ?? e.expiresAt ?? e.expires_at;
    return (
      agentHasGovernanceField(e, [
        "justification",
        "businessJustification",
        "business_justification",
        "reason",
      ]) &&
      agentHasGovernanceField(e, ["approver", "approvedBy", "approved_by"]) &&
      exceptionExpiryWithin90d(expiryRaw, measuredAt) &&
      agentHasGovernanceField(e, [
        "compensatingControls",
        "compensating_controls",
        "compensatingControl",
      ])
    );
  });
}

function normalizeCompletenessEvidence(raw: unknown): string | null {
  // "at least one of" — accept the first recognized entry from an array.
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const hit = normalizeCompletenessEvidence(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof raw !== "string") return null;
  // runtimeRegistry / runtime_registry / runtime-registry → runtime-registry
  const key = raw
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return COMPLETENESS_EVIDENCE.has(key) ? key : null;
}

function completenessProven(imported: {
  coversAllProductionAgents: boolean | null;
  completenessEvidence: string | null;
}): boolean {
  if (imported.coversAllProductionAgents === true) return true;
  return (
    imported.completenessEvidence != null &&
    COMPLETENESS_EVIDENCE.has(imported.completenessEvidence)
  );
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
    extensions: [...SCAN_EXTENSIONS],
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

function detectScopeSignals(
  targetPath: string,
  maxFiles: number,
): {
  agent: boolean;
  frameworkOnly: boolean;
  productionRuntime: boolean;
} {
  let agent = false;
  let framework = false;
  let productionRuntime = false;
  const files = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 20_000) || "";
    if (AGENT_PATH_RE.test(r) || /\b(AgentExecutor|create_react_agent|multi-?agent)\b/i.test(text)) {
      agent = true;
    }
    if (FRAMEWORK_ONLY_RE.test(r) || FRAMEWORK_ONLY_RE.test(text)) {
      framework = true;
    }
    if (
      PRODUCTION_RUNTIME_RE.test(r) ||
      PRODUCTION_RUNTIME_RE.test(text) ||
      INVENTORY_PATH_RE.test(r)
    ) {
      productionRuntime = true;
    }
  }
  return {
    agent: agent || framework,
    frameworkOnly: framework && !productionRuntime,
    productionRuntime,
  };
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
  let completenessEvidence: string | null = null;
  let productionAgentsPresent: boolean | null = null;
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
      completenessEvidence =
        normalizeCompletenessEvidence(data.completenessEvidence) ??
        normalizeCompletenessEvidence(data.completeness_evidence) ??
        completenessEvidence;
      productionAgentsPresent =
        asBool(data.productionAgentsPresent) ??
        asBool(data.production_agents_present) ??
        productionAgentsPresent;
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
          const hasProdId = agentHasProductionIdentifier(a);
          const hasLifecycle = agentHasLifecycle(a);
          const hasChange = agentHasChangeControl(a);
          const hasApproval = agentHasStructuredApproval(a);
          const exceptionsOk = agentExceptionsValid(a, measuredAt);
          if (!hasOwner) missingOwners++;
          if (
            !hasPurpose ||
            !hasTools ||
            !hasData ||
            !hasAutonomy ||
            !hasOwner ||
            !hasProdId ||
            !hasLifecycle ||
            !hasChange ||
            !hasReview ||
            !hasUpdated ||
            !hasVersion ||
            !hasApproval ||
            !exceptionsOk
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
    completenessEvidence,
    productionAgentsPresent,
    measuredAt,
    sources,
  };
}

function allRequiredFieldsPresent(
  fields: AgentCharterInventoryReport["fields"],
): boolean {
  return Object.values(fields).every(Boolean);
}

function severityHintFor(
  statusHint: AgentCharterInventoryReport["summary"]["statusHint"],
  opts: {
    agentSignals: boolean;
    inventoryFound: boolean;
    imported: AgentCharterInventoryReport["importedResults"];
    completenessOk: boolean;
  },
): AgnM1SeverityHint {
  if (statusHint === "pass" || statusHint === "not_applicable") return "high";

  const completenessUnproven =
    (opts.imported.found && !opts.completenessOk) ||
    (!opts.imported.found && opts.agentSignals);
  const unenumerable =
    statusHint === "not_demonstrated" &&
    opts.agentSignals &&
    !opts.inventoryFound;
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
  frameworkOnly: boolean;
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
  const { appliesTo, notApplicableTo } = agnM1ScopeLists();
  const completenessOk = completenessProven(opts.imported);

  // Infra-only cues must not pull non-agent repos into scope; frameworks/SDKs alone are N/A.
  const importedAgents =
    opts.imported.found && (opts.imported.agentCount ?? 0) > 0;
  const inScope =
    opts.imported.productionAgentsPresent !== false &&
    (opts.inventory.found ||
      opts.charters.found ||
      importedAgents ||
      (opts.agentSignals && !opts.frameworkOnly));

  if (!opts.agentSignals && !opts.inventory.found && !opts.charters.found) {
    pushInfo(
      "No agent/charter signals — AGN-M1 may be NOT_APPLICABLE if there are no production agents.",
    );
  }
  if (opts.inventory.found) {
    pushInfo(`Inventory refs: ${opts.inventory.refs.slice(0, 4).join(", ")}`);
  } else if (inScope) {
    pushGap(
      "No agent inventory manifest found (agents.yaml / charters/ / AGENT.md / registry).",
    );
  }
  if (opts.charters.found) {
    pushInfo(`Charter-like refs: ${opts.charters.refs.slice(0, 4).join(", ")}`);
  }
  const missingFieldNames: string[] = [];
  for (const [k, present] of Object.entries(opts.fields)) {
    if (present) {
      pushInfo(
        `Field ${k}: ${opts.fieldRefs[k]?.slice(0, 2).join(", ") || "present"}`,
      );
    } else if (inScope) {
      missingFieldNames.push(k);
    }
  }
  if (missingFieldNames.length > 0) {
    pushGap(
      `Required charter fields missing in repo scan: ${missingFieldNames.join(", ")}`,
    );
  }
  if (opts.imported.found) {
    pushInfo(
      `Imported: ${opts.imported.sources.join(", ")} (agents=${opts.imported.agentCount}, missingFields=${opts.imported.missingFieldCount}, missingOwners=${opts.imported.missingOwnerCount}, complete=${opts.imported.complete}, completenessEvidence=${opts.imported.completenessEvidence})`,
    );
  } else if (
    inScope &&
    (opts.inventory.found ||
      allFields ||
      opts.charters.found ||
      opts.agentSignals)
  ) {
    pushGap(
      "Repo scan cannot unlock AGN-M1 PASS alone — need a measured inventory export (complete=true, 0 missing governance fields, completeness evidence or coversAllProductionAgents=true, fresh measuredAt ≤90d) under imports/agent-charter-inventory/.",
    );
    pushGap(
      "Required per agent: purpose, owner, production identifier, lifecycle status, approved tool policy, data scope, autonomy boundaries, change control, review date, last updated, charter version, and structured approval (approvedBy, approvalDate, approvalStatus).",
    );
  }

  let statusHint: AgentCharterInventoryReport["summary"]["statusHint"];
  let agnM1Satisfied: boolean | null = null;
  let naReason: string | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.missingFieldCount !== null &&
      opts.imported.missingFieldCount > 0) ||
      opts.imported.complete === false);

  if (!inScope) {
    statusHint = "not_applicable";
    agnM1Satisfied = null;
    const applies =
      appliesTo.length > 0
        ? appliesTo.join(", ")
        : "production agent runtimes";
    const excludes =
      notApplicableTo.length > 0
        ? notApplicableTo.join(", ")
        : "agent frameworks, SDKs, libraries";
    naReason =
      opts.imported.productionAgentsPresent === false
        ? `Import attested productionAgentsPresent=false — AGN-M1 applies to ${applies}; not ${excludes}.`
        : `No production agent inventory/runtime — only framework/SDK/library or empty signals. AGN-M1 applies to ${applies}; not ${excludes}.`;
    pushInfo(naReason);
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
    (opts.imported.agentCount ?? 0) > 0 &&
    completenessOk &&
    measuredAtFresh(opts.imported.measuredAt)
  ) {
    statusHint = "pass";
    agnM1Satisfied = true;
  } else if (
    opts.inventory.found ||
    opts.charters.found ||
    allFields ||
    opts.imported.found
  ) {
    statusHint = "partial";
    agnM1Satisfied = false;
    if (opts.imported.found && !completenessOk) {
      pushGap(
        "Inventory completeness not proven — provide completenessEvidence (runtime-registry | deployment-manifest | cmdb | platform-registry | approved-attestation) or coversAllProductionAgents=true (escalate severity to critical).",
      );
    }
    if (opts.imported.found && (opts.imported.agentCount ?? 0) <= 0) {
      pushGap(
        "Import lists 0 agents — AGN-M1 PASS requires agentCount ≥ 1 (empty inventory is not a vacuous pass).",
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
    completenessOk,
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
    schemaVersion: "0.4.0",
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
      completenessProven: completenessOk,
      inScope,
      naReason,
      appliesTo,
      notApplicableTo,
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
    const productionIdentifier = fieldScan(PRODUCTION_ID_RE);
    const lifecycleStatus = fieldScan(LIFECYCLE_RE);
    const changeControl = fieldScan(CHANGE_CONTROL_RE);
    const reviewDate = fieldScan(REVIEW_DATE_RE);
    const lastUpdated = fieldScan(LAST_UPDATED_RE);
    const charterVersion = fieldScan(CHARTER_VERSION_RE);
    const approval = fieldScan(APPROVAL_RE);

    const fields = {
      purpose: purpose.found,
      toolAllowlist: tools.found,
      dataScope: data.found,
      autonomyLimits: autonomy.found,
      owner: owner.found,
      productionIdentifier: productionIdentifier.found,
      lifecycleStatus: lifecycleStatus.found,
      changeControl: changeControl.found,
      reviewDate: reviewDate.found,
      lastUpdated: lastUpdated.found,
      charterVersion: charterVersion.found,
      approval: approval.found,
    };
    const fieldRefs: Record<string, string[]> = {
      purpose: purpose.refs,
      toolAllowlist: tools.refs,
      dataScope: data.refs,
      autonomyLimits: autonomy.refs,
      owner: owner.refs,
      productionIdentifier: productionIdentifier.refs,
      lifecycleStatus: lifecycleStatus.refs,
      changeControl: changeControl.refs,
      reviewDate: reviewDate.refs,
      lastUpdated: lastUpdated.refs,
      charterVersion: charterVersion.refs,
      approval: approval.refs,
    };

    const scope = detectScopeSignals(ctx.targetPath, maxFiles);
    const imported = loadImported(ctx);

    const report = buildAgentCharterInventoryReport({
      assessedAt: ctx.assessedAt.toISOString(),
      inventory,
      charters,
      fields,
      fieldRefs,
      agentSignals: scope.agent,
      frameworkOnly: scope.frameworkOnly,
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
          ...(report.summary.inScope
            ? ["production-agent-scope"]
            : ["framework-or-library-na"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-M1 status=${report.summary.statusHint} severity=${report.summary.severityHint} inScope=${report.summary.inScope} inventory=${report.summary.inventoryPresent} fields=${report.summary.allRequiredFieldsPresent} satisfied=${report.summary.agnM1Satisfied}; report=imports/${PLUGIN_ID}/agent-charter-inventory-report.json`,
      nodes,
    };
  },
};
