/**
 * multi-turn-indirect-injection-redteam — SEC-R1 / repo-multi-turn-indirect-injection-redteam.
 *
 * Discovers multi-turn + indirect RAG/MCP injection red-team depth.
 * Import multiTurnInjectionCaseCount≥10 +
 * indirectRagOrMcpInjectionCaseCount≥10 +
 * latestRunWithin90DaysMeetsPassThresholds +
 * reportRetainedAtLeast90Days under
 * imports/multi-turn-indirect-injection-redteam/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "multi-turn-indirect-injection-redteam";
const RELATED = ["SEC-R1"] as const;
const DETECTOR_ID = "repo-multi-turn-indirect-injection-redteam";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_CASES = 10;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MULTI_TURN_RE =
  /\b(multi[_-]?turn|multiturn|conversation(al)?[_-]?(inject|attack|redteam)|turn[_-]?based[_-]?(inject|attack))\b/i;

const INDIRECT_RE =
  /\b(indirect[_-]?(prompt[_-]?)?inject|rag[_-]?(inject|poison)|mcp[_-]?(inject|poison)|retrieved[_-]?(document|content)[_-]?inject|tool[_-]?result[_-]?inject)\b/i;

const REDTEAM_RE =
  /\b(red[_-]?team|adversarial[_-]?(suite|eval|test)|injection[_-]?(suite|corpus|eval))\b/i;

const THRESHOLD_RE =
  /\b(pass[_-]?threshold|score[_-]?threshold|deny[_-]?rate|refusal[_-]?threshold|meets[_-]?threshold)\b/i;

export interface MultiTurnIndirectInjectionRedteamReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    multiTurn: { found: boolean; refs: string[] };
    indirect: { found: boolean; refs: string[] };
    redteam: { found: boolean; refs: string[] };
    threshold: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    multiTurnInjectionCaseCount: number | null;
    indirectRagOrMcpInjectionCaseCount: number | null;
    latestRunWithin90DaysMeetsPassThresholds: boolean | null;
    reportRetainedAtLeast90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secR1Satisfied: boolean | null;
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
): MultiTurnIndirectInjectionRedteamReport["importedResults"] {
  const sources: string[] = [];
  let multiTurnInjectionCaseCount: number | null = null;
  let indirectRagOrMcpInjectionCaseCount: number | null = null;
  let latestRunWithin90DaysMeetsPassThresholds: boolean | null = null;
  let reportRetainedAtLeast90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/multi-turn-indirect-injection-redteam-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      multiTurnInjectionCaseCount =
        asNum(data.multiTurnInjectionCaseCount) ??
        asNum(data.multi_turn_injection_case_count) ??
        asNum(data.multiTurnCases) ??
        multiTurnInjectionCaseCount;
      indirectRagOrMcpInjectionCaseCount =
        asNum(data.indirectRagOrMcpInjectionCaseCount) ??
        asNum(data.indirect_rag_or_mcp_injection_case_count) ??
        asNum(data.indirectRagMcpCases) ??
        asNum(data.indirectCases) ??
        indirectRagOrMcpInjectionCaseCount;
      latestRunWithin90DaysMeetsPassThresholds =
        asBool(data.latestRunWithin90DaysMeetsPassThresholds) ??
        asBool(data.latest_run_within_90_days_meets_pass_thresholds) ??
        asBool(data.latestRunMeetsThresholds) ??
        latestRunWithin90DaysMeetsPassThresholds;
      const retainedBool =
        asBool(data.reportRetainedAtLeast90Days) ??
        asBool(data.report_retained_at_least_90_days) ??
        asBool(data.reportRetained90Days);
      const retentionDays =
        asNum(data.reportRetentionDays) ?? asNum(data.report_retention_days);
      // Numeric retention is authoritative when present (including <90 → false).
      if (retentionDays !== null) {
        reportRetainedAtLeast90Days = retentionDays >= 90;
      } else if (retainedBool !== null) {
        reportRetainedAtLeast90Days = retainedBool;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    multiTurnInjectionCaseCount,
    indirectRagOrMcpInjectionCaseCount,
    latestRunWithin90DaysMeetsPassThresholds,
    reportRetainedAtLeast90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMultiTurnIndirectInjectionRedteamReport(opts: {
  assessedAt: string;
  multiTurn: { found: boolean; refs: string[] };
  indirect: { found: boolean; refs: string[] };
  redteam: { found: boolean; refs: string[] };
  threshold: { found: boolean; refs: string[] };
  imported: MultiTurnIndirectInjectionRedteamReport["importedResults"];
}): MultiTurnIndirectInjectionRedteamReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.multiTurn.found ||
    opts.indirect.found ||
    opts.redteam.found ||
    opts.threshold.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No multi-turn/indirect RAG/MCP red-team signals — SEC-R1 may be NOT_APPLICABLE if there are no multi-turn, RAG, or MCP surfaces.",
    );
  }
  if (opts.multiTurn.found) {
    notes.push(
      `Multi-turn refs: ${opts.multiTurn.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.indirect.found) {
    notes.push(
      `Indirect RAG/MCP refs: ${opts.indirect.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.redteam.found) {
    notes.push(`Red-team refs: ${opts.redteam.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (multiTurn=${opts.imported.multiTurnInjectionCaseCount}, indirect=${opts.imported.indirectRagOrMcpInjectionCaseCount}, thresholdsMet=${opts.imported.latestRunWithin90DaysMeetsPassThresholds}, retained=${opts.imported.reportRetainedAtLeast90Days})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      `Red-team signals alone are PARTIAL — import multiTurnInjectionCaseCount≥${MIN_CASES} + indirectRagOrMcpInjectionCaseCount≥${MIN_CASES} + latestRunWithin90DaysMeetsPassThresholds=true + reportRetainedAtLeast90Days=true (measuredAt ≤90d) under imports/multi-turn-indirect-injection-redteam/ to PASS.`,
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const multiOk =
    opts.imported.multiTurnInjectionCaseCount !== null &&
    opts.imported.multiTurnInjectionCaseCount >= MIN_CASES;
  const indirectOk =
    opts.imported.indirectRagOrMcpInjectionCaseCount !== null &&
    opts.imported.indirectRagOrMcpInjectionCaseCount >= MIN_CASES;
  const thresholdsOk =
    opts.imported.latestRunWithin90DaysMeetsPassThresholds === true;
  const retainedOk = opts.imported.reportRetainedAtLeast90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: MultiTurnIndirectInjectionRedteamReport["summary"]["statusHint"];
  let secR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((opts.imported.multiTurnInjectionCaseCount !== null &&
      opts.imported.multiTurnInjectionCaseCount < MIN_CASES) ||
      (opts.imported.indirectRagOrMcpInjectionCaseCount !== null &&
        opts.imported.indirectRagOrMcpInjectionCaseCount < MIN_CASES) ||
      opts.imported.latestRunWithin90DaysMeetsPassThresholds === false ||
      opts.imported.reportRetainedAtLeast90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    secR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secR1Satisfied = false;
    notes.push(
      `Imported evidence shows case counts <${MIN_CASES}, failed thresholds, missing retention, or attest older than 90 days — SEC-R1 fail.`,
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    multiOk &&
    indirectOk &&
    thresholdsOk &&
    retainedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secR1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secR1Satisfied = false;
    if (opts.imported.found && !multiOk) {
      notes.push(
        `Import must show multiTurnInjectionCaseCount≥${MIN_CASES}.`,
      );
    }
    if (opts.imported.found && !indirectOk) {
      notes.push(
        `Import must show indirectRagOrMcpInjectionCaseCount≥${MIN_CASES}.`,
      );
    }
    if (opts.imported.found && !thresholdsOk) {
      notes.push(
        "Import must show latestRunWithin90DaysMeetsPassThresholds=true.",
      );
    }
    if (opts.imported.found && !retainedOk) {
      notes.push("Import must show reportRetainedAtLeast90Days=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      multiTurn: opts.multiTurn,
      indirect: opts.indirect,
      redteam: opts.redteam,
      threshold: opts.threshold,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const multiTurnIndirectInjectionRedteamCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const multiTurnRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => MULTI_TURN_RE.test(path) || MULTI_TURN_RE.test(text),
      10,
    );
    const indirectRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INDIRECT_RE.test(path) || INDIRECT_RE.test(text),
      10,
    );
    const redteamRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REDTEAM_RE.test(path) || REDTEAM_RE.test(text),
      10,
    );
    const thresholdRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => THRESHOLD_RE.test(path) || THRESHOLD_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildMultiTurnIndirectInjectionRedteamReport({
      assessedAt: ctx.assessedAt.toISOString(),
      multiTurn: { found: multiTurnRefs.length > 0, refs: multiTurnRefs },
      indirect: { found: indirectRefs.length > 0, refs: indirectRefs },
      redteam: { found: redteamRefs.length > 0, refs: redteamRefs },
      threshold: { found: thresholdRefs.length > 0, refs: thresholdRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "multi-turn-indirect-injection-redteam-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/multi-turn-indirect-injection-redteam-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "multi-turn-indirect-injection-redteam",
          "sec-r1",
          DETECTOR_ID,
          ...(report.summary.secR1Satisfied ? ["sec-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.multiTurn.refs,
        ...report.signals.indirect.refs,
        ...report.signals.redteam.refs,
        ...report.signals.threshold.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["multi-turn-indirect-injection-redteam-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-R1 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secR1Satisfied}; report=imports/${PLUGIN_ID}/multi-turn-indirect-injection-redteam-report.json`,
      nodes,
    };
  },
};
