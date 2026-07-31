/**
 * ai-model-routing — COST-R2 / repo-model-routing-config detector executor.
 *
 * Discovers cheap-vs-premium model routing. Import eval + misroute evidence
 * under imports/ai-model-routing/ to unlock PASS.
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

const PLUGIN_ID = "ai-model-routing";
const RELATED = ["COST-R2"] as const;
const DETECTOR_ID = "repo-model-routing-config";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|completion|litellm|router)/i;

const ROUTING_RE =
  /\b(model[_-]?rout|rout(?:e|er|ing)[_-]?(model|llm|task)|cheap[_-]?(model|tier)|premium[_-]?(model|tier)|frontier[_-]?model|task[_-]?class|model[_-]?select|cascade|fallback[_-]?model)\b/i;

const EVAL_RE =
  /\b(eval|evaluation|quality[_-]?(gate|score|tolerance)|baseline|promptfoo|golden[_-]?set)\b/i;

const MISROUTE_RE =
  /\b(misrout|wrong[_-]?model|route[_-]?error|routing[_-]?(accuracy|error|drift))\b/i;

export interface AiModelRoutingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  routingPolicy: { found: boolean; refs: string[] };
  evalSignals: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    routingEnabled: boolean | null;
    evalWithinTolerance: boolean | null;
    misrouteMonitored: boolean | null;
    monitorWindowDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    routingPresent: boolean;
    costR2Satisfied: boolean | null;
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
      ".tf",
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

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm)\b/i.test(
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
): AiModelRoutingReport["importedResults"] {
  const sources: string[] = [];
  let routingEnabled: boolean | null = null;
  let evalWithinTolerance: boolean | null = null;
  let misrouteMonitored: boolean | null = null;
  let monitorWindowDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-model-routing-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      routingEnabled =
        asBool(data.routingEnabled) ??
        asBool(data.lowRiskRoutesToCheap) ??
        asBool(data.policyPresent) ??
        routingEnabled;
      evalWithinTolerance =
        asBool(data.evalWithinTolerance) ??
        asBool(data.evalPassed) ??
        asBool(data.qualityWithinTolerance) ??
        evalWithinTolerance;
      misrouteMonitored =
        asBool(data.misrouteMonitored) ??
        asBool(data.misrouteRateMonitored) ??
        asBool(data.hasMisrouteMetrics) ??
        misrouteMonitored;
      monitorWindowDays =
        asNum(data.monitorWindowDays) ??
        asNum(data.windowDays) ??
        asNum(data.misrouteWindowDays) ??
        monitorWindowDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const results = Array.isArray(data.results)
        ? (data.results as Array<Record<string, unknown>>)
        : Array.isArray(data.evals)
          ? (data.evals as Array<Record<string, unknown>>)
          : [];
      for (const r of results) {
        if (asBool(r.withinTolerance) === true || asBool(r.passed) === true) {
          evalWithinTolerance = true;
        }
        if (asBool(r.misrouteMonitored) === true) misrouteMonitored = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    routingEnabled,
    evalWithinTolerance,
    misrouteMonitored,
    monitorWindowDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiModelRoutingReport(opts: {
  assessedAt: string;
  routing: { found: boolean; refs: string[] };
  evals: { found: boolean; refs: string[] };
  aiSignals: boolean;
  imported: AiModelRoutingReport["importedResults"];
}): AiModelRoutingReport {
  const notes: string[] = [];
  const routingPresent =
    opts.routing.found || opts.imported.routingEnabled === true;

  if (
    !opts.aiSignals &&
    !routingPresent &&
    !opts.evals.found &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI/model-routing signals — COST-R2 may be NOT_APPLICABLE if there is no multi-model routing surface.",
    );
  }
  if (opts.routing.found) {
    notes.push(`Routing policy refs: ${opts.routing.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No model-routing policy signals found.");
  }
  if (opts.evals.found) {
    notes.push(`Eval signal refs: ${opts.evals.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (routing=${opts.imported.routingEnabled}, eval=${opts.imported.evalWithinTolerance}, misroute=${opts.imported.misrouteMonitored}, windowDays=${opts.imported.monitorWindowDays})`,
    );
  } else if (routingPresent) {
    notes.push(
      "Routing policy alone is PARTIAL — import eval + ≤30-day misroute evidence under imports/ai-model-routing/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const windowOk =
    opts.imported.monitorWindowDays !== null &&
    opts.imported.monitorWindowDays <= 30 &&
    opts.imported.monitorWindowDays > 0;
  // Spec: misroute monitored ≤30 days — window must be present and ≤30
  const misrouteOk =
    opts.imported.misrouteMonitored === true && windowOk && ageOk;
  const evalOk = opts.imported.evalWithinTolerance === true;
  const policyOk =
    opts.routing.found || opts.imported.routingEnabled === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiModelRoutingReport["summary"]["statusHint"] =
    "not_demonstrated";
  let costR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.routingEnabled === false ||
      opts.imported.evalWithinTolerance === false ||
      opts.imported.misrouteMonitored === false ||
      (opts.imported.monitorWindowDays !== null &&
        opts.imported.monitorWindowDays > 30) ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.routing.found &&
    !opts.evals.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    costR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    costR2Satisfied = false;
    notes.push(
      "Imported results show routing/eval/misroute gaps, window >30 days, or stale evidence — COST-R2 fail.",
    );
  } else if (policyOk && evalOk && misrouteOk && importFresh) {
    statusHint = "pass";
    costR2Satisfied = true;
  } else if (
    opts.routing.found ||
    opts.evals.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    costR2Satisfied = false;
    if (opts.imported.found && !policyOk) {
      notes.push("Need routingEnabled=true (repo and/or import).");
    }
    if (opts.imported.found && !evalOk) {
      notes.push("Import must show evalWithinTolerance=true.");
    }
    if (opts.imported.found && !misrouteOk) {
      notes.push(
        "Import must show misrouteMonitored=true with monitorWindowDays ≤30 and ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock COST-R2 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    costR2Satisfied = null;
    notes.push(
      "AI signals present but no model-routing policy or eval/misroute evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    costR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    routingPolicy: opts.routing,
    evalSignals: opts.evals,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      routingPresent,
      costR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiModelRoutingCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const routingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!ROUTING_RE.test(path) && !ROUTING_RE.test(text)) return false;
        return (
          AI_PATH_RE.test(path) ||
          AI_PATH_RE.test(text) ||
          ROUTING_RE.test(path)
        );
      },
    );
    const evalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        const hasEval = EVAL_RE.test(path) || EVAL_RE.test(text);
        const hasRoute =
          ROUTING_RE.test(path) ||
          ROUTING_RE.test(text) ||
          MISROUTE_RE.test(text) ||
          /\b(cheap|premium|router)\b/i.test(text);
        return hasEval && hasRoute;
      },
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiModelRoutingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      routing: { found: routingRefs.length > 0, refs: routingRefs },
      evals: { found: evalRefs.length > 0, refs: evalRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-model-routing-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/ai-model-routing-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-model-routing",
          "cost-r2",
          DETECTOR_ID,
          ...(report.summary.routingPresent ? ["model-routing-policy"] : []),
          ...(report.summary.costR2Satisfied ? ["cost-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([...routingRefs.slice(0, 4), ...evalRefs.slice(0, 2)]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-model-routing-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `COST-R2 status=${report.summary.statusHint} routing=${report.summary.routingPresent} satisfied=${report.summary.costR2Satisfied}; report=imports/${PLUGIN_ID}/ai-model-routing-report.json`,
      nodes,
    };
  },
};
