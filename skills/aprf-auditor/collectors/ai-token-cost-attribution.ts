/**
 * ai-token-cost-attribution — OBS-R4 / repo-ai-token-cost-attribution.
 *
 * Discovers token/cost metrics with request+feature+tenant labels.
 * Import attributedBilledCallPct≥95 + sampleWindowHours≥24 +
 * coversRequestFeatureTenant under imports/ai-token-cost-attribution/
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

const PLUGIN_ID = "ai-token-cost-attribution";
const RELATED = ["OBS-R4"] as const;
const DETECTOR_ID = "repo-ai-token-cost-attribution";
const IMPORT_MAX_AGE_DAYS = 90;
const ATTR_PCT_MIN = 95;
const SAMPLE_WINDOW_HOURS_MIN = 24;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const TOKEN_COST_RE =
  /\b(token[\s_-]*(usage|cost|metric)|cost[\s_-]*per[\s_-]*(request|call)|billed[\s_-]*model|model[\s_-]*spend|finops[\s_-]*label)\b/i;

const REQUEST_LABEL_RE =
  /\b(request[\s_-]*id|trace[\s_-]*id|correlation[\s_-]*id|req[\s_-]*id)\b/i;

const FEATURE_LABEL_RE =
  /\b(feature[\s_-]*(id|name|key|label)|product[\s_-]*feature|use[\s_-]*case)\b/i;

const TENANT_LABEL_RE =
  /\b(tenant[\s_-]*(id|key|label)|customer[\s_-]*id|org[\s_-]*id|account[\s_-]*id)\b/i;

export interface AiTokenCostAttributionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    tokenCost: { found: boolean; refs: string[] };
    requestLabel: { found: boolean; refs: string[] };
    featureLabel: { found: boolean; refs: string[] };
    tenantLabel: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    attributedBilledCallPct: number | null;
    sampleWindowHours: number | null;
    coversRequestFeatureTenant: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    attributionSignalsPresent: boolean;
    obsR4Satisfied: boolean | null;
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
      ".ts",
      ".js",
      ".py",
      ".go",
      ".yml",
      ".yaml",
      ".json",
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

function loadImported(
  ctx: CollectorContext,
): AiTokenCostAttributionReport["importedResults"] {
  const sources: string[] = [];
  let attributedBilledCallPct: number | null = null;
  let sampleWindowHours: number | null = null;
  let coversRequestFeatureTenant: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-token-cost-attribution-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      attributedBilledCallPct =
        asNum(data.attributedBilledCallPct) ??
        asNum(data.attributed_billed_call_pct) ??
        asNum(data.attributionPct) ??
        attributedBilledCallPct;
      sampleWindowHours =
        asNum(data.sampleWindowHours) ??
        asNum(data.sample_window_hours) ??
        sampleWindowHours;
      coversRequestFeatureTenant =
        asBool(data.coversRequestFeatureTenant) ??
        asBool(data.covers_request_feature_tenant) ??
        asBool(data.hasRequestFeatureTenantLabels) ??
        coversRequestFeatureTenant;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    attributedBilledCallPct,
    sampleWindowHours,
    coversRequestFeatureTenant,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTokenCostAttributionReport(opts: {
  assessedAt: string;
  tokenCost: { found: boolean; refs: string[] };
  requestLabel: { found: boolean; refs: string[] };
  featureLabel: { found: boolean; refs: string[] };
  tenantLabel: { found: boolean; refs: string[] };
  imported: AiTokenCostAttributionReport["importedResults"];
}): AiTokenCostAttributionReport {
  const notes: string[] = [];
  const attributionSignalsPresent =
    opts.tokenCost.found ||
    opts.requestLabel.found ||
    opts.featureLabel.found ||
    opts.tenantLabel.found;

  if (!attributionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No token/cost attribution signals — OBS-R4 may be NOT_APPLICABLE if no billed model calls are in scope.",
    );
  }
  if (opts.tokenCost.found) {
    notes.push(`Token/cost refs: ${opts.tokenCost.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.requestLabel.found) {
    notes.push(
      `Request-label refs: ${opts.requestLabel.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.featureLabel.found) {
    notes.push(
      `Feature-label refs: ${opts.featureLabel.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.tenantLabel.found) {
    notes.push(
      `Tenant-label refs: ${opts.tenantLabel.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (attrPct=${opts.imported.attributedBilledCallPct}, windowH=${opts.imported.sampleWindowHours}, covers=${opts.imported.coversRequestFeatureTenant})`,
    );
  } else if (attributionSignalsPresent) {
    notes.push(
      "Attribution signals alone are PARTIAL — import attributedBilledCallPct≥95 + sampleWindowHours≥24 + coversRequestFeatureTenant=true (measuredAt ≤90d) under imports/ai-token-cost-attribution/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const pctOk =
    opts.imported.attributedBilledCallPct !== null &&
    opts.imported.attributedBilledCallPct >= ATTR_PCT_MIN;
  const windowOk =
    opts.imported.sampleWindowHours !== null &&
    opts.imported.sampleWindowHours >= SAMPLE_WINDOW_HOURS_MIN;
  const coversOk = opts.imported.coversRequestFeatureTenant === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiTokenCostAttributionReport["summary"]["statusHint"];
  let obsR4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((typeof opts.imported.attributedBilledCallPct === "number" &&
      opts.imported.attributedBilledCallPct < ATTR_PCT_MIN) ||
      (typeof opts.imported.sampleWindowHours === "number" &&
        opts.imported.sampleWindowHours < SAMPLE_WINDOW_HOURS_MIN) ||
      opts.imported.coversRequestFeatureTenant === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!attributionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsR4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsR4Satisfied = false;
    notes.push(
      "Imported evidence shows attributedBilledCallPct<95, sample window <24h, missing request/feature/tenant coverage, or evidence older than 90 days — OBS-R4 fail.",
    );
  } else if (
    (attributionSignalsPresent || opts.imported.found) &&
    pctOk &&
    windowOk &&
    coversOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsR4Satisfied = true;
  } else if (attributionSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsR4Satisfied = false;
    if (opts.imported.found && !pctOk) {
      notes.push("Import must show attributedBilledCallPct≥95.");
    }
    if (opts.imported.found && !windowOk) {
      notes.push("Import must show sampleWindowHours≥24.");
    }
    if (opts.imported.found && !coversOk) {
      notes.push("Import must show coversRequestFeatureTenant=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock OBS-R4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      tokenCost: opts.tokenCost,
      requestLabel: opts.requestLabel,
      featureLabel: opts.featureLabel,
      tenantLabel: opts.tenantLabel,
    },
    importedResults: opts.imported,
    summary: {
      attributionSignalsPresent,
      obsR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiTokenCostAttributionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const tokenCost = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TOKEN_COST_RE.test(path) || TOKEN_COST_RE.test(text),
      10,
    );
    const requestLabel = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (REQUEST_LABEL_RE.test(path) || REQUEST_LABEL_RE.test(text)) &&
        (TOKEN_COST_RE.test(path + text) || /metric|label|attribute/i.test(path + text)),
      8,
    );
    const featureLabel = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FEATURE_LABEL_RE.test(path) || FEATURE_LABEL_RE.test(text),
      8,
    );
    const tenantLabel = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TENANT_LABEL_RE.test(path) || TENANT_LABEL_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiTokenCostAttributionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      tokenCost: { found: tokenCost.length > 0, refs: tokenCost },
      requestLabel: { found: requestLabel.length > 0, refs: requestLabel },
      featureLabel: { found: featureLabel.length > 0, refs: featureLabel },
      tenantLabel: { found: tenantLabel.length > 0, refs: tenantLabel },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-token-cost-attribution-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-token-cost-attribution-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-token-cost-attribution",
          "obs-r4",
          DETECTOR_ID,
          ...(report.summary.obsR4Satisfied ? ["obs-r4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.tokenCost.refs,
        ...report.signals.requestLabel.refs,
        ...report.signals.featureLabel.refs,
        ...report.signals.tenantLabel.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-token-cost-attribution-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-R4 status=${report.summary.statusHint} signals=${report.summary.attributionSignalsPresent} satisfied=${report.summary.obsR4Satisfied}; report=imports/${PLUGIN_ID}/ai-token-cost-attribution-report.json`,
      nodes,
    };
  },
};
