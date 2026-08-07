/**
 * agent-loop-limits — AGN-M2 / repo-agent-loop-limits detector executor.
 *
 * Finds runtime Execution Bounds: iteration + duration (always), and
 * recursion/delegation depth when spawning/sub-agents are supported.
 * Import measured abort results under imports/agent-loop-limits/ to unlock PASS.
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
  SCAN_EXTENSIONS,
  walkFiles,
} from "./lib/fs.ts";
import { measuredAtFresh, parseMeasuredAt } from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-loop-limits";
const RELATED = ["AGN-M2"] as const;
const DETECTOR_ID = "repo-agent-loop-limits";

/** AGN-M2 applicability from catalog YAML (packages/aprf-engine/rules/.../AGN-M2.yaml). */
function agnM2ScopeLists(): {
  appliesTo: string[];
  notApplicableTo: string[];
} {
  const rule = getGeneratedCatalog().rules.find((r) => r.id === "AGN-M2");
  const appliesTo = rule?.applicability.appliesTo ?? [];
  const notApplicableTo = rule?.applicability.notApplicableTo ?? [];
  return { appliesTo, notApplicableTo };
}

/** Path segments that imply an agent/orchestration tree (scope + config association). */
const AGENT_PATH_RE =
  /(^|[/\\])(agents?|orchestrat\w*|autonom\w*|langgraph|crewai|autogen|swarm|planner|a2a)([/\\]|$)/i;

/** Broader text cue used only to associate limit keys with agentish files. */
const AGENTISH_TEXT_RE =
  /\b(agent|orchestrat\w*|autonom\w*|langgraph|crewai|autogen|swarm|planner|a2a|mcp)\b/i;

const STRONG_AGENT_RE =
  /\b(AgentExecutor|create_react_agent|langgraph|CrewAI|AutoGen|OpenAIAgents|BrowserUse|multi[_-]?agent|agent[_-]?runtime|agent[_-]?loop|tool[_-]?calling[_-]?agent|ReAct\s*agent|mcp[_-]?(client|server|host)|a2a[_-]?(runtime|peer|agent))\b/i;

/** Surfaces that are out of AGN-M2 scope when no agent runtime is present. */
const OUT_OF_SCOPE_RE =
  /\b(chat[_-]?completions?|embeddings?|text[_-]?embedding|classifier|classification[_-]?(model|endpoint)|rerank(?:er|ing)?|single[_-]?inference)\b/i;

/** Iteration bound concepts (reasoning/tool iterations). */
const MAX_STEPS_RE =
  /\b(max[_-]?(steps|iterations|tool[_-]?calls|turns)|step[_-]?limit|iteration[_-]?limit|maxIterations|max_iterations|max_tool_calls|maxTurns|max_turns)\b/i;

/** Duration bound concepts (bare `timeout:` only via TIMEOUT_ASSIGN_RE + agentish). */
const WALL_CLOCK_RE =
  /\b(wall[_-]?clock(?:[_-]?\w+)?|run[_-]?timeout|agent[_-]?timeout|execution[_-]?timeout|timeout[_-]?(seconds|ms|secs)|max[_-]?(runtime|duration)|deadline|execution[_-]?deadline)\b/i;

/** Agent-scoped bare timeout assignment — avoids matching generic HTTP `timeout` in paths. */
const TIMEOUT_ASSIGN_RE = /\btimeout\s*[:=]/i;

/** Recursion/delegation depth bound concepts (no bare max_depth — too many FPs). */
const SPAWN_DEPTH_RE =
  /\b(spawn[_-]?(depth|limit)|max[_-]?(spawn|children|sub[_-]?agents|delegation|recursion)|delegation[_-]?depth|recursion[_-]?limit|child[_-]?agent[_-]?limit|graph[_-]?depth)\b/i;

/**
 * Capability signals that make recursion/delegation bounds applicable.
 * Prefer concrete spawn/sub-agent controls over vague “multi-agent” / “delegate” docs.
 */
