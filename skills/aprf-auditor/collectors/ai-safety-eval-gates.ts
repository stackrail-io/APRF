/**
 * ai-safety-eval-gates — SAF-M2 / repo-ai-safety-eval-gates.
 *
 * Discovers automated safety eval suites + blocking release gates.
 * Import safetySuiteWithNumericThresholdsConfigured +
 * inScopeReleasesWithSafetyGatePct=100 +
 * failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d under
 * imports/ai-safety-eval-gates/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-safety-eval-gates";
const RELATED = ["SAF-M2"] as const;
const DETECTOR_ID = "repo-ai-safety-eval-gates";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const SUITE_RE =
  /\b(safety[_-]?(eval|suite|gate|benchmark|test)|content[_-]?safety[_-]?(eval|suite|gate)|toxicity[_-]?(eval|suite)|refusal[_-]?(eval|suite)|harm[_-]?(eval|suite)|moderation[_-]?(eval|suite))\b/i;

const THRESHOLD_RE =
  /\b(safety[_-]?threshold|toxicity[_-]?threshold|refusal[_-]?rate|numeric[_-]?threshold|pass[_-]?rate|min[_-]?score)\b/i;

const GATE_RE =
  /\b(safety[_-]?(release|deploy|ci)[_-]?gate|block[_-]?(promote|deploy|merge|release)|required[_-]?check|fail[_-]?the[_-]?build)\b/i;

const WAIVER_RE =
  /\b(waiver|exception|time[_-]?boxed|expiry|expires[_-]?(at|on)|gate[_-]?bypass)\b/i;

export interface AiSafetyEvalGatesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    suite: { found: boolean; refs: string[] };
    thresholds: { found: boolean; refs: string[] };
    gate: { found: boolean; refs: string[] };
    waiver: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    safetySuiteWithNumericThresholdsConfigured: boolean | null;
    inScopeReleasesWithSafetyGatePct: number | null;
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    safM2Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".toml",
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

function loadImported(
  ctx: CollectorContext,
): AiSafetyEvalGatesReport["importedResults"] {
  const sources: string[] = [];
  let safetySuiteWithNumericThresholdsConfigured: boolean | null = null;
  let inScopeReleasesWithSafetyGatePct: number | null = null;
  let failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d: boolean | null =
    null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-safety-eval-gates-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      safetySuiteWithNumericThresholdsConfigured =
        asBool(data.safetySuiteWithNumericThresholdsConfigured) ??
        asBool(data.safety_suite_with_numeric_thresholds_configured) ??
        asBool(data.safetySuiteConfigured) ??
        asBool(data.suiteWithNumericThresholds) ??
        safetySuiteWithNumericThresholdsConfigured;
      inScopeReleasesWithSafetyGatePct =
        asNum(data.inScopeReleasesWithSafetyGatePct) ??
        asNum(data.in_scope_releases_with_safety_gate_pct) ??
        asNum(data.safetyGateCoveragePct) ??
        asNum(data.releaseCoveragePct) ??
        inScopeReleasesWithSafetyGatePct;
      failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d =
        asBool(
          data.failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d,
        ) ??
        asBool(
          data.failing_gate_blocks_promote_unless_owned_waiver_expiry_14d,
        ) ??
        asBool(data.failingGateBlocksPromote) ??
        asBool(data.blockingGateWithOwnedWaivers) ??
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    safetySuiteWithNumericThresholdsConfigured,
    inScopeReleasesWithSafetyGatePct,
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSafetyEvalGatesReport(opts: {
  assessedAt: string;
  suite: { found: boolean; refs: string[] };
  thresholds: { found: boolean; refs: string[] };
  gate: { found: boolean; refs: string[] };
  waiver: { found: boolean; refs: string[] };
  imported: AiSafetyEvalGatesReport["importedResults"];
}): AiSafetyEvalGatesReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.suite.found ||
    opts.thresholds.found ||
    opts.gate.found ||
    opts.waiver.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No safety-eval gate signals — SAF-M2 may be NOT_APPLICABLE if there are no in-scope AI releases.",
    );
  }
  if (opts.suite.found) {
    notes.push(`Suite refs: ${opts.suite.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.thresholds.found) {
    notes.push(
      `Threshold refs: ${opts.thresholds.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.gate.found) {
    notes.push(`Gate refs: ${opts.gate.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (suite=${opts.imported.safetySuiteWithNumericThresholdsConfigured}, coveragePct=${opts.imported.inScopeReleasesWithSafetyGatePct}, blocking=${opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import safetySuiteWithNumericThresholdsConfigured=true + inScopeReleasesWithSafetyGatePct=100 + failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d=true (measuredAt ≤90d) under imports/ai-safety-eval-gates/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const suiteOk =
    opts.imported.safetySuiteWithNumericThresholdsConfigured === true;
  const coverageOk = opts.imported.inScopeReleasesWithSafetyGatePct === 100;
  const blockingOk =
    opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSafetyEvalGatesReport["summary"]["statusHint"];
  let safM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.safetySuiteWithNumericThresholdsConfigured === false ||
      (opts.imported.inScopeReleasesWithSafetyGatePct !== null &&
        opts.imported.inScopeReleasesWithSafetyGatePct < 100) ||
      opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d ===
        false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing suite/thresholds, coverage <100%, non-blocking fails without owned ≤14d waivers, or attest older than 90 days — SAF-M2 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    suiteOk &&
    coverageOk &&
    blockingOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    safM2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safM2Satisfied = false;
    if (opts.imported.found && !suiteOk) {
      notes.push(
        "Import must show safetySuiteWithNumericThresholdsConfigured=true.",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show inScopeReleasesWithSafetyGatePct=100 for the last 30 days.",
      );
    }
    if (opts.imported.found && !blockingOk) {
      notes.push(
        "Import must show failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      suite: opts.suite,
      thresholds: opts.thresholds,
      gate: opts.gate,
      waiver: opts.waiver,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      safM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSafetyEvalGatesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const suiteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SUITE_RE.test(path) || SUITE_RE.test(text),
      10,
    );
    const thresholdRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => THRESHOLD_RE.test(path) || THRESHOLD_RE.test(text),
      10,
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => GATE_RE.test(path) || GATE_RE.test(text),
      10,
    );
    const waiverRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        WAIVER_RE.test(path) ||
        ((SUITE_RE.test(path) || GATE_RE.test(path)) && WAIVER_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiSafetyEvalGatesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      suite: { found: suiteRefs.length > 0, refs: suiteRefs },
      thresholds: { found: thresholdRefs.length > 0, refs: thresholdRefs },
      gate: { found: gateRefs.length > 0, refs: gateRefs },
      waiver: { found: waiverRefs.length > 0, refs: waiverRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-safety-eval-gates-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-safety-eval-gates-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-safety-eval-gates",
          "saf-m2",
          DETECTOR_ID,
          ...(report.summary.safM2Satisfied ? ["saf-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.suite.refs,
        ...report.signals.thresholds.refs,
        ...report.signals.gate.refs,
        ...report.signals.waiver.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-safety-eval-gates-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-M2 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.safM2Satisfied}; report=imports/${PLUGIN_ID}/ai-safety-eval-gates-report.json`,
      nodes,
    };
  },
};
