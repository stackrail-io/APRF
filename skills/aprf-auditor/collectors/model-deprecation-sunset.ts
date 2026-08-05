/**
 * model-deprecation-sunset — MOD-R1 / repo-model-deprecation-sunset.
 *
 * Discovers deprecation/sunset policy and registry sunset dates.
 * Import policyDefinesNoticeAndForcedSunset + supersededWithSunsetDateCount≥1
 * + undocumentedPinsPastSunset=0 under imports/model-deprecation-sunset/
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

const PLUGIN_ID = "model-deprecation-sunset";
const RELATED = ["MOD-R1"] as const;
const DETECTOR_ID = "repo-model-deprecation-sunset";
const IMPORT_MAX_AGE_DAYS = 90;

const MODEL_PATH_RE =
  /(model|llm|embedding|openai|anthropic|bedrock|vertex|provider|inference)/i;

const POLICY_RE =
  /\b(deprecat\w*|sunset\w*|end[\s_-]*of[\s_-]*life|eol|forced[\s_-]*sunset|notice[\s_-]*period)\b/i;

const NOTICE_RE =
  /\b(notice[\s_-]*period|deprecat\w*[\s_-]*notice|advance[\s_-]*notice|n[\s_-]*day[\s_-]*notice)\b/i;

const FORCED_RE =
  /\b(forced[\s_-]*sunset|hard[\s_-]*stop|force[\s_-]*retire|mandatory[\s_-]*sunset|block[\s_-]*after[\s_-]*sunset)\b/i;

const SUNSET_DATE_RE =
  /\b(sunset[\s_-]*date|deprecat\w*[\s_-]*date|eol[\s_-]*date|retire[\s_-]*by|superseded)\b/i;

export interface ModelDeprecationSunsetReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    policy: { found: boolean; refs: string[] };
    notice: { found: boolean; refs: string[] };
    forcedSunset: { found: boolean; refs: string[] };
    sunsetDates: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    policyDefinesNoticeAndForcedSunset: boolean | null;
    supersededWithSunsetDateCount: number | null;
    undocumentedPinsPastSunset: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    deprecationSignalsPresent: boolean;
    modR1Satisfied: boolean | null;
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
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectModelSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        MODEL_PATH_RE.test(path) ||
        /\b(openai|anthropic|bedrock|vertexai|azure.?openai|embedding|llm)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ModelDeprecationSunsetReport["importedResults"] {
  const sources: string[] = [];
  let policyDefinesNoticeAndForcedSunset: boolean | null = null;
  let supersededWithSunsetDateCount: number | null = null;
  let undocumentedPinsPastSunset: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-deprecation-sunset-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      policyDefinesNoticeAndForcedSunset =
        asBool(data.policyDefinesNoticeAndForcedSunset) ??
        asBool(data.policy_defines_notice_and_forced_sunset) ??
        policyDefinesNoticeAndForcedSunset;
      supersededWithSunsetDateCount =
        asNum(data.supersededWithSunsetDateCount) ??
        asNum(data.superseded_with_sunset_date_count) ??
        supersededWithSunsetDateCount;
      undocumentedPinsPastSunset =
        asNum(data.undocumentedPinsPastSunset) ??
        asNum(data.undocumented_pins_past_sunset) ??
        undocumentedPinsPastSunset;

      if (asBool(data.policyComplete) === true) {
        policyDefinesNoticeAndForcedSunset =
          policyDefinesNoticeAndForcedSunset ?? true;
      }
      if (asBool(data.hasSupersededWithSunsetDate) === true) {
        supersededWithSunsetDateCount =
          supersededWithSunsetDateCount ?? 1;
      }
      if (asBool(data.noUndocumentedPinsPastSunset) === true) {
        undocumentedPinsPastSunset = undocumentedPinsPastSunset ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    policyDefinesNoticeAndForcedSunset,
    supersededWithSunsetDateCount,
    undocumentedPinsPastSunset,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelDeprecationSunsetReport(opts: {
  assessedAt: string;
  policy: { found: boolean; refs: string[] };
  notice: { found: boolean; refs: string[] };
  forcedSunset: { found: boolean; refs: string[] };
  sunsetDates: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelDeprecationSunsetReport["importedResults"];
}): ModelDeprecationSunsetReport {
  const notes: string[] = [];
  const deprecationSignalsPresent =
    opts.policy.found ||
    opts.notice.found ||
    opts.forcedSunset.found ||
    opts.sunsetDates.found;

  if (
    !opts.modelSignals &&
    !deprecationSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No model/deprecation signals — MOD-R1 may be NOT_APPLICABLE if there are no production models/embeddings.",
    );
  }
  if (opts.policy.found) {
    notes.push(`Policy refs: ${opts.policy.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.notice.found) {
    notes.push(`Notice-period refs: ${opts.notice.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.forcedSunset.found) {
    notes.push(
      `Forced-sunset refs: ${opts.forcedSunset.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.sunsetDates.found) {
    notes.push(
      `Sunset-date refs: ${opts.sunsetDates.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (policy=${opts.imported.policyDefinesNoticeAndForcedSunset}, superseded=${opts.imported.supersededWithSunsetDateCount}, pastSunset=${opts.imported.undocumentedPinsPastSunset})`,
    );
  } else if (deprecationSignalsPresent) {
    notes.push(
      "Deprecation signals alone are PARTIAL — import policyDefinesNoticeAndForcedSunset=true, supersededWithSunsetDateCount≥1, undocumentedPinsPastSunset=0 (measuredAt ≤90d) under imports/model-deprecation-sunset/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const policyOk = opts.imported.policyDefinesNoticeAndForcedSunset === true;
  const supersededOk =
    opts.imported.supersededWithSunsetDateCount !== null &&
    opts.imported.supersededWithSunsetDateCount >= 1;
  const pastOk =
    opts.imported.undocumentedPinsPastSunset !== null &&
    opts.imported.undocumentedPinsPastSunset === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelDeprecationSunsetReport["summary"]["statusHint"];
  let modR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.policyDefinesNoticeAndForcedSunset === false ||
      (opts.imported.supersededWithSunsetDateCount !== null &&
        opts.imported.supersededWithSunsetDateCount < 1) ||
      (opts.imported.undocumentedPinsPastSunset !== null &&
        opts.imported.undocumentedPinsPastSunset > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.modelSignals &&
    !deprecationSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    modR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modR1Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete policy, no superseded sunset dates, undocumented post-sunset pins, or evidence older than 90 days — MOD-R1 fail.",
    );
  } else if (
    (deprecationSignalsPresent || opts.imported.found) &&
    policyOk &&
    supersededOk &&
    pastOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modR1Satisfied = true;
  } else if (deprecationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modR1Satisfied = false;
    if (opts.imported.found && !policyOk) {
      notes.push("Import must show policyDefinesNoticeAndForcedSunset=true.");
    }
    if (opts.imported.found && !supersededOk) {
      notes.push("Import must show supersededWithSunsetDateCount≥1.");
    }
    if (opts.imported.found && !pastOk) {
      notes.push("Import must show undocumentedPinsPastSunset=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-R1 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modR1Satisfied = null;
    notes.push(
      "Model signals present but no deprecation/sunset policy or registry sunset evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      policy: opts.policy,
      notice: opts.notice,
      forcedSunset: opts.forcedSunset,
      sunsetDates: opts.sunsetDates,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      deprecationSignalsPresent,
      modR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelDeprecationSunsetCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => POLICY_RE.test(path) || POLICY_RE.test(text),
      12,
    );
    const noticeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => NOTICE_RE.test(path) || NOTICE_RE.test(text),
      12,
    );
    const forcedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FORCED_RE.test(path) || FORCED_RE.test(text),
      12,
    );
    const sunsetDateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SUNSET_DATE_RE.test(path) || SUNSET_DATE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelDeprecationSunsetReport({
      assessedAt: ctx.assessedAt.toISOString(),
      policy: { found: policyRefs.length > 0, refs: policyRefs },
      notice: { found: noticeRefs.length > 0, refs: noticeRefs },
      forcedSunset: { found: forcedRefs.length > 0, refs: forcedRefs },
      sunsetDates: { found: sunsetDateRefs.length > 0, refs: sunsetDateRefs },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-deprecation-sunset-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-deprecation-sunset-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-deprecation-sunset",
          "mod-r1",
          DETECTOR_ID,
          ...(report.summary.modR1Satisfied ? ["mod-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.policy.refs,
        ...report.signals.notice.refs,
        ...report.signals.forcedSunset.refs,
        ...report.signals.sunsetDates.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-deprecation-sunset-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-R1 status=${report.summary.statusHint} deprecation=${report.summary.deprecationSignalsPresent} satisfied=${report.summary.modR1Satisfied}; report=imports/${PLUGIN_ID}/model-deprecation-sunset-report.json`,
      nodes,
    };
  },
};
