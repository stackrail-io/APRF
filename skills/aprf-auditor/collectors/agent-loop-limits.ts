/**
 * agent-loop-limits — AGN-M2 / repo-agent-loop-limits detector executor.
 *
 * Finds runtime config for max-steps, wall-clock timeout, and spawn depth,
 * plus enforcement-test signals. Import measured abort results under
 * imports/agent-loop-limits/ to unlock PASS.
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
import { measuredAtFresh, parseMeasuredAt } from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-loop-limits";
const RELATED = ["AGN-M2"] as const;
const DETECTOR_ID = "repo-agent-loop-limits";

const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|swarm|planner|a2a)/i;

const MAX_STEPS_RE =
  /\b(max[_-]?(steps|iterations|tool[_-]?calls|turns)|step[_-]?limit|iteration[_-]?limit|maxIterations|max_tool_calls)\b/i;

const WALL_CLOCK_RE =
  /\b(wall[_-]?clock(?:[_-]?\w+)?|run[_-]?timeout|agent[_-]?timeout|execution[_-]?timeout|timeout[_-]?(seconds|ms|secs)|max[_-]?(runtime|duration)|deadline)\b/i;

const SPAWN_DEPTH_RE =
  /\b(spawn[_-]?(depth|limit)|max[_-]?(spawn|children|sub[_-]?agents|delegation)|recursion[_-]?limit|max[_-]?depth|child[_-]?agent[_-]?limit)\b/i;

const ENFORCE_TEST_RE =
  /\b(abort|fail[_-]?closed|timeout|exceed|spawn|max[_-]?steps|enforcement|kill[_-]?run|cancel[_-]?run)\b/i;

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
  };
  importedResults: {
    found: boolean;
    agentsCovered: number | null;
    limitsEnforcedAbort: boolean | null;
    promptOnlyLimits: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    allThreeLimitsPresent: boolean;
    enforcementPresent: boolean;
    agentSignalsPresent: boolean;
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
      ".jsx",
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
    const agentish = AGENT_PATH_RE.test(r) || AGENT_PATH_RE.test(text);
    if (pattern.test(r) || (pattern.test(text) && agentish)) {
      refs.push(r);
    }
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectEnforcementTests(targetPath: string, maxFiles: number) {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [".py", ".ts", ".js", ".yml", ".yaml", ".md"],
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
      AGENT_PATH_RE.test(text);
    if (mentionsLimits && ENFORCE_TEST_RE.test(text)) {
      refs.push(r);
    }
    if (refs.length >= 16) break;
  }
  return { found: refs.length > 0, refs };
}

function detectAgentSignals(targetPath: string, maxFiles: number): boolean {
  const files = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
    extensions: [".py", ".ts", ".js", ".yml", ".yaml", ".json", ".md"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    if (AGENT_PATH_RE.test(r)) return true;
    const text = readText(f, 20_000) || "";
    if (
      /\b(AgentExecutor|create_react_agent|langgraph|CrewAI|AutoGen|multi-?agent)\b/i.test(
        text,
      )
    ) {
      return true;
    }
  }
  return false;
}

function loadImported(ctx: CollectorContext): AgentLoopLimitsReport["importedResults"] {
  const sources: string[] = [];
  let agentsCovered: number | null = null;
  let limitsEnforcedAbort: boolean | null = null;
  let promptOnlyLimits: number | null = null;
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
        limitsEnforcedAbort =
          limitsEnforcedAbort === null
            ? aborted === results.length
            : limitsEnforcedAbort && aborted === results.length;
        promptOnlyLimits = (promptOnlyLimits ?? 0) + promptOnly;
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
    measuredAt,
    sources,
  };
}

export function buildAgentLoopLimitsReport(opts: {
  assessedAt: string;
  maxSteps: { found: boolean; refs: string[] };
  wallClock: { found: boolean; refs: string[] };
  spawnDepth: { found: boolean; refs: string[] };
  enforcementTests: { found: boolean; refs: string[] };
  agentSignals: boolean;
  imported: AgentLoopLimitsReport["importedResults"];
}): AgentLoopLimitsReport {
  const notes: string[] = [];
  const allThree =
    opts.maxSteps.found && opts.wallClock.found && opts.spawnDepth.found;
  const enforcementPresent =
    opts.enforcementTests.found || opts.imported.found;

  if (!opts.agentSignals && !allThree && !enforcementPresent) {
    notes.push(
      "No agent/autonomy signals found — AGN-M2 may be NOT_APPLICABLE if the system has no production agents.",
    );
  }

  if (opts.maxSteps.found) {
    notes.push(`max-steps signals: ${opts.maxSteps.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No max-steps / iteration limit config found for agent runtimes.");
  }
  if (opts.wallClock.found) {
    notes.push(
      `wall-clock timeout signals: ${opts.wallClock.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No wall-clock / run timeout config found for agent runtimes.");
  }
  if (opts.spawnDepth.found) {
    notes.push(
      `spawn-depth signals: ${opts.spawnDepth.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No spawn-depth / child-agent limit config found.");
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
      `Imported: ${opts.imported.sources.join(", ")} (agentsCovered=${opts.imported.agentsCovered}, abort=${opts.imported.limitsEnforcedAbort}, promptOnly=${opts.imported.promptOnlyLimits})`,
    );
  }

  let statusHint: AgentLoopLimitsReport["summary"]["statusHint"];
  let agnM2Satisfied: boolean | null = null;

  const measuredFail =
    (opts.imported.promptOnlyLimits !== null &&
      opts.imported.promptOnlyLimits > 0) ||
    (opts.imported.limitsEnforcedAbort === false && opts.imported.found);

  if (measuredFail) {
    statusHint = "fail";
    agnM2Satisfied = false;
    notes.push(
      "Imported results show prompt-only limits or failed abort-on-exceed — AGN-M2 fail.",
    );
  } else if (
    allThree &&
    enforcementPresent &&
    opts.imported.limitsEnforcedAbort === true &&
    (opts.imported.promptOnlyLimits === null ||
      opts.imported.promptOnlyLimits === 0) &&
    measuredAtFresh(opts.imported.measuredAt)
  ) {
    statusHint = "pass";
    agnM2Satisfied = true;
  } else if (allThree || enforcementPresent || opts.maxSteps.found || opts.imported.found) {
    statusHint = "partial";
    agnM2Satisfied = false;
    if (allThree && opts.imported.limitsEnforcedAbort === null) {
      notes.push(
        "All three limit configs present but no measured abort-on-exceed import — drop JSON under imports/agent-loop-limits/ to PASS.",
      );
    }
    if (opts.imported.found && !measuredAtFresh(opts.imported.measuredAt)) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-M2 PASS.",
      );
    }
  } else if (!opts.agentSignals) {
    statusHint = "not_applicable";
    agnM2Satisfied = null;
  } else {
    statusHint = "not_demonstrated";
    agnM2Satisfied = null;
  }

  const gapNotes: string[] = [];
  if (statusHint !== "pass" && statusHint !== "not_applicable") {
    if (!opts.maxSteps.found) {
      gapNotes.push(
        "Max-steps / iteration limit config for agent runtimes (repo or import)",
      );
    }
    if (!opts.wallClock.found) {
      gapNotes.push(
        "Wall-clock / run timeout config for agent runtimes (repo or import)",
      );
    }
    if (!opts.spawnDepth.found) {
      gapNotes.push(
        "Spawn-depth / child-agent limit config (repo or import)",
      );
    }
    if (!opts.imported.found || opts.imported.limitsEnforcedAbort !== true) {
      gapNotes.push(
        "Measured abort-on-exceed results under imports/agent-loop-limits/ (limitsEnforcedAbort=true, measuredAt ≤90d) — config/tests alone cannot PASS",
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
    },
    importedResults: opts.imported,
    summary: {
      allThreeLimitsPresent: allThree,
      enforcementPresent,
      agentSignalsPresent: opts.agentSignals,
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
      refs: collectLimitRefs(ctx.targetPath, maxFiles, WALL_CLOCK_RE),
    };
    wallClock.found = wallClock.refs.length > 0;
    const spawnDepth = {
      found: false,
      refs: collectLimitRefs(ctx.targetPath, maxFiles, SPAWN_DEPTH_RE),
    };
    spawnDepth.found = spawnDepth.refs.length > 0;
    const enforcementTests = detectEnforcementTests(ctx.targetPath, maxFiles);
    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);
    const imported = loadImported(ctx);

    const report = buildAgentLoopLimitsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      maxSteps,
      wallClock,
      spawnDepth,
      enforcementTests,
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-loop-limits-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const foundRefs = [
      ...report.signals.maxSteps.refs.map((r) => `maxSteps: ${r}`),
      ...report.signals.wallClock.refs.map((r) => `wallClock: ${r}`),
      ...report.signals.spawnDepth.refs.map((r) => `spawnDepth: ${r}`),
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
          ...(report.summary.allThreeLimitsPresent
            ? ["max-steps", "wall-clock", "spawn-depth"]
            : []),
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
      detail: `AGN-M2 status=${report.summary.statusHint} limits3=${report.summary.allThreeLimitsPresent} enforce=${report.summary.enforcementPresent} satisfied=${report.summary.agnM2Satisfied}; report=imports/${PLUGIN_ID}/agent-loop-limits-report.json`,
      nodes,
    };
  },
};