const SPAWN_CAPABILITY_RE =
  /(^|[^A-Za-z0-9])(spawn(?:ing)?|allow[_-]?sub[_-]?agent|sub[_-]?agents?|child[_-]?agents?|max[_-]?(?:spawn|children|sub[_-]?agents)|delegation[_-]?depth|recursive[_-]?(?:agent|delegat)\w*|a2a[_-]?handoff|create[_-]?(?:sub[_-]?)?agent|supervisor[_-]?agent)/i;

const DOC_ONLY_EXT_RE = /\.(md|rst|txt)$/i;

const ENFORCE_TEST_RE =
  /\b(abort|fail[_-]?closed|timeout|exceed|spawn|max[_-]?steps|enforcement|kill[_-]?run|cancel[_-]?run|no[_-]?continue|terminated?\s+due\s+to)\b/i;

const TEST_PATH_RE =
  /(test|spec|e2e|fixture|__tests__|enforcement)/i;

export interface AgentLoopLimitsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  /** @deprecated Prefer signals.* — kept for older report consumers / smokes. */
  maxSteps: { found: boolean; refs: string[] };
  /** @deprecated Prefer signals.* */
  wallClock: { found: boolean; refs: string[] };
  /** @deprecated Prefer signals.* */
  spawnDepth: { found: boolean; refs: string[] };
  /** @deprecated Prefer signals.* */
  enforcementTests: { found: boolean; refs: string[] };
  /** Drives REPORT.html Evidence found via assess (found=true refs only). */
  signals: {
    maxSteps: { found: boolean; refs: string[] };
    wallClock: { found: boolean; refs: string[] };
    spawnDepth: { found: boolean; refs: string[] };
    enforcementTests: { found: boolean; refs: string[] };
    spawnCapability: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    agentsCovered: number | null;
    limitsEnforcedAbort: boolean | null;
    promptOnlyLimits: number | null;
    continuesAfterAbort: boolean | null;
    terminationLogsPresent: boolean | null;
    /** Explicit scope attestation; false forces NOT_APPLICABLE. */
    productionAgentRuntimesPresent: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    /** True when iteration + duration (+ recursion/delegation if applicable) are present. */
    allThreeLimitsPresent: boolean;
    requiredBoundsPresent: boolean;
    spawnDepthApplicable: boolean;
    enforcementPresent: boolean;
    agentSignalsPresent: boolean;
    /** False → CLI assess scores AGN-M2 NOT_APPLICABLE (excluded from gate). */
    inScope: boolean;
    naReason: string | null;
    appliesTo: string[];
    notApplicableTo: string[];
    agnM2Satisfied: boolean | null;
    statusHint: "pass" | "partial" | "fail" | "not_demonstrated" | "not_applicable";
  };
  notes: string[];
  /** Typed gaps for REPORT.html Evidence still required. */
  gapNotes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function collectLimitRefs(
  targetPath: string,
  maxFiles: number,
  pattern: RegExp,
  opts?: { alsoMatchTimeoutAssign?: boolean; limit?: number },
): string[] {
  const limit = opts?.limit ?? 16;
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    const agentish = AGENT_PATH_RE.test(r) || AGENTISH_TEXT_RE.test(text);
    const textHit =
      pattern.test(text) ||
      (opts?.alsoMatchTimeoutAssign === true && TIMEOUT_ASSIGN_RE.test(text));
    if (pattern.test(r) || (textHit && agentish)) {
      refs.push(r);
    }
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function collectSpawnCapability(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    // Docs/marketing alone must not force recursion/delegation bounds.
    if (DOC_ONLY_EXT_RE.test(r)) continue;
    const text = readText(f, 80_000) || "";
    const agentish = AGENT_PATH_RE.test(r) || AGENTISH_TEXT_RE.test(text);
    if (
      SPAWN_CAPABILITY_RE.test(r) ||
      (SPAWN_CAPABILITY_RE.test(text) && agentish)
    ) {
      refs.push(r);
    }
    if (refs.length >= 12) break;
  }
  return { found: refs.length > 0, refs: [...new Set(refs)] };
}

