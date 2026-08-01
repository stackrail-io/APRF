/**
 * ai-jailbreak-harm-redteam — SAF-R2 / repo-ai-jailbreak-harm-redteam.
 *
 * Discovers jailbreak-to-harm red-team suites (distinct from security
 * injection). Import jailbreakToHarmSuiteDistinctFromSecurityInjection +
 * suiteCoversDocumentedHarmCategories +
 * latestRunWithin90DaysMeetsRefusalSafetyThresholds +
 * findingsFeedSafetyBacklogWithOwners under
 * imports/ai-jailbreak-harm-redteam/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-jailbreak-harm-redteam";
const RELATED = ["SAF-R2"] as const;
const DETECTOR_ID = "repo-ai-jailbreak-harm-redteam";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const JAILBREAK_RE =
  /\b(jailbreak[_-]?(to[_-]?)?harm|jailbreak[_-]?(suite|eval|red[_-]?team)|harm[_-]?red[_-]?team|safety[_-]?red[_-]?team|refusal[_-]?red[_-]?team)\b/i;

const SUITE_RE =
  /\b(red[_-]?team[_-]?(suite|corpus|dataset|eval)|adversarial[_-]?(safety|harm)|harm[_-]?(suite|corpus))\b/i;

const THRESHOLD_RE =
  /\b(refusal[_-]?(rate|threshold)|safety[_-]?threshold|pass[_-]?rate|jailbreak[_-]?success[_-]?rate|harm[_-]?score)\b/i;

const BACKLOG_RE =
  /\b(safety[_-]?backlog|finding[_-]?(owner|ticket)|remediation[_-]?owner|jira|linear|github[_-]?issue)\b/i;

export interface AiJailbreakHarmRedteamReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    jailbreak: { found: boolean; refs: string[] };
    suite: { found: boolean; refs: string[] };
    thresholds: { found: boolean; refs: string[] };
    backlog: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    jailbreakToHarmSuiteDistinctFromSecurityInjection: boolean | null;
    suiteCoversDocumentedHarmCategories: boolean | null;
    latestRunWithin90DaysMeetsRefusalSafetyThresholds: boolean | null;
    findingsFeedSafetyBacklogWithOwners: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    redteamSignalsPresent: boolean;
    safR2Satisfied: boolean | null;
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
      ".csv",
      ".py",
      ".ts",
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
): AiJailbreakHarmRedteamReport["importedResults"] {
  const sources: string[] = [];
  let jailbreakToHarmSuiteDistinctFromSecurityInjection: boolean | null =
    null;
  let suiteCoversDocumentedHarmCategories: boolean | null = null;
  let latestRunWithin90DaysMeetsRefusalSafetyThresholds: boolean | null =
    null;
  let findingsFeedSafetyBacklogWithOwners: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-jailbreak-harm-redteam-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      jailbreakToHarmSuiteDistinctFromSecurityInjection =
        asBool(data.jailbreakToHarmSuiteDistinctFromSecurityInjection) ??
        asBool(
          data.jailbreak_to_harm_suite_distinct_from_security_injection,
        ) ??
        asBool(data.suiteDistinctFromSecurityInjection) ??
        asBool(data.distinctFromSecM1) ??
        jailbreakToHarmSuiteDistinctFromSecurityInjection;
      suiteCoversDocumentedHarmCategories =
        asBool(data.suiteCoversDocumentedHarmCategories) ??
        asBool(data.suite_covers_documented_harm_categories) ??
        asBool(data.coversHarmCategories) ??
        suiteCoversDocumentedHarmCategories;
      latestRunWithin90DaysMeetsRefusalSafetyThresholds =
        asBool(data.latestRunWithin90DaysMeetsRefusalSafetyThresholds) ??
        asBool(
          data.latest_run_within_90_days_meets_refusal_safety_thresholds,
        ) ??
        asBool(data.latestRunMeetsThresholds) ??
        latestRunWithin90DaysMeetsRefusalSafetyThresholds;
      findingsFeedSafetyBacklogWithOwners =
        asBool(data.findingsFeedSafetyBacklogWithOwners) ??
        asBool(data.findings_feed_safety_backlog_with_owners) ??
        asBool(data.findingsOwnedInBacklog) ??
        findingsFeedSafetyBacklogWithOwners;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    jailbreakToHarmSuiteDistinctFromSecurityInjection,
    suiteCoversDocumentedHarmCategories,
    latestRunWithin90DaysMeetsRefusalSafetyThresholds,
    findingsFeedSafetyBacklogWithOwners,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiJailbreakHarmRedteamReport(opts: {
  assessedAt: string;
  jailbreak: { found: boolean; refs: string[] };
  suite: { found: boolean; refs: string[] };
  thresholds: { found: boolean; refs: string[] };
  backlog: { found: boolean; refs: string[] };
  imported: AiJailbreakHarmRedteamReport["importedResults"];
}): AiJailbreakHarmRedteamReport {
  const notes: string[] = [];
  const redteamSignalsPresent =
    opts.jailbreak.found ||
    opts.suite.found ||
    opts.thresholds.found ||
    opts.backlog.found;

  if (!redteamSignalsPresent && !opts.imported.found) {
    notes.push(
      "No jailbreak-to-harm red-team signals — SAF-R2 may be NOT_APPLICABLE if there is no production generative AI surface.",
    );
  }
  if (opts.jailbreak.found) {
    notes.push(
      `Jailbreak refs: ${opts.jailbreak.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.suite.found) {
    notes.push(`Suite refs: ${opts.suite.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (distinct=${opts.imported.jailbreakToHarmSuiteDistinctFromSecurityInjection}, categories=${opts.imported.suiteCoversDocumentedHarmCategories}, thresholds=${opts.imported.latestRunWithin90DaysMeetsRefusalSafetyThresholds}, backlog=${opts.imported.findingsFeedSafetyBacklogWithOwners})`,
    );
  } else if (redteamSignalsPresent) {
    notes.push(
      "Red-team signals alone are PARTIAL — import jailbreakToHarmSuiteDistinctFromSecurityInjection=true + suiteCoversDocumentedHarmCategories=true + latestRunWithin90DaysMeetsRefusalSafetyThresholds=true + findingsFeedSafetyBacklogWithOwners=true (measuredAt ≤90d) under imports/ai-jailbreak-harm-redteam/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const distinctOk =
    opts.imported.jailbreakToHarmSuiteDistinctFromSecurityInjection === true;
  const categoriesOk =
    opts.imported.suiteCoversDocumentedHarmCategories === true;
  const runOk =
    opts.imported.latestRunWithin90DaysMeetsRefusalSafetyThresholds === true;
  const backlogOk =
    opts.imported.findingsFeedSafetyBacklogWithOwners === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiJailbreakHarmRedteamReport["summary"]["statusHint"];
  let safR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.jailbreakToHarmSuiteDistinctFromSecurityInjection ===
      false ||
      opts.imported.suiteCoversDocumentedHarmCategories === false ||
      opts.imported.latestRunWithin90DaysMeetsRefusalSafetyThresholds ===
        false ||
      opts.imported.findingsFeedSafetyBacklogWithOwners === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!redteamSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safR2Satisfied = false;
    notes.push(
      "Imported evidence shows suite not distinct from security injection, missing harm-category coverage, stale/failed threshold run, unowned findings, or attest older than 90 days — SAF-R2 fail.",
    );
  } else if (
    (redteamSignalsPresent || opts.imported.found) &&
    distinctOk &&
    categoriesOk &&
    runOk &&
    backlogOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    safR2Satisfied = true;
  } else if (redteamSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safR2Satisfied = false;
    if (opts.imported.found && !distinctOk) {
      notes.push(
        "Import must show jailbreakToHarmSuiteDistinctFromSecurityInjection=true.",
      );
    }
    if (opts.imported.found && !categoriesOk) {
      notes.push(
        "Import must show suiteCoversDocumentedHarmCategories=true.",
      );
    }
    if (opts.imported.found && !runOk) {
      notes.push(
        "Import must show latestRunWithin90DaysMeetsRefusalSafetyThresholds=true.",
      );
    }
    if (opts.imported.found && !backlogOk) {
      notes.push(
        "Import must show findingsFeedSafetyBacklogWithOwners=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      jailbreak: opts.jailbreak,
      suite: opts.suite,
      thresholds: opts.thresholds,
      backlog: opts.backlog,
    },
    importedResults: opts.imported,
    summary: {
      redteamSignalsPresent,
      safR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiJailbreakHarmRedteamCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const jailbreakRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => JAILBREAK_RE.test(path) || JAILBREAK_RE.test(text),
      10,
    );
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
      8,
    );
    const backlogRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BACKLOG_RE.test(path) || BACKLOG_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiJailbreakHarmRedteamReport({
      assessedAt: ctx.assessedAt.toISOString(),
      jailbreak: { found: jailbreakRefs.length > 0, refs: jailbreakRefs },
      suite: { found: suiteRefs.length > 0, refs: suiteRefs },
      thresholds: { found: thresholdRefs.length > 0, refs: thresholdRefs },
      backlog: { found: backlogRefs.length > 0, refs: backlogRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-jailbreak-harm-redteam-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-jailbreak-harm-redteam-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-jailbreak-harm-redteam",
          "saf-r2",
          DETECTOR_ID,
          ...(report.summary.safR2Satisfied ? ["saf-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.jailbreak.refs,
        ...report.signals.suite.refs,
        ...report.signals.thresholds.refs,
        ...report.signals.backlog.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-jailbreak-harm-redteam-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-R2 status=${report.summary.statusHint} signals=${report.summary.redteamSignalsPresent} satisfied=${report.summary.safR2Satisfied}; report=imports/${PLUGIN_ID}/ai-jailbreak-harm-redteam-report.json`,
      nodes,
    };
  },
};
