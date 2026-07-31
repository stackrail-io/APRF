/**
 * quality-slo-auto-rollback — CHG-R3 / repo-quality-slo-auto-rollback.
 *
 * Discovers quality SLO burn → automated rollback or page+runbook (MTTA).
 * Import qualitySloBurnWiredToRollbackOrPage + testOrDrillOccurredLast90Days
 * under imports/quality-slo-auto-rollback/ to unlock PASS (measuredAt ≤90d).
 * Page path also needs measuredMttaPresent=true.
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

const PLUGIN_ID = "quality-slo-auto-rollback";
const RELATED = ["CHG-R3"] as const;
const DETECTOR_ID = "repo-quality-slo-auto-rollback";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_RELEASE_RE =
  /(prompt|model|llm|ai[\s_-]*release|eval|quality|slo|deploy|canary)/i;

const SLO_BURN_RE =
  /\b(quality[\s_-]*slo|slo[\s_-]*burn|error[\s_-]*budget|quality[\s_-]*burn|safety[\s_-]*slo|task[\s_-]*success[\s_-]*slo)\b/i;

const AUTO_ROLLBACK_RE =
  /\b(auto(?:mated)?[\s_-]*rollback|rollback[\s_-]*on[\s_-]*(burn|slo|quality)|trigger[\s_-]*rollback)\b/i;

const PAGE_RE =
  /\b(page[\s_-]*on[\s_-]*burn|page\+runbook|pagerduty|opsgenie|measured[\s_-]*mtta|mtta)\b/i;

const TEST_DRILL_RE =
  /\b(rollback[\s_-]*test|burn[\s_-]*drill|auto[\s_-]*rollback[\s_-]*drill|chaos[\s_-]*rollback|synthetic[\s_-]*burn)\b/i;

export interface QualitySloAutoRollbackReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    sloBurn: { found: boolean; refs: string[] };
    autoRollback: { found: boolean; refs: string[] };
    pagePath: { found: boolean; refs: string[] };
    testDrill: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    qualitySloBurnWiredToRollbackOrPage: boolean | null;
    automatedRollbackConfigured: boolean | null;
    measuredMttaPresent: boolean | null;
    testOrDrillOccurredLast90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiReleaseSignalsPresent: boolean;
    automationSignalsPresent: boolean;
    chgR3Satisfied: boolean | null;
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

function detectAiReleaseSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_RELEASE_RE.test(path) ||
        /\b(ai[\s_-]*release|model[\s_-]*pin|prompt[\s_-]*release)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): QualitySloAutoRollbackReport["importedResults"] {
  const sources: string[] = [];
  let qualitySloBurnWiredToRollbackOrPage: boolean | null = null;
  let automatedRollbackConfigured: boolean | null = null;
  let measuredMttaPresent: boolean | null = null;
  let testOrDrillOccurredLast90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/quality-slo-auto-rollback-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      qualitySloBurnWiredToRollbackOrPage =
        asBool(data.qualitySloBurnWiredToRollbackOrPage) ??
        asBool(data.quality_slo_burn_wired_to_rollback_or_page) ??
        asBool(data.sloBurnWired) ??
        qualitySloBurnWiredToRollbackOrPage;
      automatedRollbackConfigured =
        asBool(data.automatedRollbackConfigured) ??
        asBool(data.automated_rollback_configured) ??
        asBool(data.autoRollback) ??
        automatedRollbackConfigured;
      measuredMttaPresent =
        asBool(data.measuredMttaPresent) ??
        asBool(data.measured_mtta_present) ??
        asBool(data.hasMeasuredMtta) ??
        measuredMttaPresent;
      testOrDrillOccurredLast90Days =
        asBool(data.testOrDrillOccurredLast90Days) ??
        asBool(data.test_or_drill_occurred_last_90_days) ??
        asBool(data.testOrDrillOccurred) ??
        testOrDrillOccurredLast90Days;

      // Affirmative wiring overrides earlier false.
      if (asBool(data.burnTriggersAutomatedRollback) === true) {
        qualitySloBurnWiredToRollbackOrPage = true;
        automatedRollbackConfigured = true;
      }
      if (asBool(data.burnPagesWithRunbook) === true) {
        qualitySloBurnWiredToRollbackOrPage = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    qualitySloBurnWiredToRollbackOrPage,
    automatedRollbackConfigured,
    measuredMttaPresent,
    testOrDrillOccurredLast90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildQualitySloAutoRollbackReport(opts: {
  assessedAt: string;
  sloBurn: { found: boolean; refs: string[] };
  autoRollback: { found: boolean; refs: string[] };
  pagePath: { found: boolean; refs: string[] };
  testDrill: { found: boolean; refs: string[] };
  aiReleaseSignals: boolean;
  imported: QualitySloAutoRollbackReport["importedResults"];
}): QualitySloAutoRollbackReport {
  const notes: string[] = [];
  const automationSignalsPresent =
    opts.sloBurn.found ||
    opts.autoRollback.found ||
    opts.pagePath.found ||
    opts.testDrill.found;

  if (
    !opts.aiReleaseSignals &&
    !automationSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI-release/SLO-burn signals — CHG-R3 may be NOT_APPLICABLE if no AI releases with quality SLOs.",
    );
  }
  if (opts.sloBurn.found) {
    notes.push(`SLO-burn refs: ${opts.sloBurn.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.autoRollback.found) {
    notes.push(
      `Auto-rollback refs: ${opts.autoRollback.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.pagePath.found) {
    notes.push(`Page-path refs: ${opts.pagePath.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.testDrill.found) {
    notes.push(`Test/drill refs: ${opts.testDrill.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (wired=${opts.imported.qualitySloBurnWiredToRollbackOrPage}, auto=${opts.imported.automatedRollbackConfigured}, mtta=${opts.imported.measuredMttaPresent}, test=${opts.imported.testOrDrillOccurredLast90Days})`,
    );
  } else if (automationSignalsPresent) {
    notes.push(
      "Automation signals alone are PARTIAL — import qualitySloBurnWiredToRollbackOrPage=true + testOrDrillOccurredLast90Days=true (and measuredMttaPresent if page path) under imports/quality-slo-auto-rollback/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const wiredOk = opts.imported.qualitySloBurnWiredToRollbackOrPage === true;
  const testOk = opts.imported.testOrDrillOccurredLast90Days === true;
  const autoOk = opts.imported.automatedRollbackConfigured === true;
  const mttaOk = opts.imported.measuredMttaPresent === true;
  // Accept auto rollback OR page path with measured MTTA.
  const actionPathOk =
    autoOk ||
    mttaOk ||
    (opts.imported.automatedRollbackConfigured === null &&
      opts.imported.measuredMttaPresent === null &&
      wiredOk);
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: QualitySloAutoRollbackReport["summary"]["statusHint"] =
    "not_demonstrated";
  let chgR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.qualitySloBurnWiredToRollbackOrPage === false ||
      opts.imported.testOrDrillOccurredLast90Days === false ||
      (opts.imported.automatedRollbackConfigured === false &&
        opts.imported.measuredMttaPresent === false) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.aiReleaseSignals &&
    !automationSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    chgR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    chgR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing SLO-burn wiring, missing test/drill, neither auto-rollback nor measured MTTA, or evidence older than 90 days — CHG-R3 fail.",
    );
  } else if (
    (automationSignalsPresent || opts.imported.found) &&
    wiredOk &&
    testOk &&
    actionPathOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    chgR3Satisfied = true;
  } else if (automationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    chgR3Satisfied = false;
    if (opts.imported.found && !wiredOk) {
      notes.push("Import must show qualitySloBurnWiredToRollbackOrPage=true.");
    }
    if (opts.imported.found && !testOk) {
      notes.push("Import must show testOrDrillOccurredLast90Days=true.");
    }
    if (opts.imported.found && !actionPathOk) {
      notes.push(
        "Import must show automatedRollbackConfigured=true or measuredMttaPresent=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-R3 PASS.",
      );
    }
  } else if (opts.aiReleaseSignals) {
    statusHint = "not_demonstrated";
    chgR3Satisfied = null;
    notes.push(
      "AI-release signals present but no quality SLO burn → rollback/page automation evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      sloBurn: opts.sloBurn,
      autoRollback: opts.autoRollback,
      pagePath: opts.pagePath,
      testDrill: opts.testDrill,
    },
    importedResults: opts.imported,
    summary: {
      aiReleaseSignalsPresent: opts.aiReleaseSignals,
      automationSignalsPresent,
      chgR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const qualitySloAutoRollbackCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiReleaseSignals = detectAiReleaseSignals(ctx.targetPath, maxFiles);

    const sloBurnRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SLO_BURN_RE.test(path) || SLO_BURN_RE.test(text),
      12,
    );
    const autoRollbackRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AUTO_ROLLBACK_RE.test(path) || AUTO_ROLLBACK_RE.test(text),
      12,
    );
    const pagePathRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PAGE_RE.test(path) || PAGE_RE.test(text),
      12,
    );
    const testDrillRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TEST_DRILL_RE.test(path) || TEST_DRILL_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildQualitySloAutoRollbackReport({
      assessedAt: ctx.assessedAt.toISOString(),
      sloBurn: { found: sloBurnRefs.length > 0, refs: sloBurnRefs },
      autoRollback: {
        found: autoRollbackRefs.length > 0,
        refs: autoRollbackRefs,
      },
      pagePath: { found: pagePathRefs.length > 0, refs: pagePathRefs },
      testDrill: { found: testDrillRefs.length > 0, refs: testDrillRefs },
      aiReleaseSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "quality-slo-auto-rollback-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/quality-slo-auto-rollback-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "quality-slo-auto-rollback",
          "chg-r3",
          DETECTOR_ID,
          ...(report.summary.chgR3Satisfied ? ["chg-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.sloBurn.refs,
        ...report.signals.autoRollback.refs,
        ...report.signals.pagePath.refs,
        ...report.signals.testDrill.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["quality-slo-auto-rollback-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-R3 status=${report.summary.statusHint} automation=${report.summary.automationSignalsPresent} satisfied=${report.summary.chgR3Satisfied}; report=imports/${PLUGIN_ID}/quality-slo-auto-rollback-report.json`,
      nodes,
    };
  },
};
