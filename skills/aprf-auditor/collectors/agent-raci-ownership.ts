/**
 * agent-raci-ownership — AGN-R3 / repo-agent-raci detector executor.
 *
 * Discovers RACI / ownership-register signals for agents/AI systems.
 * Import a register export with orphanCount=0 under imports/agent-raci-ownership/
 * to unlock PASS.
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

const PLUGIN_ID = "agent-raci-ownership";
const RELATED = ["AGN-R3"] as const;
const DETECTOR_ID = "repo-agent-raci";

const AGENT_PATH_RE =
  /(agent|orchestr|autonom|langgraph|crewai|autogen|ai[_-]?system)/i;

const RACI_RE =
  /\b(raci|responsible|accountable|consulted|informed|ownership[_-]?register|owner[_-]?matrix|agent[_-]?owners)\b/i;

export interface AgentRaciOwnershipReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  raciRegister: { found: boolean; refs: string[] };
  roleSignals: {
    responsible: boolean;
    accountable: boolean;
    refs: string[];
  };
  importedResults: {
    found: boolean;
    systemOrAgentCount: number | null;
    orphanCount: number | null;
    coversAllProductionIds: boolean | null;
    responsibleAccountableComplete: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    agentSignalsPresent: boolean;
    raciPresent: boolean;
    raRolesPresent: boolean;
    agnR3Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".csv",
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
        /\b(AgentExecutor|langgraph|CrewAI|AutoGen|multi-?agent|ai[_-]?system)\b/i.test(
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

function rowHasRa(row: Record<string, unknown>): boolean {
  const r = !!(
    row.responsible ||
    row.Responsible ||
    row.R ||
    row.r ||
    row.responsibleOwner
  );
  const a = !!(
    row.accountable ||
    row.Accountable ||
    row.A ||
    row.a ||
    row.accountableOwner
  );
  return r && a;
}

function loadImported(
  ctx: CollectorContext,
): AgentRaciOwnershipReport["importedResults"] {
  const sources: string[] = [];
  let systemOrAgentCount: number | null = null;
  let orphanCount: number | null = null;
  let coversAllProductionIds: boolean | null = null;
  let responsibleAccountableComplete: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/agent-raci-ownership-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      systemOrAgentCount =
        asNum(data.systemOrAgentCount) ??
        asNum(data.agentCount) ??
        asNum(data.systemCount) ??
        systemOrAgentCount;
      orphanCount =
        asNum(data.orphanCount) ??
        asNum(data.orphan_count) ??
        asNum(data.orphans) ??
        orphanCount;
      coversAllProductionIds =
        asBool(data.coversAllProductionIds) ??
        asBool(data.covers_all_production_ids) ??
        asBool(data.coversAllProductionAgents) ??
        coversAllProductionIds;
      responsibleAccountableComplete =
        asBool(data.responsibleAccountableComplete) ??
        asBool(data.raComplete) ??
        responsibleAccountableComplete;

      const rows = Array.isArray(data.entries)
        ? (data.entries as Array<Record<string, unknown>>)
        : Array.isArray(data.systems)
          ? (data.systems as Array<Record<string, unknown>>)
          : Array.isArray(data.agents)
            ? (data.agents as Array<Record<string, unknown>>)
            : Array.isArray(data.inventory)
              ? (data.inventory as Array<Record<string, unknown>>)
              : [];
      if (rows.length) {
        systemOrAgentCount = (systemOrAgentCount ?? 0) + rows.length;
        let orphans = 0;
        for (const row of rows) {
          if (!rowHasRa(row)) orphans++;
        }
        orphanCount = (orphanCount ?? 0) + orphans;
        responsibleAccountableComplete =
          responsibleAccountableComplete === null
            ? orphans === 0
            : responsibleAccountableComplete && orphans === 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    systemOrAgentCount,
    orphanCount,
    coversAllProductionIds,
    responsibleAccountableComplete,
    measuredAt,
    sources,
  };
}

export function buildAgentRaciOwnershipReport(opts: {
  assessedAt: string;
  raciRegister: { found: boolean; refs: string[] };
  roleSignals: AgentRaciOwnershipReport["roleSignals"];
  agentSignals: boolean;
  imported: AgentRaciOwnershipReport["importedResults"];
}): AgentRaciOwnershipReport {
  const notes: string[] = [];
  const raciPresent = opts.raciRegister.found;
  const raRolesPresent =
    opts.roleSignals.responsible && opts.roleSignals.accountable;

  if (!opts.agentSignals && !raciPresent && !opts.imported.found) {
    notes.push(
      "No agent/RACI signals — AGN-R3 may be NOT_APPLICABLE if there are no production AI systems/agents.",
    );
  }
  if (raciPresent) {
    notes.push(`RACI/register refs: ${opts.raciRegister.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No RACI / ownership-register artifacts found.");
  }
  if (raRolesPresent) {
    notes.push(
      `R/A role signals present (refs: ${opts.roleSignals.refs.slice(0, 3).join(", ")})`,
    );
  } else if (raciPresent) {
    notes.push(
      "RACI-like artifact found but Responsible and Accountable role signals incomplete.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (count=${opts.imported.systemOrAgentCount}, orphans=${opts.imported.orphanCount}, coversAll=${opts.imported.coversAllProductionIds}, raComplete=${opts.imported.responsibleAccountableComplete})`,
    );
  } else if (raciPresent) {
    notes.push(
      "RACI docs alone are PARTIAL — import register export with orphanCount=0 under imports/agent-raci-ownership/ to PASS.",
    );
  }

  const zeroOrphans =
    opts.imported.orphanCount !== null && opts.imported.orphanCount === 0;
  const raComplete =
    opts.imported.responsibleAccountableComplete === true ||
    (zeroOrphans &&
      opts.imported.systemOrAgentCount !== null &&
      opts.imported.systemOrAgentCount > 0);
  const coversAll = opts.imported.coversAllProductionIds === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AgentRaciOwnershipReport["summary"]["statusHint"];
  let agnR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.orphanCount !== null && opts.imported.orphanCount > 0) ||
      opts.imported.responsibleAccountableComplete === false ||
      opts.imported.coversAllProductionIds === false);

  if (!opts.agentSignals && !raciPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    agnR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    agnR3Satisfied = false;
    notes.push(
      "Imported RACI register has orphans or incomplete R/A coverage — AGN-R3 fail.",
    );
  } else if (
    raciPresent &&
    raRolesPresent &&
    zeroOrphans &&
    raComplete &&
    coversAll &&
    (opts.imported.systemOrAgentCount === null ||
      opts.imported.systemOrAgentCount > 0) &&
    importFresh
  ) {
    statusHint = "pass";
    agnR3Satisfied = true;
  } else if (raciPresent || opts.imported.found || raRolesPresent) {
    statusHint = "partial";
    agnR3Satisfied = false;
    if (opts.imported.found && !coversAll) {
      notes.push(
        "Import missing coversAllProductionIds=true — cannot prove register covers every production ID.",
      );
    }
    if (opts.imported.found && !zeroOrphans) {
      notes.push("Import must show orphanCount=0 with Responsible+Accountable filled.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-R3 PASS.",
      );
    }
  } else if (opts.agentSignals) {
    statusHint = "not_demonstrated";
    agnR3Satisfied = null;
    notes.push(
      "Agent signals present but no RACI / ownership-register evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    agnR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    raciRegister: opts.raciRegister,
    roleSignals: opts.roleSignals,
    importedResults: opts.imported,
    summary: {
      agentSignalsPresent: opts.agentSignals,
      raciPresent,
      raRolesPresent,
      agnR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const agentRaciOwnershipCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const agentSignals = detectAgentSignals(ctx.targetPath, maxFiles);

    const raciRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RACI_RE.test(path) || RACI_RE.test(text),
    );
    const roleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!RACI_RE.test(path) && !RACI_RE.test(text) && !AGENT_PATH_RE.test(path)) {
          return false;
        }
        return (
          /\bresponsible\b/i.test(text) && /\baccountable\b/i.test(text)
        );
      },
      8,
    );

    let hasResponsible = roleRefs.length > 0;
    let hasAccountable = roleRefs.length > 0;
    for (const r of raciRefs.slice(0, 8)) {
      const t = readText(join(ctx.targetPath, r), 40_000) || "";
      if (/\bresponsible\b/i.test(t)) hasResponsible = true;
      if (/\baccountable\b/i.test(t)) hasAccountable = true;
    }

    const imported = loadImported(ctx);
    const report = buildAgentRaciOwnershipReport({
      assessedAt: ctx.assessedAt.toISOString(),
      raciRegister: { found: raciRefs.length > 0, refs: raciRefs },
      roleSignals: {
        responsible: hasResponsible,
        accountable: hasAccountable,
        refs: roleRefs,
      },
      agentSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "agent-raci-ownership-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "policy",
        ref: `imports/${PLUGIN_ID}/agent-raci-ownership-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "agent-raci-ownership",
          "agn-r3",
          DETECTOR_ID,
          ...(report.summary.raciPresent ? ["raci-register"] : []),
          ...(report.summary.agnR3Satisfied ? ["agn-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([...raciRefs.slice(0, 4), ...roleRefs.slice(0, 2)]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "docs",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["agent-raci-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-R3 status=${report.summary.statusHint} raci=${report.summary.raciPresent} ra=${report.summary.raRolesPresent} satisfied=${report.summary.agnR3Satisfied}; report=imports/${PLUGIN_ID}/agent-raci-ownership-report.json`,
      nodes,
    };
  },
};
