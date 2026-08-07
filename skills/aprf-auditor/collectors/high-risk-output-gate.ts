/**
 * high-risk-output-gate — SEC-M2 / repo-high-risk-output-gate.
 *
 * Discovers high-risk side-effect path inventories, output schema/policy
 * filters, and contract tests. Import
 * highRiskSideEffectPathInventoryComplete=true +
 * highRiskPathsRejectingNonConformingOutputPct=100 under
 * imports/high-risk-output-gate/ to unlock PASS (measuredAt ≤90d).
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "high-risk-output-gate";
const RELATED = ["SEC-M2"] as const;
const DETECTOR_ID = "repo-high-risk-output-gate";
const IMPORT_MAX_AGE_DAYS = 90;

const SCHEMA_RE =
  /\b(output[_-]?schema|response[_-]?schema|structured[_-]?output|json[_-]?schema|zod\.|pydantic|model[_-]?output[_-]?(valid|schema)|schema[_-]?validat)/i;

const POLICY_RE =
  /\b(policy[_-]?filter|output[_-]?filter|before[_-]?side[_-]?effect|guardrail.*output|validate.*before.*(write|execute|side[_-]?effect)|reject[_-]?non[_-]?conform)/i;

const CONTRACT_RE =
  /\b(contract[_-]?test|schema[_-]?contract|output[_-]?validation[_-]?test|non[_-]?conform(ing)?[_-]?(output|fixture)|high[_-]?risk[_-]?(path|output)[_-]?test)/i;

const INVENTORY_RE =
  /\b(high[_-]?risk[_-]?(side[_-]?)?effect[_-]?path|impact[_-]?tier|side[_-]?effect[_-]?path[_-]?inventor|write[_-]?irreversible|financial[_-]?path)/i;

export interface HighRiskOutputGateReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    schema: { found: boolean; refs: string[] };
    policy: { found: boolean; refs: string[] };
    contract: { found: boolean; refs: string[] };
    inventory: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    highRiskSideEffectPathsPresent: boolean | null;
    highRiskSideEffectPathInventoryComplete: boolean | null;
    highRiskPathsRejectingNonConformingOutputPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secM2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
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
): HighRiskOutputGateReport["importedResults"] {
  const sources: string[] = [];
  let highRiskSideEffectPathsPresent: boolean | null = null;
  let highRiskSideEffectPathInventoryComplete: boolean | null = null;
  let highRiskPathsRejectingNonConformingOutputPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/high-risk-output-gate-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      highRiskSideEffectPathsPresent =
        asBool(data.highRiskSideEffectPathsPresent) ??
        asBool(data.high_risk_side_effect_paths_present) ??
        asBool(data.hasHighRiskSideEffectPaths) ??
        highRiskSideEffectPathsPresent;
      highRiskSideEffectPathInventoryComplete =
        asBool(data.highRiskSideEffectPathInventoryComplete) ??
        asBool(data.high_risk_side_effect_path_inventory_complete) ??
        asBool(data.coverageInventoryComplete) ??
        asBool(data.inventoryComplete) ??
        highRiskSideEffectPathInventoryComplete;
      highRiskPathsRejectingNonConformingOutputPct =
        asNum(data.highRiskPathsRejectingNonConformingOutputPct) ??
        asNum(data.high_risk_paths_rejecting_non_conforming_output_pct) ??
        asNum(data.contractTestsRejectNonConformingPct) ??
        asNum(data.rejectNonConformingPct) ??
        highRiskPathsRejectingNonConformingOutputPct;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    highRiskSideEffectPathsPresent,
    highRiskSideEffectPathInventoryComplete,
    highRiskPathsRejectingNonConformingOutputPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildHighRiskOutputGateReport(opts: {
  assessedAt: string;
  schema: { found: boolean; refs: string[] };
  policy: { found: boolean; refs: string[] };
  contract: { found: boolean; refs: string[] };
  inventory: { found: boolean; refs: string[] };
  imported: HighRiskOutputGateReport["importedResults"];
}): HighRiskOutputGateReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.schema.found ||
    opts.policy.found ||
    opts.contract.found ||
    opts.inventory.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No high-risk output gate signals — SEC-M2 remains not demonstrated until inventory/contract evidence or an explicit N/A attest (highRiskSideEffectPathsPresent=false) is imported.",
    );
  }
  if (opts.schema.found) {
    notes.push(`Schema refs: ${opts.schema.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.policy.found) {
    notes.push(`Policy-filter refs: ${opts.policy.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.contract.found) {
    notes.push(`Contract-test refs: ${opts.contract.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.inventory.found) {
    notes.push(`Inventory refs: ${opts.inventory.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (inventoryComplete=${opts.imported.highRiskSideEffectPathInventoryComplete}, rejectPct=${opts.imported.highRiskPathsRejectingNonConformingOutputPct}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import highRiskSideEffectPathInventoryComplete=true + highRiskPathsRejectingNonConformingOutputPct=100 (measuredAt ≤90d) under imports/high-risk-output-gate/ to PASS. Set highRiskSideEffectPathsPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const inventoryOk =
    opts.imported.highRiskSideEffectPathInventoryComplete === true;
  const rejectOk =
    opts.imported.highRiskPathsRejectingNonConformingOutputPct === 100;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const scopeAbsent = opts.imported.highRiskSideEffectPathsPresent === false;

  let statusHint: HighRiskOutputGateReport["summary"]["statusHint"];
  let secM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.highRiskSideEffectPathInventoryComplete === false ||
      (opts.imported.highRiskPathsRejectingNonConformingOutputPct !== null &&
        opts.imported.highRiskPathsRejectingNonConformingOutputPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    secM2Satisfied = null;
    notes.push(
      "Imported highRiskSideEffectPathsPresent=false — SEC-M2 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    secM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secM2Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete inventory, reject coverage <100%, or attest older than 90 days — SEC-M2 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    inventoryOk &&
    rejectOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secM2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secM2Satisfied = false;
    if (opts.imported.found && !inventoryOk) {
      notes.push(
        "Import must show highRiskSideEffectPathInventoryComplete=true.",
      );
    }
    if (opts.imported.found && !rejectOk) {
      notes.push(
        "Import must show highRiskPathsRejectingNonConformingOutputPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      schema: opts.schema,
      policy: opts.policy,
      contract: opts.contract,
      inventory: opts.inventory,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const highRiskOutputGateCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const schemaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCHEMA_RE.test(path) || SCHEMA_RE.test(text),
      10,
    );
    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => POLICY_RE.test(path) || POLICY_RE.test(text),
      10,
    );
    const contractRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CONTRACT_RE.test(path) || CONTRACT_RE.test(text),
      10,
    );
    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INVENTORY_RE.test(path) || INVENTORY_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildHighRiskOutputGateReport({
      assessedAt: ctx.assessedAt.toISOString(),
      schema: { found: schemaRefs.length > 0, refs: schemaRefs },
      policy: { found: policyRefs.length > 0, refs: policyRefs },
      contract: { found: contractRefs.length > 0, refs: contractRefs },
      inventory: { found: inventoryRefs.length > 0, refs: inventoryRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "high-risk-output-gate-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/high-risk-output-gate-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "high-risk-output-gate",
          "sec-m2",
          DETECTOR_ID,
          ...(report.summary.secM2Satisfied ? ["sec-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.schema.refs,
        ...report.signals.policy.refs,
        ...report.signals.contract.refs,
        ...report.signals.inventory.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["high-risk-output-gate-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-M2 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secM2Satisfied}; report=imports/${PLUGIN_ID}/high-risk-output-gate-report.json`,
      nodes,
    };
  },
};
