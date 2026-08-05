/**
 * agent-goal-policy — AGN-R1 / repo-agent-goal-policy detector executor.
 *
 * Discovers pre-tool goal-conflict / disallowed-goal policy signals and named
 * owner refs. Import a ≤90-day synthetic conflict deny under
 * imports/agent-goal-policy/ to unlock PASS.
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

const PLUGIN_ID = "agent-goal-policy";
const RELATED = ["AGN-R1"] as const;
const DETECTOR_ID = "repo-agent-goal-policy";

const AGENT_PATH_RE =
  /(agent|orchestr|planner|autonom|langgraph|crewai|autogen|plan.?policy)/i;

const GOAL_POLICY_RE =
  /\b(goal[_-]?conflict|disallowed[_-]?goal|forbidden[_-]?goal|plan[_-]?polic(y|ies)|pre[_-]?(tool|execution)[_-]?polic(y|ies)|goal[_-]?guard|objective[_-]?check|mission[_-]?boundar)/i;

const OWNER_RE =
  /\b(owner|owned[_-]?by|policy[_-]?owner|maintainer|raci)\b/i;

const DENY_TEST_RE =
  /\b(deny|denied|reject|block).{0,40}(goal|conflict|plan|objectiv)|goal[_-]?conflict.{0,40}(test|deny|assert)|synthetic[_-]?conflict\b/i;

const TEST_PATH_RE = /(test|spec|e2e|fixture|__tests__)/i;

export interface AgentGoalPolicyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  policy: { found: boolean; refs: string[] };
  owner: { found: boolean; refs: string[] };
  denyTests: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    syntheticConflictDenied: boolean | null;
    rulesHaveOwner: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    policyPresent: boolean;
    ownerPresent: boolean;
    agnR1Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
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
        /\b(AgentExecutor|langgraph|CrewAI|AutoGen|create_react_agent|multi-?agent)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): AgentGoalPolicyReport["importedResults"] {
  const sources: string[] = [];
  let syntheticConflictDenied: boolean | null = null;
  let rulesHaveOwner: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-goal-policy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      syntheticConflictDenied =
        asBool(data.syntheticConflictDenied) ??
        asBool(data.synthetic_conflict_denied) ??
        asBool(data.conflictDenied) ??
        syntheticConflictDenied;
      rulesHaveOwner =
        asBool(data.rulesHaveOwner) ??
        asBool(data.rules_have_owner) ??
        asBool(data.hasOwner) ??
        rulesHaveOwner;
      ageDays =
        asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const cases = Array.isArray(data.cases)
        ? (data.cases as Array<Record<string, unknown>>)
        : Array.isArray(data.results)
          ? (data.results as Array<Record<string, unknown>>)
          : Array.isArray(data.tests)
            ? (data.tests as Array<Record<string, unknown>>)
            : [];
      for (const c of cases) {
        const kind = String(c.kind || c.id || c.name || "").toLowerCase();
        const denied =
          c.denied === true ||
          c.passed === true ||
          String(c.result || c.status || "").toLowerCase() === "deny" ||
          String(c.result || c.status || "").toLowerCase() === "denied" ||
          String(c.result || c.status || "").toLowerCase() === "pass";
        if (
          kind.includes("conflict") ||
          kind.includes("disallowed") ||
          kind.includes("goal") ||
          kind.includes("synthetic")
        ) {
          syntheticConflictDenied =
            syntheticConflictDenied === null
              ? denied
              : syntheticConflictDenied && denied;
        }
        const age = asNum(c.ageDays) ?? asNum(c.age_days);
        if (age !== null) ageDays = age;
        if (c.owner || c.rulesHaveOwner === true) rulesHaveOwner = true;
      }
      if (typeof data.owner === "string" && data.owner.trim()) {
        rulesHaveOwner = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    syntheticConflictDenied,
    rulesHaveOwner,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAgentGoalPolicyReport(opts: {
  assessedAt: string;
  policy: { found: boolean; refs: string[] };
  owner: { found: boolean; refs: string[] };
  denyTests: { found: boolean; refs: string[] };
  agentSignals: boolean;
  imported: AgentGoalPolicyReport["importedResults"];
}): AgentGoalPolicyReport {
  const notes: string[] = [];
  const policyPresent = opts.policy.found;
  const ownerPresent = opts.owner.found || opts.imported.rulesHaveOwner === true;

  if (!opts.agentSignals && !policyPresent && !opts.imported.found) {
    notes.push(
      "No agent/goal-policy signals — AGN-R1 may be NOT_APPLICABLE if there are no planning agents.",
    );
  }
  if (policyPresent) {
    notes.push(`Goal/plan policy refs: ${opts.policy.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No goal-conflict / disallowed-goal / plan-policy gate signals found.");
  }
  if (ownerPresent) {
    notes.push(
      opts.owner.found
        ? `Policy owner signals: ${opts.owner.refs.slice(0, 3).join(", ")}`
        : "Policy owner attested via import.",
    );
  } else {
    notes.push("No named owner for goal-conflict policy rules.");
  }
  if (opts.denyTests.found) {
    notes.push(`Deny-test refs: ${opts.denyTests.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (denied=${opts.imported.syntheticConflictDenied}, owner=${opts.imported.rulesHaveOwner}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (policyPresent) {
    notes.push(
      "Policy signals alone are PARTIAL — import ≤90-day synthetic conflict deny under imports/agent-goal-policy/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const denyOk = opts.imported.syntheticConflictDenied === true && ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AgentGoalPolicyReport["summary"]["statusHint"];
  let agnR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.syntheticConflictDenied === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90) ||
      opts.imported.rulesHaveOwner === false);

  if (!opts.agentSignals && !policyPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    agnR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    agnR1Satisfied = false;
    notes.push(
      "Imported goal-conflict results failed (deny, owner, or age) — AGN-R1 fail.",
    );
  } else if (
    policyPresent &&
    ownerPresent &&
    denyOk &&
    importFresh
  ) {
    statusHint = "pass";
    agnR1Satisfied = true;
  } else if (
    policyPresent ||
    opts.owner.found ||
    opts.denyTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    agnR1Satisfied = false;
    if (policyPresent && !ownerPresent) {
      notes.push("Named policy owner missing — required for AGN-R1 PASS.");
    }
    if (opts.imported.found && !denyOk) {
      notes.push(
        "Import must show syntheticConflictDenied=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-R1 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    agnR1Satisfied = null;
    notes.push(
      "Agent signals present but no goal-conflict policy / deny evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    agnR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    policy: opts.policy,
    owner: opts.owner,
    denyTests: opts.denyTests,
    importedResults: opts.imported,
    summary: {
      agentSignalsPresent: opts.agentSignals,
      policyPresent,
      ownerPresent,
      agnR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentGoalPolicyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => GOAL_POLICY_RE.test(path) || GOAL_POLICY_RE.test(text),
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!GOAL_POLICY_RE.test(path) && !GOAL_POLICY_RE.test(text) && !AGENT_PATH_RE.test(path)) {
          return false;
        }
        return OWNER_RE.test(text);
      },
      8,
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TEST_PATH_RE.test(path) || DENY_TEST_RE.test(path)) &&
        DENY_TEST_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAgentGoalPolicyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      policy: { found: policyRefs.length > 0, refs: policyRefs },
      owner: { found: ownerRefs.length > 0, refs: ownerRefs },
      denyTests: { found: denyRefs.length > 0, refs: denyRefs },
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "agent-goal-policy-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "policy",
        ref: `imports/${PLUGIN_ID}/agent-goal-policy-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "agent-goal-policy",
          "agn-r1",
          DETECTOR_ID,
          ...(report.summary.policyPresent ? ["goal-conflict-policy"] : []),
          ...(report.summary.ownerPresent ? ["policy-owner"] : []),
          ...(report.summary.agnR1Satisfied ? ["agn-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...policyRefs.slice(0, 4),
        ...ownerRefs.slice(0, 2),
        ...denyRefs.slice(0, 2),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["agent-goal-policy-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-R1 status=${report.summary.statusHint} policy=${report.summary.policyPresent} owner=${report.summary.ownerPresent} satisfied=${report.summary.agnR1Satisfied}; report=imports/${PLUGIN_ID}/agent-goal-policy-report.json`,
      nodes,
    };
  },
};
