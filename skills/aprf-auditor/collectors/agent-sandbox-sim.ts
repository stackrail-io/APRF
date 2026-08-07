/**
 * agent-sandbox-sim — AGN-R2 / repo-agent-sandbox-sim detector executor.
 *
 * Discovers agent sandbox/simulation environment signals. Import a linked
 * pre-prod sim report (≤30 days before release, pass/fail recorded) under
 * imports/agent-sandbox-sim/ to unlock PASS.
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "agent-sandbox-sim";
const RELATED = ["AGN-R2"] as const;
const DETECTOR_ID = "repo-agent-sandbox-sim";

const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|planner)/i;

const SANDBOX_RE =
  /\b(sandbox|simulation|sim[_-]?env|pre[_-]?prod|staging[_-]?agent|dry[_-]?run|shadow[_-]?mode|behavior[_-]?sim)\b/i;

const REPORT_RE =
  /\b(sandbox[_-]?report|sim[_-]?report|pre[_-]?prod[_-]?sim|simulation[_-]?result|pass[_-]?fail|acceptance[_-]?criteria)\b/i;

const CI_GATE_RE =
  /\b(sandbox|simulation).{0,40}(gate|required|block|promot)|agent.{0,20}(sandbox|sim).{0,20}(ci|workflow|check)\b/i;

export interface AgentSandboxSimReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  sandboxEnv: { found: boolean; refs: string[] };
  simReports: { found: boolean; refs: string[] };
  promotionGates: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    linkedSandboxRun: boolean | null;
    daysBeforeRelease: number | null;
    passFailCriteriaRecorded: boolean | null;
    outcomePass: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    sandboxEnvPresent: boolean;
    agnR2Satisfied: boolean | null;
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
): AgentSandboxSimReport["importedResults"] {
  const sources: string[] = [];
  let linkedSandboxRun: boolean | null = null;
  let daysBeforeRelease: number | null = null;
  let passFailCriteriaRecorded: boolean | null = null;
  let outcomePass: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-sandbox-sim-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      linkedSandboxRun =
        asBool(data.linkedSandboxRun) ??
        asBool(data.linked_sandbox_run) ??
        asBool(data.sandboxLinked) ??
        linkedSandboxRun;
      daysBeforeRelease =
        asNum(data.daysBeforeRelease) ??
        asNum(data.days_before_release) ??
        daysBeforeRelease;
      passFailCriteriaRecorded =
        asBool(data.passFailCriteriaRecorded) ??
        asBool(data.pass_fail_criteria_recorded) ??
        asBool(data.criteriaRecorded) ??
        passFailCriteriaRecorded;
      outcomePass =
        asBool(data.outcomePass) ??
        asBool(data.outcome_pass) ??
        asBool(data.passed) ??
        outcomePass;

      const runs = Array.isArray(data.runs)
        ? (data.runs as Array<Record<string, unknown>>)
        : Array.isArray(data.results)
          ? (data.results as Array<Record<string, unknown>>)
          : Array.isArray(data.reports)
            ? (data.reports as Array<Record<string, unknown>>)
            : [];
      for (const run of runs) {
        linkedSandboxRun = true;
        const d =
          asNum(run.daysBeforeRelease) ?? asNum(run.days_before_release);
        if (d !== null) daysBeforeRelease = d;
        if (
          run.passFailCriteria ||
          run.criteria ||
          run.passFailCriteriaRecorded === true
        ) {
          passFailCriteriaRecorded = true;
        }
        const status = String(run.outcome || run.status || "").toLowerCase();
        if (
          run.passed === true ||
          run.outcomePass === true ||
          status === "pass" ||
          status === "passed"
        ) {
          outcomePass = true;
        } else if (
          run.passed === false ||
          status === "fail" ||
          status === "failed"
        ) {
          outcomePass = false;
        }
      }
      if (
        typeof data.passFailCriteria === "string" ||
        typeof data.criteria === "string" ||
        Array.isArray(data.criteria)
      ) {
        passFailCriteriaRecorded = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    linkedSandboxRun,
    daysBeforeRelease,
    passFailCriteriaRecorded,
    outcomePass,
    measuredAt,
    sources,
  };
}

export function buildAgentSandboxSimReport(opts: {
  assessedAt: string;
  sandboxEnv: { found: boolean; refs: string[] };
  simReports: { found: boolean; refs: string[] };
  promotionGates: { found: boolean; refs: string[] };
  agentSignals: boolean;
  imported: AgentSandboxSimReport["importedResults"];
}): AgentSandboxSimReport {
  const notes: string[] = [];
  const sandboxEnvPresent = opts.sandboxEnv.found;

  if (!opts.agentSignals && !sandboxEnvPresent && !opts.imported.found) {
    notes.push(
      "No agent/sandbox signals — AGN-R2 may be NOT_APPLICABLE if there are no agent behavior promotions.",
    );
  }
  if (sandboxEnvPresent) {
    notes.push(`Sandbox/sim env refs: ${opts.sandboxEnv.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No agent sandbox/simulation environment signals found.");
  }
  if (opts.simReports.found) {
    notes.push(`Sim/report refs: ${opts.simReports.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.promotionGates.found) {
    notes.push(`Promotion-gate refs: ${opts.promotionGates.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (linked=${opts.imported.linkedSandboxRun}, daysBeforeRelease=${opts.imported.daysBeforeRelease}, criteria=${opts.imported.passFailCriteriaRecorded}, outcomePass=${opts.imported.outcomePass})`,
    );
  } else if (sandboxEnvPresent) {
    notes.push(
      "Sandbox env alone is PARTIAL — import linked ≤30-day pre-release sim report under imports/agent-sandbox-sim/ to PASS.",
    );
  }

  const windowOk =
    opts.imported.daysBeforeRelease !== null &&
    opts.imported.daysBeforeRelease <= 30;
  const linkedOk =
    opts.imported.linkedSandboxRun === true &&
    opts.imported.passFailCriteriaRecorded === true &&
    windowOk &&
    opts.imported.outcomePass !== false;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AgentSandboxSimReport["summary"]["statusHint"];
  let agnR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.linkedSandboxRun === false ||
      opts.imported.passFailCriteriaRecorded === false ||
      opts.imported.outcomePass === false ||
      (opts.imported.daysBeforeRelease !== null &&
        opts.imported.daysBeforeRelease > 30));

  if (!opts.agentSignals && !sandboxEnvPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    agnR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    agnR2Satisfied = false;
    notes.push(
      "Imported sandbox/sim results failed (link, criteria, outcome, or >30 days before release) — AGN-R2 fail.",
    );
  } else if (sandboxEnvPresent && linkedOk && importFresh) {
    statusHint = "pass";
    agnR2Satisfied = true;
  } else if (
    sandboxEnvPresent ||
    opts.simReports.found ||
    opts.promotionGates.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    agnR2Satisfied = false;
    if (opts.imported.found && !linkedOk) {
      notes.push(
        "Import must show linkedSandboxRun, passFailCriteriaRecorded, daysBeforeRelease≤30, and non-failing outcome.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-R2 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    agnR2Satisfied = null;
    notes.push(
      "Agent signals present but no sandbox/sim environment or promotion evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    agnR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    sandboxEnv: opts.sandboxEnv,
    simReports: opts.simReports,
    promotionGates: opts.promotionGates,
    importedResults: opts.imported,
    summary: {
      agentSignalsPresent: opts.agentSignals,
      sandboxEnvPresent,
      agnR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentSandboxSimCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);

    const sandboxRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SANDBOX_RE.test(path) || SANDBOX_RE.test(text)) &&
        (AGENT_PATH_RE.test(path) ||
          AGENT_PATH_RE.test(text) ||
          SANDBOX_RE.test(path)),
    );
    const reportRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REPORT_RE.test(path) || REPORT_RE.test(text),
      12,
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (/\.ya?ml$/i.test(path) || /workflow|ci|\.github/i.test(path)) &&
        CI_GATE_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAgentSandboxSimReport({
      assessedAt: ctx.assessedAt.toISOString(),
      sandboxEnv: { found: sandboxRefs.length > 0, refs: sandboxRefs },
      simReports: { found: reportRefs.length > 0, refs: reportRefs },
      promotionGates: { found: gateRefs.length > 0, refs: gateRefs },
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-sandbox-sim-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/agent-sandbox-sim-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "agent-sandbox-sim",
          "agn-r2",
          DETECTOR_ID,
          ...(report.summary.sandboxEnvPresent ? ["sandbox-env"] : []),
          ...(report.summary.agnR2Satisfied ? ["agn-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...sandboxRefs.slice(0, 4),
        ...reportRefs.slice(0, 2),
        ...gateRefs.slice(0, 2),
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
        signals: ["agent-sandbox-sim-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-R2 status=${report.summary.statusHint} sandbox=${report.summary.sandboxEnvPresent} satisfied=${report.summary.agnR2Satisfied}; report=imports/${PLUGIN_ID}/agent-sandbox-sim-report.json`,
      nodes,
    };
  },
};
