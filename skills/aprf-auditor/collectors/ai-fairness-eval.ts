/**
 * ai-fairness-eval — SAF-M4 / repo-ai-fairness-eval (conditionally mandatory).
 *
 * Discovers high-stakes path inventories + fairness/disparity evals.
 * Import highStakesDecisionPathsPresent=false → NOT_APPLICABLE unlock path,
 * or highStakesDecisionPathsInventoried +
 * latestFairnessEvalWithin90DaysWithThresholdsAndOwners under
 * imports/ai-fairness-eval/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-fairness-eval";
const RELATED = ["SAF-M4"] as const;
const DETECTOR_ID = "repo-ai-fairness-eval";
const IMPORT_MAX_AGE_DAYS = 90;

const FAIRNESS_RE =
  /\b(fairness|disparit(y|ies)|bias[_-]?(eval|test|metric|audit)|equalized[_-]?odds|demographic[_-]?parity|subgroup[_-]?(metric|performance)|slice[_-]?eval)\b/i;

const HIGH_STAKES_RE =
  /\b(high[_-]?stakes|hiring|recruiting|lending|credit[_-]?(scor|decision)|underwriting|insurance[_-]?(decision|quote)|diagnos(is|tic)|triage|criminal[_-]?justice|admissions|government[_-]?benefit|identity[_-]?(verif|proof)|employment[_-]?(scor|performance)|eligibility)\b/i;

const INVENTORY_RE =
  /\b(decision[_-]?path[_-]?inventory|high[_-]?stakes[_-]?(path|decision)|fairness[_-]?scope|in[_-]?scope[_-]?(path|decision))\b/i;

export interface AiFairnessEvalReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    fairness: { found: boolean; refs: string[] };
    highStakes: { found: boolean; refs: string[] };
    inventory: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highStakesDecisionPathsPresent: boolean | null;
    highStakesDecisionPathsInventoried: boolean | null;
    latestFairnessEvalWithin90DaysWithThresholdsAndOwners: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    fairnessSignalsPresent: boolean;
    safM4Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".csv", ".py", ".ts"],
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
): AiFairnessEvalReport["importedResults"] {
  const sources: string[] = [];
  let highStakesDecisionPathsPresent: boolean | null = null;
  let highStakesDecisionPathsInventoried: boolean | null = null;
  let latestFairnessEvalWithin90DaysWithThresholdsAndOwners: boolean | null =
    null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-fairness-eval-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      highStakesDecisionPathsPresent =
        asBool(data.highStakesDecisionPathsPresent) ??
        asBool(data.high_stakes_decision_paths_present) ??
        asBool(data.hasHighStakesPaths) ??
        highStakesDecisionPathsPresent;
      highStakesDecisionPathsInventoried =
        asBool(data.highStakesDecisionPathsInventoried) ??
        asBool(data.high_stakes_decision_paths_inventoried) ??
        asBool(data.pathsInventoried) ??
        highStakesDecisionPathsInventoried;
      latestFairnessEvalWithin90DaysWithThresholdsAndOwners =
        asBool(
          data.latestFairnessEvalWithin90DaysWithThresholdsAndOwners,
        ) ??
        asBool(
          data.latest_fairness_eval_within_90_days_with_thresholds_and_owners,
        ) ??
        asBool(data.latestFairnessEvalFreshWithThresholdsAndOwners) ??
        asBool(data.fairnessEvalComplete) ??
        latestFairnessEvalWithin90DaysWithThresholdsAndOwners;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highStakesDecisionPathsPresent,
    highStakesDecisionPathsInventoried,
    latestFairnessEvalWithin90DaysWithThresholdsAndOwners,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiFairnessEvalReport(opts: {
  assessedAt: string;
  fairness: { found: boolean; refs: string[] };
  highStakes: { found: boolean; refs: string[] };
  inventory: { found: boolean; refs: string[] };
  imported: AiFairnessEvalReport["importedResults"];
}): AiFairnessEvalReport {
  const notes: string[] = [];
  const fairnessSignalsPresent =
    opts.fairness.found || opts.highStakes.found || opts.inventory.found;

  if (!fairnessSignalsPresent && !opts.imported.found) {
    notes.push(
      "No fairness/high-stakes signals — SAF-M4 may be NOT_APPLICABLE if the system does not influence high-stakes decisions (attest highStakesDecisionPathsPresent=false).",
    );
  }
  if (opts.fairness.found) {
    notes.push(`Fairness refs: ${opts.fairness.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.highStakes.found) {
    notes.push(
      `High-stakes refs: ${opts.highStakes.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.inventory.found) {
    notes.push(
      `Inventory refs: ${opts.inventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.highStakesDecisionPathsPresent}, inventoried=${opts.imported.highStakesDecisionPathsInventoried}, evalFresh=${opts.imported.latestFairnessEvalWithin90DaysWithThresholdsAndOwners})`,
    );
  } else if (fairnessSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import highStakesDecisionPathsPresent=false for N/A, or inventoried=true + latestFairnessEvalWithin90DaysWithThresholdsAndOwners=true (measuredAt ≤90d) under imports/ai-fairness-eval/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const explicitNa =
    opts.imported.found &&
    opts.imported.highStakesDecisionPathsPresent === false &&
    importFresh &&
    ageOk;
  const inventoriedOk =
    opts.imported.highStakesDecisionPathsInventoried === true;
  const evalOk =
    opts.imported.latestFairnessEvalWithin90DaysWithThresholdsAndOwners ===
    true;
  const presentTrue = opts.imported.highStakesDecisionPathsPresent === true;

  let statusHint: AiFairnessEvalReport["summary"]["statusHint"];
  let safM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    opts.imported.highStakesDecisionPathsPresent !== false &&
    (opts.imported.highStakesDecisionPathsInventoried === false ||
      opts.imported.latestFairnessEvalWithin90DaysWithThresholdsAndOwners ===
        false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (explicitNa) {
    statusHint = "not_applicable";
    safM4Satisfied = null;
    notes.push(
      "Imported highStakesDecisionPathsPresent=false — SAF-M4 NOT_APPLICABLE (conditionally mandatory).",
    );
  } else if (!fairnessSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safM4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safM4Satisfied = false;
    notes.push(
      "Imported evidence shows high-stakes paths without inventory/fresh fairness eval (thresholds+owners), or attest older than 90 days — SAF-M4 fail.",
    );
  } else if (
    opts.imported.found &&
    presentTrue &&
    inventoriedOk &&
    evalOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    safM4Satisfied = true;
  } else if (fairnessSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safM4Satisfied = false;
    if (opts.imported.found && opts.imported.highStakesDecisionPathsPresent === null) {
      notes.push(
        "Import should set highStakesDecisionPathsPresent true|false to resolve conditional mandatory scope.",
      );
    }
    if (opts.imported.found && presentTrue && !inventoriedOk) {
      notes.push(
        "Import must show highStakesDecisionPathsInventoried=true.",
      );
    }
    if (opts.imported.found && presentTrue && !evalOk) {
      notes.push(
        "Import must show latestFairnessEvalWithin90DaysWithThresholdsAndOwners=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-M4 PASS or N/A.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      fairness: opts.fairness,
      highStakes: opts.highStakes,
      inventory: opts.inventory,
    },
    importedResults: opts.imported,
    summary: {
      fairnessSignalsPresent,
      safM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiFairnessEvalCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const fairnessRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FAIRNESS_RE.test(path) || FAIRNESS_RE.test(text),
      10,
    );
    const highStakesRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => HIGH_STAKES_RE.test(path) || HIGH_STAKES_RE.test(text),
      10,
    );
    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INVENTORY_RE.test(path) || INVENTORY_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiFairnessEvalReport({
      assessedAt: ctx.assessedAt.toISOString(),
      fairness: { found: fairnessRefs.length > 0, refs: fairnessRefs },
      highStakes: { found: highStakesRefs.length > 0, refs: highStakesRefs },
      inventory: { found: inventoryRefs.length > 0, refs: inventoryRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-fairness-eval-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-fairness-eval-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-fairness-eval",
          "saf-m4",
          DETECTOR_ID,
          ...(report.summary.safM4Satisfied ? ["saf-m4-satisfied"] : []),
          ...(report.summary.statusHint === "not_applicable"
            ? ["saf-m4-not-applicable"]
            : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.fairness.refs,
        ...report.signals.highStakes.refs,
        ...report.signals.inventory.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-fairness-eval-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-M4 status=${report.summary.statusHint} signals=${report.summary.fairnessSignalsPresent} satisfied=${report.summary.safM4Satisfied}; report=imports/${PLUGIN_ID}/ai-fairness-eval-report.json`,
      nodes,
    };
  },
};
