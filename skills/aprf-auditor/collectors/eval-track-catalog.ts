/**
 * eval-track-catalog — EVL-R1 / repo-eval-track-catalog.
 *
 * Discovers separate regression / adversarial / distribution-shift eval tracks.
 * Import missingTracks=0 + missingOwners=0 + tracksNotRunOnLastPromotion=0
 * under imports/eval-track-catalog/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "eval-track-catalog";
const RELATED = ["EVL-R1"] as const;
const DETECTOR_ID = "repo-eval-track-catalog";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const EVAL_PATH_RE =
  /(eval|evals|promptfoo|benchmark|golden|test[_-]?set|corpus)/i;

const REGRESSION_RE =
  /\b(regression[\s_-]*(track|suite|eval|corpus|set)|eval[\s_-]*regression)\b/i;

const ADVERSARIAL_RE =
  /\b(adversarial[\s_-]*(track|suite|eval|corpus|set|attack)|red[\s_-]*team|jailbreak[\s_-]*(suite|eval|set))\b/i;

const DISTRIBUTION_RE =
  /\b(distribution[\s_-]*shift|dist[\s_-]*shift|ood|out[\s_-]*of[\s_-]*distrib|drift[\s_-]*(eval|suite|track|corpus))\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|track[\s_-]*owner|maintainer|raci)\b/i;

export interface EvalTrackCatalogReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    regression: { found: boolean; refs: string[] };
    adversarial: { found: boolean; refs: string[] };
    distributionShift: { found: boolean; refs: string[] };
    owners: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    missingTracks: number | null;
    missingOwners: number | null;
    tracksNotRunOnLastPromotion: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    evalSignalsPresent: boolean;
    trackSignalsPresent: boolean;
    evlR1Satisfied: boolean | null;
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

function detectEvalSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        EVAL_PATH_RE.test(path) ||
        /\b(promptfoo|openai|anthropic|llm|eval[\s_-]*suite)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): EvalTrackCatalogReport["importedResults"] {
  const sources: string[] = [];
  let missingTracks: number | null = null;
  let missingOwners: number | null = null;
  let tracksNotRunOnLastPromotion: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/eval-track-catalog-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      missingTracks =
        asNum(data.missingTracks) ??
        asNum(data.missing_tracks) ??
        missingTracks;
      missingOwners =
        asNum(data.missingOwners) ??
        asNum(data.missing_owners) ??
        missingOwners;
      tracksNotRunOnLastPromotion =
        asNum(data.tracksNotRunOnLastPromotion) ??
        asNum(data.tracks_not_run_on_last_promotion) ??
        tracksNotRunOnLastPromotion;

      if (asBool(data.allThreeTracksPresent) === true && missingTracks === null) {
        missingTracks = 0;
      }
      if (asBool(data.eachTrackHasOwner) === true && missingOwners === null) {
        missingOwners = 0;
      }
      if (
        asBool(data.allTracksRanOnLastPromotion) === true &&
        tracksNotRunOnLastPromotion === null
      ) {
        tracksNotRunOnLastPromotion = 0;
      }
      if (
        asBool(data.coversAllThreeTracks) === true &&
        missingTracks === null &&
        missingOwners === null &&
        tracksNotRunOnLastPromotion === null
      ) {
        missingTracks = 0;
        missingOwners = 0;
        tracksNotRunOnLastPromotion = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    missingTracks,
    missingOwners,
    tracksNotRunOnLastPromotion,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildEvalTrackCatalogReport(opts: {
  assessedAt: string;
  regression: { found: boolean; refs: string[] };
  adversarial: { found: boolean; refs: string[] };
  distributionShift: { found: boolean; refs: string[] };
  owners: { found: boolean; refs: string[] };
  evalSignals: boolean;
  imported: EvalTrackCatalogReport["importedResults"];
}): EvalTrackCatalogReport {
  const notes: string[] = [];
  const trackSignalsPresent =
    opts.regression.found ||
    opts.adversarial.found ||
    opts.distributionShift.found;

  if (!opts.evalSignals && !trackSignalsPresent && !opts.imported.found) {
    notes.push(
      "No eval/track signals — EVL-R1 may be NOT_APPLICABLE if there are no production AI promotions.",
    );
  }
  if (opts.regression.found) {
    notes.push(`Regression refs: ${opts.regression.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No regression-track signals found.");
  }
  if (opts.adversarial.found) {
    notes.push(
      `Adversarial refs: ${opts.adversarial.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No adversarial-track signals found.");
  }
  if (opts.distributionShift.found) {
    notes.push(
      `Distribution-shift refs: ${opts.distributionShift.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No distribution-shift track signals found.");
  }
  if (opts.owners.found) {
    notes.push(`Owner refs: ${opts.owners.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingTracks=${opts.imported.missingTracks}, missingOwners=${opts.imported.missingOwners}, notRun=${opts.imported.tracksNotRunOnLastPromotion})`,
    );
  } else if (trackSignalsPresent) {
    notes.push(
      "Track signals alone are PARTIAL — import missingTracks=0, missingOwners=0, tracksNotRunOnLastPromotion=0 (measuredAt ≤90d) under imports/eval-track-catalog/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const tracksOk =
    opts.imported.missingTracks !== null && opts.imported.missingTracks === 0;
  const ownersOk =
    opts.imported.missingOwners !== null && opts.imported.missingOwners === 0;
  const runsOk =
    opts.imported.tracksNotRunOnLastPromotion !== null &&
    opts.imported.tracksNotRunOnLastPromotion === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: EvalTrackCatalogReport["summary"]["statusHint"] =
    "not_demonstrated";
  let evlR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.missingTracks !== null &&
      opts.imported.missingTracks > 0) ||
      (opts.imported.missingOwners !== null &&
        opts.imported.missingOwners > 0) ||
      (opts.imported.tracksNotRunOnLastPromotion !== null &&
        opts.imported.tracksNotRunOnLastPromotion > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.evalSignals && !trackSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    evlR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    evlR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing tracks/owners, tracks not run on last promotion, or evidence older than 90 days — EVL-R1 fail.",
    );
  } else if (
    (trackSignalsPresent || opts.imported.found) &&
    tracksOk &&
    ownersOk &&
    runsOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    evlR1Satisfied = true;
  } else if (trackSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    evlR1Satisfied = false;
    if (opts.imported.found && !tracksOk) {
      notes.push("Import must show missingTracks=0 (all three tracks present).");
    }
    if (opts.imported.found && !ownersOk) {
      notes.push("Import must show missingOwners=0.");
    }
    if (opts.imported.found && !runsOk) {
      notes.push("Import must show tracksNotRunOnLastPromotion=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EVL-R1 PASS.",
      );
    }
  } else if (opts.evalSignals) {
    statusHint = "not_demonstrated";
    evlR1Satisfied = null;
    notes.push(
      "Eval signals present but no separate regression/adversarial/distribution-shift track evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    evlR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      regression: opts.regression,
      adversarial: opts.adversarial,
      distributionShift: opts.distributionShift,
      owners: opts.owners,
    },
    importedResults: opts.imported,
    summary: {
      evalSignalsPresent: opts.evalSignals,
      trackSignalsPresent,
      evlR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const evalTrackCatalogCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const evalSignals = detectEvalSignals(ctx.targetPath, maxFiles);

    const regressionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REGRESSION_RE.test(path) || REGRESSION_RE.test(text),
      12,
    );
    const adversarialRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ADVERSARIAL_RE.test(path) || ADVERSARIAL_RE.test(text),
      12,
    );
    const distributionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DISTRIBUTION_RE.test(path) || DISTRIBUTION_RE.test(text),
      12,
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (REGRESSION_RE.test(text) ||
          ADVERSARIAL_RE.test(text) ||
          DISTRIBUTION_RE.test(text) ||
          EVAL_PATH_RE.test(path)) &&
        OWNER_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildEvalTrackCatalogReport({
      assessedAt: ctx.assessedAt.toISOString(),
      regression: { found: regressionRefs.length > 0, refs: regressionRefs },
      adversarial: { found: adversarialRefs.length > 0, refs: adversarialRefs },
      distributionShift: {
        found: distributionRefs.length > 0,
        refs: distributionRefs,
      },
      owners: { found: ownerRefs.length > 0, refs: ownerRefs },
      evalSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "eval-track-catalog-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/eval-track-catalog-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "eval-track-catalog",
          "evl-r1",
          DETECTOR_ID,
          ...(report.summary.evlR1Satisfied ? ["evl-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.regression.refs,
        ...report.signals.adversarial.refs,
        ...report.signals.distributionShift.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["eval-track-catalog-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EVL-R1 status=${report.summary.statusHint} tracks=${report.summary.trackSignalsPresent} satisfied=${report.summary.evlR1Satisfied}; report=imports/${PLUGIN_ID}/eval-track-catalog-report.json`,
      nodes,
    };
  },
};
