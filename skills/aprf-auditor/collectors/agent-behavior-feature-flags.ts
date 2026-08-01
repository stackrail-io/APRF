/**
 * agent-behavior-feature-flags — CHG-R2 / repo-agent-behavior-feature-flags.
 *
 * Discovers feature flags for new agent behaviors + audit + kill/disable tests.
 * Import newAgentBehaviorsBehindFlags + flagStateChangesAudited +
 * killDisablePathTestedLast90Days under imports/agent-behavior-feature-flags/
 * to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "agent-behavior-feature-flags";
const RELATED = ["CHG-R2"] as const;
const DETECTOR_ID = "repo-agent-behavior-feature-flags";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AGENT_RE =
  /(agent|agents|autonom|tool[\s_-]*use|multi[\s_-]*agent|orchestrat)/i;

const FLAG_RE =
  /\b(feature[\s_-]*flag\w*|launchdarkly|unleash|flagsmith|split\.io|growthbook|agent[\s_-]*flag|behavior[\s_-]*flag)\b/i;

const AUDIT_RE =
  /\b(flag[\s_-]*audit|audit[\s_-]*trail|flag[\s_-]*change[\s_-]*log|state[\s_-]*change[\s_-]*audit|flag[\s_-]*history)\b/i;

const KILL_RE =
  /\b(kill[\s_-]*switch|disable[\s_-]*path|flag[\s_-]*off|disable[\s_-]*agent|kill[\s_-]*disable|emergency[\s_-]*disable)\b/i;

export interface AgentBehaviorFeatureFlagsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    flags: { found: boolean; refs: string[] };
    audit: { found: boolean; refs: string[] };
    killDisable: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    newAgentBehaviorsBehindFlags: boolean | null;
    flagStateChangesAudited: boolean | null;
    killDisablePathTestedLast90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    flagSignalsPresent: boolean;
    chgR2Satisfied: boolean | null;
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
        AGENT_RE.test(path) ||
        /\b(agent[\s_-]*charter|autonomous[\s_-]*agent|tool[\s_-]*calling)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): AgentBehaviorFeatureFlagsReport["importedResults"] {
  const sources: string[] = [];
  let newAgentBehaviorsBehindFlags: boolean | null = null;
  let flagStateChangesAudited: boolean | null = null;
  let killDisablePathTestedLast90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-behavior-feature-flags-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      newAgentBehaviorsBehindFlags =
        asBool(data.newAgentBehaviorsBehindFlags) ??
        asBool(data.new_agent_behaviors_behind_flags) ??
        asBool(data.behaviorsBehindFlags) ??
        newAgentBehaviorsBehindFlags;
      flagStateChangesAudited =
        asBool(data.flagStateChangesAudited) ??
        asBool(data.flag_state_changes_audited) ??
        asBool(data.flagChangesAudited) ??
        flagStateChangesAudited;
      killDisablePathTestedLast90Days =
        asBool(data.killDisablePathTestedLast90Days) ??
        asBool(data.kill_disable_path_tested_last_90_days) ??
        asBool(data.disablePathTested) ??
        killDisablePathTestedLast90Days;

      const missing =
        asNum(data.agentBehaviorsMissingFlags) ??
        asNum(data.agent_behaviors_missing_flags);
      if (missing !== null) {
        newAgentBehaviorsBehindFlags =
          newAgentBehaviorsBehindFlags ?? missing === 0;
      }
      // Affirmative disable test overrides earlier false.
      if (asBool(data.killDisableTestPassed) === true) {
        killDisablePathTestedLast90Days = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    newAgentBehaviorsBehindFlags,
    flagStateChangesAudited,
    killDisablePathTestedLast90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAgentBehaviorFeatureFlagsReport(opts: {
  assessedAt: string;
  flags: { found: boolean; refs: string[] };
  audit: { found: boolean; refs: string[] };
  killDisable: { found: boolean; refs: string[] };
  agentSignals: boolean;
  imported: AgentBehaviorFeatureFlagsReport["importedResults"];
}): AgentBehaviorFeatureFlagsReport {
  const notes: string[] = [];
  const flagSignalsPresent =
    opts.flags.found || opts.audit.found || opts.killDisable.found;

  if (!opts.agentSignals && !flagSignalsPresent && !opts.imported.found) {
    notes.push(
      "No agent/feature-flag signals — CHG-R2 may be NOT_APPLICABLE if no production agents ship new behaviors.",
    );
  }
  if (opts.flags.found) {
    notes.push(`Flag refs: ${opts.flags.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.audit.found) {
    notes.push(`Audit refs: ${opts.audit.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.killDisable.found) {
    notes.push(
      `Kill/disable refs: ${opts.killDisable.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (behindFlags=${opts.imported.newAgentBehaviorsBehindFlags}, audited=${opts.imported.flagStateChangesAudited}, disableTested=${opts.imported.killDisablePathTestedLast90Days})`,
    );
  } else if (flagSignalsPresent) {
    notes.push(
      "Flag signals alone are PARTIAL — import newAgentBehaviorsBehindFlags=true + flagStateChangesAudited=true + killDisablePathTestedLast90Days=true (measuredAt ≤90d) under imports/agent-behavior-feature-flags/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const flagsOk = opts.imported.newAgentBehaviorsBehindFlags === true;
  const auditOk = opts.imported.flagStateChangesAudited === true;
  const disableOk = opts.imported.killDisablePathTestedLast90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AgentBehaviorFeatureFlagsReport["summary"]["statusHint"];
  let chgR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.newAgentBehaviorsBehindFlags === false ||
      opts.imported.flagStateChangesAudited === false ||
      opts.imported.killDisablePathTestedLast90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.agentSignals && !flagSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing behavior flags, unaudited changes, untested kill/disable, or evidence older than 90 days — CHG-R2 fail.",
    );
  } else if (
    (flagSignalsPresent || opts.imported.found) &&
    flagsOk &&
    auditOk &&
    disableOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgR2Satisfied = true;
  } else if (flagSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgR2Satisfied = false;
    if (opts.imported.found && !flagsOk) {
      notes.push("Import must show newAgentBehaviorsBehindFlags=true.");
    }
    if (opts.imported.found && !auditOk) {
      notes.push("Import must show flagStateChangesAudited=true.");
    }
    if (opts.imported.found && !disableOk) {
      notes.push("Import must show killDisablePathTestedLast90Days=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-R2 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    chgR2Satisfied = null;
    notes.push(
      "Agent signals present but no feature-flag / audit / kill-disable evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      flags: opts.flags,
      audit: opts.audit,
      killDisable: opts.killDisable,
    },
    importedResults: opts.imported,
    summary: {
      agentSignalsPresent: opts.agentSignals,
      flagSignalsPresent,
      chgR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentBehaviorFeatureFlagsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);

    const flagRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FLAG_RE.test(path) || FLAG_RE.test(text),
      12,
    );
    const auditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FLAG_RE.test(path) || FLAG_RE.test(text) || AUDIT_RE.test(path)) &&
        AUDIT_RE.test(text),
      12,
    );
    const killDisableRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => KILL_RE.test(path) || KILL_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAgentBehaviorFeatureFlagsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      flags: { found: flagRefs.length > 0, refs: flagRefs },
      audit: { found: auditRefs.length > 0, refs: auditRefs },
      killDisable: {
        found: killDisableRefs.length > 0,
        refs: killDisableRefs,
      },
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-behavior-feature-flags-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/agent-behavior-feature-flags-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "agent-behavior-feature-flags",
          "chg-r2",
          DETECTOR_ID,
          ...(report.summary.chgR2Satisfied ? ["chg-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.flags.refs,
        ...report.signals.audit.refs,
        ...report.signals.killDisable.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["agent-behavior-feature-flags-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-R2 status=${report.summary.statusHint} flags=${report.summary.flagSignalsPresent} satisfied=${report.summary.chgR2Satisfied}; report=imports/${PLUGIN_ID}/agent-behavior-feature-flags-report.json`,
      nodes,
    };
  },
};