function detectEnforcementTests(targetPath: string, maxFiles: number) {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    if (!TEST_PATH_RE.test(r) && !/\.test\.|\.spec\./i.test(basename(f))) {
      continue;
    }
    const text = readText(f, 80_000) || "";
    const mentionsLimits =
      MAX_STEPS_RE.test(text) ||
      WALL_CLOCK_RE.test(text) ||
      SPAWN_DEPTH_RE.test(text) ||
      AGENTISH_TEXT_RE.test(text);
    if (mentionsLimits && ENFORCE_TEST_RE.test(text)) {
      refs.push(r);
    }
    if (refs.length >= 16) break;
  }
  return { found: refs.length > 0, refs };
}

function detectScopeSignals(
  targetPath: string,
  maxFiles: number,
): { agent: boolean; agentRefs: string[]; outOfScopeRefs: string[] } {
  const agentRefs: string[] = [];
  const outOfScopeRefs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    if (AGENT_PATH_RE.test(r)) {
      agentRefs.push(r);
    }
    const text = readText(f, 20_000) || "";
    if (STRONG_AGENT_RE.test(text) || STRONG_AGENT_RE.test(r)) {
      agentRefs.push(r);
    }
    if (OUT_OF_SCOPE_RE.test(text) || OUT_OF_SCOPE_RE.test(r)) {
      outOfScopeRefs.push(r);
    }
    if (agentRefs.length >= 8 && outOfScopeRefs.length >= 8) break;
  }
  return {
    agent: agentRefs.length > 0,
    agentRefs: [...new Set(agentRefs)].slice(0, 8),
    outOfScopeRefs: [...new Set(outOfScopeRefs)].slice(0, 8),
  };
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function loadImported(ctx: CollectorContext): AgentLoopLimitsReport["importedResults"] {
  const sources: string[] = [];
  let agentsCovered: number | null = null;
  let limitsEnforcedAbort: boolean | null = null;
  let promptOnlyLimits: number | null = null;
  let continuesAfterAbort: boolean | null = null;
  let terminationLogsPresent: boolean | null = null;
  let productionAgentRuntimesPresent: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-loop-limits-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      if (typeof data.agentsCovered === "number") {
        agentsCovered = data.agentsCovered;
      }
      if (typeof data.limitsEnforcedAbort === "boolean") {
        limitsEnforcedAbort = data.limitsEnforcedAbort;
      }
      if (typeof data.promptOnlyLimits === "number") {
        promptOnlyLimits = data.promptOnlyLimits;
      }
      const scope = asBool(
        data.productionAgentRuntimesPresent ?? data.agentRuntimesPresent,
      );
      if (scope !== null) {
        // true wins across files; explicit false only sticks if never true.
        productionAgentRuntimesPresent =
          productionAgentRuntimesPresent === true ? true : scope;
      }
      const cont = asBool(data.continuesAfterAbort);
      if (cont !== null) {
        continuesAfterAbort =
          continuesAfterAbort === null ? cont : continuesAfterAbort || cont;
      }
      const logs = asBool(
        data.terminationLogsPresent ?? data.runtimeTerminationLogsPresent,
      );
      if (logs !== null) {
        terminationLogsPresent =
          terminationLogsPresent === null
            ? logs
            : terminationLogsPresent || logs;
      }
      const results = Array.isArray(data.results)
        ? (data.results as Array<Record<string, unknown>>)
        : [];
      if (results.length) {
        agentsCovered = (agentsCovered ?? 0) + results.length;
        const aborted = results.filter(
          (r) =>
            r.abortedOnExceed === true ||
            r.failClosed === true ||
            String(r.status || "").toLowerCase() === "pass",
        ).length;
        const promptOnly = results.filter(
          (r) => r.promptOnly === true || r.runtimeEnforced === false,
        ).length;
        const continued = results.filter(
          (r) =>
            r.continuesAfterAbort === true ||
            r.backgroundTasksContinued === true,
        ).length;
        const withLogs = results.filter(
          (r) =>
            r.terminationLogPresent === true ||
            r.runtimeTerminationLog === true,
        ).length;
        limitsEnforcedAbort =
          limitsEnforcedAbort === null
            ? aborted === results.length
            : limitsEnforcedAbort && aborted === results.length;
        promptOnlyLimits = (promptOnlyLimits ?? 0) + promptOnly;
        if (continued > 0) continuesAfterAbort = true;
        else if (continuesAfterAbort === null) continuesAfterAbort = false;
        if (withLogs > 0) {
          terminationLogsPresent = true;
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentsCovered,
    limitsEnforcedAbort,
    promptOnlyLimits,
    continuesAfterAbort,
    terminationLogsPresent,
    productionAgentRuntimesPresent,
    measuredAt,
    sources,
  };
}

function buildNaReason(opts: {
  outOfScopeRefs: string[];
  importSaysAbsent: boolean;
  appliesTo: string[];
  notApplicableTo: string[];
}): string {
  const applies =
    opts.appliesTo.length > 0 ? opts.appliesTo.join(", ") : "agent runtimes";
  const classes =
    opts.notApplicableTo.length > 0
      ? opts.notApplicableTo.join(", ")
      : "chat-only / single-inference / embeddings / classifiers / rerankers";
  if (opts.importSaysAbsent) {
    return `NOT_APPLICABLE: import attested productionAgentRuntimesPresent=false. AGN-M2 applies to ${applies}; not to ${classes}.`;
  }
  if (opts.outOfScopeRefs.length > 0) {
    return `NOT_APPLICABLE: no production agent-runtime signals; out-of-scope surfaces found (${opts.outOfScopeRefs.slice(0, 3).join(", ")}). Applies to ${applies}; not to ${classes}.`;
  }
  return `NOT_APPLICABLE: no production agent-runtime signals. Applies to ${applies}; not to ${classes}.`;
}

export function buildAgentLoopLimitsReport(opts: {
  assessedAt: string;
  maxSteps: { found: boolean; refs: string[] };
  wallClock: { found: boolean; refs: string[] };
  spawnDepth: { found: boolean; refs: string[] };
  spawnCapability: { found: boolean; refs: string[] };
  enforcementTests: { found: boolean; refs: string[] };
  agentSignals: boolean;
  outOfScopeRefs: string[];
  imported: AgentLoopLimitsReport["importedResults"];
}): AgentLoopLimitsReport {
  const { appliesTo, notApplicableTo } = agnM2ScopeLists();
  const notes: string[] = [];
  const spawnDepthApplicable = opts.spawnCapability.found;
  const requiredBoundsPresent =
    opts.maxSteps.found &&
    opts.wallClock.found &&
    (!spawnDepthApplicable || opts.spawnDepth.found);
  // Legacy alias: "all three" means all *required* bounds for this runtime model.
  const allThree = requiredBoundsPresent;
  const enforcementPresent =
    opts.enforcementTests.found || opts.imported.found;
  const importSaysAbsent =
    opts.imported.productionAgentRuntimesPresent === false;
  const importSaysPresent =
    opts.imported.productionAgentRuntimesPresent === true;
  const inScope =
    !importSaysAbsent &&
    (opts.agentSignals ||
      requiredBoundsPresent ||
      enforcementPresent ||
      importSaysPresent);

  if (!inScope) {
    notes.push(
      buildNaReason({
        outOfScopeRefs: opts.outOfScopeRefs,
        importSaysAbsent,
        appliesTo,
        notApplicableTo,
      }),
    );
  } else if (opts.agentSignals) {
    notes.push("In scope: production agent-runtime / orchestration signals present.");
  }

  if (opts.maxSteps.found) {
    notes.push(
      `iteration-bound signals: ${opts.maxSteps.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push(
      "No iteration bound (max_steps / max_iterations / max_tool_calls / …) found for agent runtimes.",
    );
  }
  if (opts.wallClock.found) {
    notes.push(
      `duration-bound signals: ${opts.wallClock.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push(
      "No duration bound (timeout / deadline / wall_clock / execution_timeout / …) found for agent runtimes.",
    );
  }
  if (!spawnDepthApplicable) {
    notes.push(
      "No recursive delegation / spawn / sub-agent capability signals — recursion/delegation depth bound is NOT_APPLICABLE for this target.",
    );
  } else if (opts.spawnDepth.found) {
    notes.push(
      `recursion/delegation-bound signals: ${opts.spawnDepth.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push(
      "Spawn/delegation capability present but no recursion/delegation depth bound config found.",
    );
  }
  if (opts.enforcementTests.found) {
    notes.push(
      `Enforcement test refs: ${opts.enforcementTests.refs.slice(0, 3).join(", ")}`,
    );
  } else if (!opts.imported.found) {
    notes.push(
      "No enforcement tests that abort on limit exceedance found — import measured results to PASS.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (agentsCovered=${opts.imported.agentsCovered}, abort=${opts.imported.limitsEnforcedAbort}, promptOnly=${opts.imported.promptOnlyLimits}, continuesAfterAbort=${opts.imported.continuesAfterAbort}, terminationLogs=${opts.imported.terminationLogsPresent})`,
    );
  }

  let statusHint: AgentLoopLimitsReport["summary"]["statusHint"];
  let agnM2Satisfied: boolean | null = null;
  let naReason: string | null = null;

  const measuredFail =
    inScope &&
    ((opts.imported.promptOnlyLimits !== null &&
      opts.imported.promptOnlyLimits > 0) ||
      (opts.imported.limitsEnforcedAbort === false && opts.imported.found) ||
      opts.imported.continuesAfterAbort === true);

  if (!inScope) {
    statusHint = "not_applicable";
    agnM2Satisfied = null;
    naReason = buildNaReason({
      outOfScopeRefs: opts.outOfScopeRefs,
      importSaysAbsent,
      appliesTo,
      notApplicableTo,
    });
  } else if (measuredFail) {
    statusHint = "fail";
    agnM2Satisfied = false;
    if (opts.imported.continuesAfterAbort === true) {
      notes.push(
        "Imported results show continue-after-abort (planner or background tasks kept running) — AGN-M2 fail.",
      );
    } else {
      notes.push(
        "Imported results show prompt-only limits or failed abort-on-exceed — AGN-M2 fail.",
      );
    }
  } else if (
    requiredBoundsPresent &&
    enforcementPresent &&
    opts.imported.limitsEnforcedAbort === true &&
    (opts.imported.promptOnlyLimits === null ||
      opts.imported.promptOnlyLimits === 0) &&
    opts.imported.continuesAfterAbort === false &&
    measuredAtFresh(opts.imported.measuredAt)
  ) {
    statusHint = "pass";
    agnM2Satisfied = true;
    if (opts.imported.terminationLogsPresent !== true) {
      notes.push(
        "PASS without imported runtime termination logs — prefer logs showing limit-triggered termination for stronger evidence.",
      );
    }
  } else if (
    requiredBoundsPresent ||
    enforcementPresent ||
    opts.maxSteps.found ||
    (opts.imported.found && !importSaysAbsent)
  ) {
    statusHint = "partial";
    agnM2Satisfied = false;
    if (requiredBoundsPresent && opts.imported.limitsEnforcedAbort === null) {
      notes.push(
        "Required execution bounds present but no measured abort-on-exceed import — drop JSON under imports/agent-loop-limits/ to PASS.",
      );
    }
    if (opts.imported.found && !measuredAtFresh(opts.imported.measuredAt)) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    agnM2Satisfied = null;
  }

  const gapNotes: string[] = [];
  if (statusHint !== "pass" && statusHint !== "not_applicable") {
    if (!opts.maxSteps.found) {
      gapNotes.push(
        "Iteration bound config (max_steps / max_iterations / max_tool_calls / …) for agent runtimes",
      );
    }
    if (!opts.wallClock.found) {
      gapNotes.push(
        "Duration bound config (timeout / deadline / wall_clock / execution_timeout / …) for agent runtimes",
      );
    }
    if (spawnDepthApplicable && !opts.spawnDepth.found) {
      gapNotes.push(
        "Recursion/delegation depth bound (spawn_depth / delegation_depth / max_recursion / graph_depth / …) — required because spawn/sub-agent capability was detected",
      );
    }
    if (
      !opts.imported.found ||
      opts.imported.limitsEnforcedAbort !== true ||
      opts.imported.continuesAfterAbort !== false
    ) {
      gapNotes.push(
        "Measured abort-on-exceed results under imports/agent-loop-limits/ (limitsEnforcedAbort=true, continuesAfterAbort=false, measuredAt ≤90d) — config/tests alone cannot PASS",
      );
    }
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    maxSteps: opts.maxSteps,
    wallClock: opts.wallClock,
    spawnDepth: opts.spawnDepth,
    enforcementTests: opts.enforcementTests,
    signals: {
      maxSteps: opts.maxSteps,
      wallClock: opts.wallClock,
      spawnDepth: opts.spawnDepth,
      enforcementTests: opts.enforcementTests,
      spawnCapability: opts.spawnCapability,
    },
    importedResults: opts.imported,
    summary: {
      allThreeLimitsPresent: allThree,
      requiredBoundsPresent,
      spawnDepthApplicable,
      enforcementPresent,
      agentSignalsPresent: opts.agentSignals,
      inScope,
      naReason,
      appliesTo,
      notApplicableTo,
      agnM2Satisfied,
      statusHint,
    },
    notes,
    gapNotes: gapNotes.slice(0, 8),
  };
}

export const agentLoopLimitsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;
    const maxSteps = {
      found: false,
      refs: collectLimitRefs(ctx.targetPath, maxFiles, MAX_STEPS_RE),
    };
    maxSteps.found = maxSteps.refs.length > 0;
    const wallClock = {
      found: false,
      refs: collectLimitRefs(ctx.targetPath, maxFiles, WALL_CLOCK_RE, {
        alsoMatchTimeoutAssign: true,
      }),
    };
    wallClock.found = wallClock.refs.length > 0;
    const spawnDepth = {
      found: false,
      refs: collectLimitRefs(ctx.targetPath, maxFiles, SPAWN_DEPTH_RE),
    };
    spawnDepth.found = spawnDepth.refs.length > 0;
    const spawnCapability = collectSpawnCapability(ctx.targetPath, maxFiles);
    const enforcementTests = detectEnforcementTests(ctx.targetPath, maxFiles);
    const scope = detectScopeSignals(ctx.targetPath, maxFiles);
    const imported = loadImported(ctx);

    const report = buildAgentLoopLimitsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      maxSteps,
      wallClock,
      spawnDepth,
      spawnCapability,
      enforcementTests,
      agentSignals: scope.agent,
      outOfScopeRefs: scope.outOfScopeRefs,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-loop-limits-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const foundRefs = [
      ...report.signals.maxSteps.refs.map((r) => `iterationBound: ${r}`),
      ...report.signals.wallClock.refs.map((r) => `durationBound: ${r}`),
      ...report.signals.spawnDepth.refs.map((r) => `recursionBound: ${r}`),
      ...report.signals.enforcementTests.refs.map(
        (r) => `enforcementTests: ${r}`,
      ),
    ].slice(0, 8);
    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/agent-loop-limits-report.json`,
        excerpt: redact(
          foundRefs.length
            ? `AGN-M2 ${report.summary.statusHint}: ${foundRefs.join("; ")}`
            : `AGN-M2 ${report.summary.statusHint}: no limit config refs yet`,
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "agent-loop-limits",
          "agn-m2",
          DETECTOR_ID,
          ...(report.summary.requiredBoundsPresent
            ? ["iteration-bound", "duration-bound"]
            : []),
          ...(report.summary.spawnDepthApplicable
            ? ["recursion-delegation-bound-applicable"]
            : ["recursion-delegation-bound-na"]),
          ...(report.summary.agnM2Satisfied
            ? ["agn-m2-satisfied"]
            : ["agn-m2-incomplete"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-M2 status=${report.summary.statusHint} inScope=${report.summary.inScope} requiredBounds=${report.summary.requiredBoundsPresent} spawnApplicable=${report.summary.spawnDepthApplicable} enforce=${report.summary.enforcementPresent} satisfied=${report.summary.agnM2Satisfied}; report=imports/${PLUGIN_ID}/agent-loop-limits-report.json`,
      nodes,
    };
  },
};
