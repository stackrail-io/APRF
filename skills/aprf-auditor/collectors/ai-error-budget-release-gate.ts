/**
 * ai-error-budget-release-gate — PERF-R1 / repo-ai-error-budget-release-gate.
 *
 * Discovers error-budget → release freeze/risk-acceptance policy + recent gate.
 * Import errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance +
 * gatedEventOrDrillWithin90Days under imports/ai-error-budget-release-gate/
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

const PLUGIN_ID = "ai-error-budget-release-gate";
const RELATED = ["PERF-R1"] as const;
const DETECTOR_ID = "repo-ai-error-budget-release-gate";
const IMPORT_MAX_AGE_DAYS = 90;
const GATE_MAX_AGE_DAYS = 90;

const ERROR_BUDGET_RE =
  /\b(error[\s_-]*budget|budget[\s_-]*policy|slo[\s_-]*budget|burned[\s_-]*budget)\b/i;

const RELEASE_GATE_RE =
  /\b(release[\s_-]*freeze|freeze[\s_-]*release|deploy[\s_-]*freeze|change[\s_-]*freeze|risk[\s_-]*acceptance|gate[\s_-]*release|block[\s_-]*release|velocity[\s_-]*gate)\b/i;

const GATED_EVENT_RE =
  /\b(gated[\s_-]*(event|release|deploy)|budget[\s_-]*burn[\s_-]*(gate|freeze)|error[\s_-]*budget[\s_-]*drill|freeze[\s_-]*drill)\b/i;

export interface AiErrorBudgetReleaseGateReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    errorBudget: { found: boolean; refs: string[] };
    releaseGate: { found: boolean; refs: string[] };
    gatedEvent: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance:
      | boolean
      | null;
    gatedEventOrDrillWithin90Days: boolean | null;
    lastGatedEventAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    perfR1Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".ts", ".py"],
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

function loadImported(
  ctx: CollectorContext,
): AiErrorBudgetReleaseGateReport["importedResults"] {
  const sources: string[] = [];
  let errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance:
    | boolean
    | null = null;
  let gatedEventOrDrillWithin90Days: boolean | null = null;
  let lastGatedEventAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-error-budget-release-gate-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      lastGatedEventAgeDays =
        asNum(data.lastGatedEventAgeDays) ??
        asNum(data.last_gated_event_age_days) ??
        lastGatedEventAgeDays;
      errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance =
        asBool(
          data.errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance,
        ) ??
        asBool(
          data.error_budget_policy_links_ai_slos_to_release_freeze_or_risk_acceptance,
        ) ??
        asBool(data.errorBudgetReleaseGateConfigured) ??
        errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance;
      gatedEventOrDrillWithin90Days =
        asBool(data.gatedEventOrDrillWithin90Days) ??
        asBool(data.gated_event_or_drill_within_90_days) ??
        gatedEventOrDrillWithin90Days;

      if (lastGatedEventAgeDays !== null) {
        gatedEventOrDrillWithin90Days =
          gatedEventOrDrillWithin90Days ??
          lastGatedEventAgeDays <= GATE_MAX_AGE_DAYS;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance,
    gatedEventOrDrillWithin90Days,
    lastGatedEventAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiErrorBudgetReleaseGateReport(opts: {
  assessedAt: string;
  errorBudget: { found: boolean; refs: string[] };
  releaseGate: { found: boolean; refs: string[] };
  gatedEvent: { found: boolean; refs: string[] };
  imported: AiErrorBudgetReleaseGateReport["importedResults"];
}): AiErrorBudgetReleaseGateReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.errorBudget.found || opts.releaseGate.found || opts.gatedEvent.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI error-budget release-gate signals — PERF-R1 may be NOT_APPLICABLE if no critical AI journey error budgets are in scope.",
    );
  }
  if (opts.errorBudget.found) {
    notes.push(
      `Error-budget refs: ${opts.errorBudget.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (policy=${opts.imported.errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance}, gated90d=${opts.imported.gatedEventOrDrillWithin90Days}, lastGateAge=${opts.imported.lastGatedEventAgeDays})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance=true + gatedEventOrDrillWithin90Days=true (measuredAt ≤90d) under imports/ai-error-budget-release-gate/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const policyOk =
    opts.imported.errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance ===
    true;
  const gatedOk =
    opts.imported.gatedEventOrDrillWithin90Days === true ||
    (opts.imported.lastGatedEventAgeDays !== null &&
      opts.imported.lastGatedEventAgeDays <= GATE_MAX_AGE_DAYS);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiErrorBudgetReleaseGateReport["summary"]["statusHint"];
  let perfR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance ===
      false ||
      opts.imported.gatedEventOrDrillWithin90Days === false ||
      (typeof opts.imported.lastGatedEventAgeDays === "number" &&
        opts.imported.lastGatedEventAgeDays > GATE_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    perfR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    perfR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing freeze/risk-acceptance policy, no gated event/drill ≤90d, or evidence older than 90 days — PERF-R1 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    policyOk &&
    gatedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    perfR1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    perfR1Satisfied = false;
    if (opts.imported.found && !policyOk) {
      notes.push(
        "Import must show errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance=true.",
      );
    }
    if (opts.imported.found && !gatedOk) {
      notes.push(
        "Import must show gatedEventOrDrillWithin90Days=true (or lastGatedEventAgeDays≤90).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PERF-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    perfR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      errorBudget: opts.errorBudget,
      releaseGate: opts.releaseGate,
      gatedEvent: opts.gatedEvent,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      perfR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiErrorBudgetReleaseGateCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const errorBudget = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ERROR_BUDGET_RE.test(path) || ERROR_BUDGET_RE.test(text),
      10,
    );
    const releaseGate = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RELEASE_GATE_RE.test(path) || RELEASE_GATE_RE.test(text)) &&
        (ERROR_BUDGET_RE.test(path + text) ||
          /slo|budget|ai|llm|release|deploy/i.test(path + text)),
      8,
    );
    const gatedEvent = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => GATED_EVENT_RE.test(path) || GATED_EVENT_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiErrorBudgetReleaseGateReport({
      assessedAt: ctx.assessedAt.toISOString(),
      errorBudget: { found: errorBudget.length > 0, refs: errorBudget },
      releaseGate: { found: releaseGate.length > 0, refs: releaseGate },
      gatedEvent: { found: gatedEvent.length > 0, refs: gatedEvent },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-error-budget-release-gate-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-error-budget-release-gate-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-error-budget-release-gate",
          "perf-r1",
          DETECTOR_ID,
          ...(report.summary.perfR1Satisfied ? ["perf-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.errorBudget.refs,
        ...report.signals.releaseGate.refs,
        ...report.signals.gatedEvent.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-error-budget-release-gate-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PERF-R1 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.perfR1Satisfied}; report=imports/${PLUGIN_ID}/ai-error-budget-release-gate-report.json`,
      nodes,
    };
  },
};
