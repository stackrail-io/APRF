/**
 * ai-safety-quality-alerts — INC-R1 / repo-ai-safety-quality-alerts.
 *
 * Discovers on-call paging for non-infra AI safety/quality signals.
 * Import atLeastTwoNonInfraPagingSignals + eachSignalHasThresholdAndOwner +
 * policyReviewedWithin90Days under imports/ai-safety-quality-alerts/
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

const PLUGIN_ID = "ai-safety-quality-alerts";
const RELATED = ["INC-R1"] as const;
const DETECTOR_ID = "repo-ai-safety-quality-alerts";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const SAFETY_QUALITY_RE =
  /\b(refusal[\s_-]*rate|eval[\s_-]*score|toxicity|jailbreak|hallucinat|safety[\s_-]*signal|quality[\s_-]*signal|prompt[\s_-]*injection[\s_-]*rate|guardrail[\s_-]*hit|content[\s_-]*filter)\b/i;

const PAGING_RE =
  /\b(page|paging|pagerduty|opsgenie|on[\s_-]*call|alert[\s_-]*policy|notification[\s_-]*policy|escalate|sev[\s_-]*page)\b/i;

const THRESHOLD_OWNER_RE =
  /\b(threshold|owner|runbook|alert[\s_-]*owner|paging[\s_-]*policy)\b/i;

export interface AiSafetyQualityAlertsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    safetyQuality: { found: boolean; refs: string[] };
    paging: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    atLeastTwoNonInfraPagingSignals: boolean | null;
    nonInfraPagingSignalCount: number | null;
    eachSignalHasThresholdAndOwner: boolean | null;
    policyReviewedWithin90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    alertSignalsPresent: boolean;
    incR1Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".tf", ".hcl"],
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

function loadImported(
  ctx: CollectorContext,
): AiSafetyQualityAlertsReport["importedResults"] {
  const sources: string[] = [];
  let atLeastTwoNonInfraPagingSignals: boolean | null = null;
  let nonInfraPagingSignalCount: number | null = null;
  let eachSignalHasThresholdAndOwner: boolean | null = null;
  let policyReviewedWithin90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-safety-quality-alerts-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      nonInfraPagingSignalCount =
        asNum(data.nonInfraPagingSignalCount) ??
        asNum(data.non_infra_paging_signal_count) ??
        nonInfraPagingSignalCount;
      atLeastTwoNonInfraPagingSignals =
        asBool(data.atLeastTwoNonInfraPagingSignals) ??
        asBool(data.at_least_two_non_infra_paging_signals) ??
        atLeastTwoNonInfraPagingSignals;
      eachSignalHasThresholdAndOwner =
        asBool(data.eachSignalHasThresholdAndOwner) ??
        asBool(data.each_signal_has_threshold_and_owner) ??
        asBool(data.allSignalsHaveThresholdAndOwner) ??
        eachSignalHasThresholdAndOwner;
      policyReviewedWithin90Days =
        asBool(data.policyReviewedWithin90Days) ??
        asBool(data.policy_reviewed_within_90_days) ??
        policyReviewedWithin90Days;

      if (nonInfraPagingSignalCount !== null) {
        atLeastTwoNonInfraPagingSignals =
          atLeastTwoNonInfraPagingSignals ?? nonInfraPagingSignalCount >= 2;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    atLeastTwoNonInfraPagingSignals,
    nonInfraPagingSignalCount,
    eachSignalHasThresholdAndOwner,
    policyReviewedWithin90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSafetyQualityAlertsReport(opts: {
  assessedAt: string;
  safetyQuality: { found: boolean; refs: string[] };
  paging: { found: boolean; refs: string[] };
  imported: AiSafetyQualityAlertsReport["importedResults"];
}): AiSafetyQualityAlertsReport {
  const notes: string[] = [];
  const alertSignalsPresent =
    opts.safetyQuality.found || opts.paging.found;

  if (!alertSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI safety/quality paging signals — INC-R1 may be NOT_APPLICABLE if no production AI system is in scope.",
    );
  }
  if (opts.safetyQuality.found) {
    notes.push(
      `Safety/quality refs: ${opts.safetyQuality.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.paging.found) {
    notes.push(`Paging refs: ${opts.paging.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (twoSignals=${opts.imported.atLeastTwoNonInfraPagingSignals}, count=${opts.imported.nonInfraPagingSignalCount}, thresholdOwner=${opts.imported.eachSignalHasThresholdAndOwner}, reviewed=${opts.imported.policyReviewedWithin90Days})`,
    );
  } else if (alertSignalsPresent) {
    notes.push(
      "Alert signals alone are PARTIAL — import atLeastTwoNonInfraPagingSignals=true + eachSignalHasThresholdAndOwner=true + policyReviewedWithin90Days=true (measuredAt ≤90d) under imports/ai-safety-quality-alerts/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const twoSignalsOk =
    opts.imported.atLeastTwoNonInfraPagingSignals === true ||
    (opts.imported.nonInfraPagingSignalCount !== null &&
      opts.imported.nonInfraPagingSignalCount >= 2);
  const thresholdOwnerOk =
    opts.imported.eachSignalHasThresholdAndOwner === true;
  const reviewedOk = opts.imported.policyReviewedWithin90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSafetyQualityAlertsReport["summary"]["statusHint"] =
    "not_demonstrated";
  let incR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.atLeastTwoNonInfraPagingSignals === false ||
      (typeof opts.imported.nonInfraPagingSignalCount === "number" &&
        opts.imported.nonInfraPagingSignalCount < 2) ||
      opts.imported.eachSignalHasThresholdAndOwner === false ||
      opts.imported.policyReviewedWithin90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!alertSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incR1Satisfied = false;
    notes.push(
      "Imported evidence shows <2 non-infra paging signals, missing threshold/owner, stale policy, or evidence older than 90 days — INC-R1 fail.",
    );
  } else if (
    (alertSignalsPresent || opts.imported.found) &&
    twoSignalsOk &&
    thresholdOwnerOk &&
    reviewedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incR1Satisfied = true;
  } else if (alertSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incR1Satisfied = false;
    if (opts.imported.found && !twoSignalsOk) {
      notes.push(
        "Import must show atLeastTwoNonInfraPagingSignals=true (or nonInfraPagingSignalCount≥2).",
      );
    }
    if (opts.imported.found && !thresholdOwnerOk) {
      notes.push("Import must show eachSignalHasThresholdAndOwner=true.");
    }
    if (opts.imported.found && !reviewedOk) {
      notes.push("Import must show policyReviewedWithin90Days=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      safetyQuality: opts.safetyQuality,
      paging: opts.paging,
    },
    importedResults: opts.imported,
    summary: {
      alertSignalsPresent,
      incR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSafetyQualityAlertsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const safetyQuality = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        SAFETY_QUALITY_RE.test(path) || SAFETY_QUALITY_RE.test(text),
      10,
    );
    const paging = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PAGING_RE.test(path) || PAGING_RE.test(text)) &&
        (SAFETY_QUALITY_RE.test(path + text) ||
          THRESHOLD_OWNER_RE.test(text) ||
          /alert|pager|on[_-]?call/i.test(path)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiSafetyQualityAlertsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      safetyQuality: {
        found: safetyQuality.length > 0,
        refs: safetyQuality,
      },
      paging: { found: paging.length > 0, refs: paging },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-safety-quality-alerts-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-safety-quality-alerts-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-safety-quality-alerts",
          "inc-r1",
          DETECTOR_ID,
          ...(report.summary.incR1Satisfied ? ["inc-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.safetyQuality.refs,
        ...report.signals.paging.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-safety-quality-alerts-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-R1 status=${report.summary.statusHint} signals=${report.summary.alertSignalsPresent} satisfied=${report.summary.incR1Satisfied}; report=imports/${PLUGIN_ID}/ai-safety-quality-alerts-report.json`,
      nodes,
    };
  },
};
