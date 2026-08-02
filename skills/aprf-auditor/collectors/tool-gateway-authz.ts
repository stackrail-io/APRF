/**
 * tool-gateway-authz — TOL-M1 / repo-tool-gateway-authz.
 *
 * Discovers tool-gateway / tool-runtime authz and deny-suite signals.
 * Import coverage under imports/tool-gateway-authz/ unlocks PASS
 * (measuredAt ≤90d).
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import { ensureDir, listImportFiles, readText, redact } from "./lib/fs.ts";
import { asNum, collectRefs } from "./lib/collect-refs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "tool-gateway-authz";
const RELATED = ["TOL-M1"] as const;
const DETECTOR_ID = "repo-tool-gateway-authz";
const IMPORT_MAX_AGE_DAYS = 90;

const GATEWAY_AUTHZ_RE =
  /\b(tool[_-]?(gateway|runtime)|tool[_-]?authz|tool[_-]?authorization|server[_-]?side[_-]?authz)\b/i;
const DENY_SUITE_RE =
  /\b(deny[_-]?(suite|test|log)s?|unauthorized[_-]?tool|forged[_-]?authz|missing[_-]?authz|model[_-]?output.{0,40}bypass)\b/i;

export interface ToolGatewayAuthzReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    gatewayAuthz: { found: boolean; refs: string[] };
    denySuite: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionToolsOrAgentsPresent: boolean | null;
    unauthorizedToolCallsDeniedPct: number | null;
    modelOutputAloneCannotBypassGateway: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    surfaceProvedForNaOverride: boolean;
    tolM1Satisfied: boolean | null;
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

function loadImported(
  ctx: CollectorContext,
): ToolGatewayAuthzReport["importedResults"] {
  const sources: string[] = [];
  let productionToolsOrAgentsPresent: boolean | null = null;
  let unauthorizedToolCallsDeniedPct: number | null = null;
  let modelOutputAloneCannotBypassGateway: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/tool-gateway-authz-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionToolsOrAgentsPresent = mergeOrBool(
        productionToolsOrAgentsPresent,
        asBool(data.productionToolsOrAgentsPresent) ??
          asBool(data.production_tools_or_agents_present),
      );
      unauthorizedToolCallsDeniedPct = mergeMinNum(
        unauthorizedToolCallsDeniedPct,
        asNum(data.unauthorizedToolCallsDeniedPct) ??
          asNum(data.unauthorized_tool_calls_denied_pct),
      );
      modelOutputAloneCannotBypassGateway = mergeAndBool(
        modelOutputAloneCannotBypassGateway,
        asBool(data.modelOutputAloneCannotBypassGateway) ??
          asBool(data.model_output_alone_cannot_bypass_gateway),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionToolsOrAgentsPresent,
    unauthorizedToolCallsDeniedPct,
    modelOutputAloneCannotBypassGateway,
    measuredAt,
    sources,
  };
}

export function buildToolGatewayAuthzReport(opts: {
  assessedAt: string;
  gatewayAuthz: { found: boolean; refs: string[] };
  denySuite: { found: boolean; refs: string[] };
  imported: ToolGatewayAuthzReport["importedResults"];
}): ToolGatewayAuthzReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.gatewayAuthz.found || opts.denySuite.found;
  const surfaceProvedForNaOverride =
    opts.gatewayAuthz.found || opts.denySuite.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No tool-gateway authz signals — TOL-M1 remains not demonstrated until deny coverage or productionToolsOrAgentsPresent=false is imported.",
    );
  }
  if (opts.gatewayAuthz.found) {
    notes.push(
      `Gateway/authz refs: ${opts.gatewayAuthz.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.denySuite.found) {
    notes.push(`Deny-suite refs: ${opts.denySuite.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (present=${opts.imported.productionToolsOrAgentsPresent}, deniedPct=${opts.imported.unauthorizedToolCallsDeniedPct}, noBypass=${opts.imported.modelOutputAloneCannotBypassGateway}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import unauthorizedToolCallsDeniedPct=100 + modelOutputAloneCannotBypassGateway=true (measuredAt ≤90d) under imports/tool-gateway-authz/ to PASS.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const surfacePresent =
    surfaceProvedForNaOverride ||
    opts.imported.productionToolsOrAgentsPresent === true;
  const denyOk = opts.imported.unauthorizedToolCallsDeniedPct === 100;
  const bypassOk = opts.imported.modelOutputAloneCannotBypassGateway === true;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionToolsOrAgentsPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    (opts.imported.unauthorizedToolCallsDeniedPct !== null &&
      opts.imported.unauthorizedToolCallsDeniedPct < 100) ||
    opts.imported.modelOutputAloneCannotBypassGateway === false;
  const explicitFail = opts.imported.found && contradictingFail;

  let statusHint: ToolGatewayAuthzReport["summary"]["statusHint"];
  let tolM1Satisfied: boolean | null = null;

  if (explicitFail) {
    statusHint = "fail";
    tolM1Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete deny coverage or model-output bypass — TOL-M1 fail.",
    );
  } else if (naCandidate) {
    statusHint = "not_applicable";
    tolM1Satisfied = null;
    notes.push(
      "Imported productionToolsOrAgentsPresent=false — TOL-M1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionToolsOrAgentsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionToolsOrAgentsPresent=false ignored — in-repo gateway/deny signals prove the surface exists.",
    );
    if (surfacePresent && denyOk && bypassOk && importFresh && opts.imported.found) {
      statusHint = "pass";
      tolM1Satisfied = true;
    } else {
      statusHint = "partial";
      tolM1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    tolM1Satisfied = null;
  } else if (
    surfacePresent &&
    denyOk &&
    bypassOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    tolM1Satisfied = true;
  } else {
    statusHint = "partial";
    tolM1Satisfied = false;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      gatewayAuthz: opts.gatewayAuthz,
      denySuite: opts.denySuite,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      surfaceProvedForNaOverride,
      tolM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const toolGatewayAuthzCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const gatewayRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => GATEWAY_AUTHZ_RE.test(p) || GATEWAY_AUTHZ_RE.test(t),
      10,
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DENY_SUITE_RE.test(p) || DENY_SUITE_RE.test(t),
      10,
    );

    const report = buildToolGatewayAuthzReport({
      assessedAt: ctx.assessedAt.toISOString(),
      gatewayAuthz: { found: gatewayRefs.length > 0, refs: gatewayRefs },
      denySuite: { found: denyRefs.length > 0, refs: denyRefs },
      imported: loadImported(ctx),
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "tool-gateway-authz-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/tool-gateway-authz-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          PLUGIN_ID,
          "tol-m1",
          DETECTOR_ID,
          ...(report.summary.tolM1Satisfied ? ["tol-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M1 status=${report.summary.statusHint} satisfied=${report.summary.tolM1Satisfied}; report=imports/${PLUGIN_ID}/tool-gateway-authz-report.json`,
      nodes,
    };
  },
};
