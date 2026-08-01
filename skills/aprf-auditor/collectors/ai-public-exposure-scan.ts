/**
 * ai-public-exposure-scan — INF-M1 / repo-ai-public-exposure-scan.
 *
 * Discovers AI data-store / control-plane + edge-auth / CSPM signals.
 * Import coverage under imports/ai-public-exposure-scan/ to unlock PASS
 * (measuredAt ≤90d). Repo signals alone ≠ PASS.
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
  mergeAndBool,
  mergeMaxNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-public-exposure-scan";
const RELATED = ["INF-M1"] as const;
const DETECTOR_ID = "repo-ai-public-exposure-scan";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DATA_STORE_RE =
  /\b(vector[_-]?(db|store|index)|pinecone|weaviate|milvus|qdrant|chroma(db)?|opensearch|elasticsearch|pgvector|redis[_-]?(stack|search)|object[_-]?stor(e|age)|s3[_-]?(bucket|public)|ai[_-]?(data|memory)[_-]?store)\b/i;

const CONTROL_PLANE_RE =
  /\b(control[_-]?plane|admin[_-]?(console|ui|api)|mlflow|kubeflow|langfuse|langsmith[_-]?ui|airflow[_-]?webserver|jupyter[_-]?(hub|lab)|model[_-]?registry[_-]?(ui|api)|orchestrat(or|ion)[_-]?(api|ui))\b/i;

const EDGE_AUTH_RE =
  /\b(edge[_-]?auth|authenticated[_-]?(edge|ingress)|private[_-]?(endpoint|link|service[_-]?connect)|alb[_-]?auth|api[_-]?gateway[_-]?auth|cloudflare[_-]?access|identity[_-]?aware[_-]?proxy|iap\b|public[_-]?access[_-]?block|block[_-]?public[_-]?(access|acls))\b/i;

const CSPM_SCAN_RE =
  /\b(cspm|cloud[_-]?security[_-]?posture|public[_-]?(exposure|reachab)|internet[_-]?facing|exposed[_-]?(endpoint|bucket|database)|network[_-]?scan|port[_-]?scan|attack[_-]?surface)\b/i;

export interface AiPublicExposureScanReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    dataStores: { found: boolean; refs: string[] };
    controlPlanes: { found: boolean; refs: string[] };
    edgeAuth: { found: boolean; refs: string[] };
    cspmScan: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    aiDataStoresOrControlPlanesPresent: boolean | null;
    publiclyReachableUnauthenticatedCount: number | null;
    openHighOrCriticalFindingsUnwaived: number | null;
    authenticatedEdgeControlsConfigured: boolean | null;
    privateOnlyExposureProvenByScan: boolean | null;
    cspmOrNetworkScanPresent: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    infM1Satisfied: boolean | null;
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
): AiPublicExposureScanReport["importedResults"] {
  const sources: string[] = [];
  let aiDataStoresOrControlPlanesPresent: boolean | null = null;
  let publiclyReachableUnauthenticatedCount: number | null = null;
  let openHighOrCriticalFindingsUnwaived: number | null = null;
  let authenticatedEdgeControlsConfigured: boolean | null = null;
  let privateOnlyExposureProvenByScan: boolean | null = null;
  let cspmOrNetworkScanPresent: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-public-exposure-scan-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      aiDataStoresOrControlPlanesPresent = mergeOrBool(
        aiDataStoresOrControlPlanesPresent,
        asBool(data.aiDataStoresOrControlPlanesPresent) ??
          asBool(data.ai_data_stores_or_control_planes_present) ??
          asBool(data.aiDataStoresPresent),
      );
      publiclyReachableUnauthenticatedCount = mergeMaxNum(
        publiclyReachableUnauthenticatedCount,
        asNum(data.publiclyReachableUnauthenticatedCount) ??
          asNum(data.publicly_reachable_unauthenticated_count) ??
          asNum(data.publicUnauthenticatedEndpoints),
      );
      openHighOrCriticalFindingsUnwaived = mergeMaxNum(
        openHighOrCriticalFindingsUnwaived,
        asNum(data.openHighOrCriticalFindingsUnwaived) ??
          asNum(data.open_high_or_critical_findings_unwaived) ??
          asNum(data.openHighFindings),
      );
      authenticatedEdgeControlsConfigured = mergeAndBool(
        authenticatedEdgeControlsConfigured,
        asBool(data.authenticatedEdgeControlsConfigured) ??
          asBool(data.authenticated_edge_controls_configured) ??
          asBool(data.edgeAuthConfigured),
      );
      privateOnlyExposureProvenByScan = mergeAndBool(
        privateOnlyExposureProvenByScan,
        asBool(data.privateOnlyExposureProvenByScan) ??
          asBool(data.private_only_exposure_proven_by_scan) ??
          asBool(data.privateOnlyProvenByScan),
      );
      cspmOrNetworkScanPresent = mergeAndBool(
        cspmOrNetworkScanPresent,
        asBool(data.cspmOrNetworkScanPresent) ??
          asBool(data.cspm_or_network_scan_present) ??
          asBool(data.scanPresent),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    aiDataStoresOrControlPlanesPresent,
    publiclyReachableUnauthenticatedCount,
    openHighOrCriticalFindingsUnwaived,
    authenticatedEdgeControlsConfigured,
    privateOnlyExposureProvenByScan,
    cspmOrNetworkScanPresent,
    measuredAt,
    sources,
  };
}

export function buildAiPublicExposureScanReport(opts: {
  assessedAt: string;
  dataStores: { found: boolean; refs: string[] };
  controlPlanes: { found: boolean; refs: string[] };
  edgeAuth: { found: boolean; refs: string[] };
  cspmScan: { found: boolean; refs: string[] };
  imported: AiPublicExposureScanReport["importedResults"];
}): AiPublicExposureScanReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.dataStores.found ||
    opts.controlPlanes.found ||
    opts.edgeAuth.found ||
    opts.cspmScan.found;
  // Only inventory of stores/control planes proves the INF-M1 surface for N/A
  // override — bare edge-auth / CSPM mentions must not launder present=false.
  const surfaceProvedForNaOverride =
    opts.dataStores.found || opts.controlPlanes.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI public-exposure signals — INF-M1 remains not demonstrated until data-store/control-plane + CSPM/edge-auth evidence or an explicit N/A attest (aiDataStoresOrControlPlanesPresent=false) is imported.",
    );
  }
  if (opts.dataStores.found) {
    notes.push(
      `AI data-store refs: ${opts.dataStores.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.controlPlanes.found) {
    notes.push(
      `Control-plane refs: ${opts.controlPlanes.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.edgeAuth.found) {
    notes.push(
      `Edge-auth / private-exposure refs: ${opts.edgeAuth.refs.slice(0, 3).join(", ")}; code alone does not satisfy INF-M1.`,
    );
  }
  if (opts.cspmScan.found) {
    notes.push(
      `CSPM/scan refs: ${opts.cspmScan.refs.slice(0, 3).join(", ")}; scan docs alone do not satisfy INF-M1.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.aiDataStoresOrControlPlanesPresent}, publicUnauth=${opts.imported.publiclyReachableUnauthenticatedCount}, openHigh=${opts.imported.openHighOrCriticalFindingsUnwaived}, edgeAuth=${opts.imported.authenticatedEdgeControlsConfigured}, privateOnly=${opts.imported.privateOnlyExposureProvenByScan}, scan=${opts.imported.cspmOrNetworkScanPresent}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import inventory (or present=true) plus publiclyReachableUnauthenticatedCount=0 + openHighOrCriticalFindingsUnwaived=0 + (authenticatedEdgeControlsConfigured=true OR privateOnlyExposureProvenByScan=true) + cspmOrNetworkScanPresent=true (measuredAt ≤90d) under imports/ai-public-exposure-scan/ to PASS. Set aiDataStoresOrControlPlanesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.aiDataStoresOrControlPlanesPresent === false &&
    !surfaceProvedForNaOverride;
  const scopePresent =
    opts.imported.aiDataStoresOrControlPlanesPresent === true;
  // PASS requires store/control-plane inventory — edge-auth or CSPM docs alone
  // must not unlock INF-M1 even with perfect import metrics.
  const inventoryPresent =
    opts.dataStores.found || opts.controlPlanes.found || scopePresent;

  const publicOk = opts.imported.publiclyReachableUnauthenticatedCount === 0;
  const findingsOk = opts.imported.openHighOrCriticalFindingsUnwaived === 0;
  const edgeOrPrivateOk =
    opts.imported.authenticatedEdgeControlsConfigured === true ||
    opts.imported.privateOnlyExposureProvenByScan === true;
  const scanOk = opts.imported.cspmOrNetworkScanPresent === true;
  const edgeExplicitlyMissing =
    opts.imported.authenticatedEdgeControlsConfigured === false &&
    opts.imported.privateOnlyExposureProvenByScan !== true;

  let statusHint: AiPublicExposureScanReport["summary"]["statusHint"];
  let infM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported.publiclyReachableUnauthenticatedCount !== null &&
      opts.imported.publiclyReachableUnauthenticatedCount > 0) ||
      (opts.imported.openHighOrCriticalFindingsUnwaived !== null &&
        opts.imported.openHighOrCriticalFindingsUnwaived > 0) ||
      edgeExplicitlyMissing ||
      opts.imported.cspmOrNetworkScanPresent === false);

  if (
    opts.imported.found &&
    opts.imported.aiDataStoresOrControlPlanesPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    infM1Satisfied = null;
    notes.push(
      "Imported aiDataStoresOrControlPlanesPresent=false — INF-M1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.aiDataStoresOrControlPlanesPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported aiDataStoresOrControlPlanesPresent=false ignored — in-repo AI data-store/control-plane inventory proves the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      infM1Satisfied = false;
      notes.push(
        "Imported evidence shows public unauthenticated endpoints, open high findings, missing edge auth/private-only proof, or missing scan — INF-M1 fail.",
      );
    } else if (
      inventoryPresent &&
      publicOk &&
      findingsOk &&
      edgeOrPrivateOk &&
      scanOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      infM1Satisfied = true;
    } else {
      statusHint = "partial";
      infM1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    infM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    infM1Satisfied = false;
    notes.push(
      "Imported evidence shows public unauthenticated endpoints, open high findings, missing edge auth/private-only proof, or missing scan — INF-M1 fail.",
    );
  } else if (
    inventoryPresent &&
    publicOk &&
    findingsOk &&
    edgeOrPrivateOk &&
    scanOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    infM1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    infM1Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires AI data-store/control-plane inventory (in-repo or aiDataStoresOrControlPlanesPresent=true) — edge-auth/CSPM signals alone are insufficient.",
      );
    }
    if (opts.imported.found && !publicOk) {
      notes.push(
        "Import must show publiclyReachableUnauthenticatedCount=0.",
      );
    }
    if (opts.imported.found && !findingsOk) {
      notes.push(
        "Import must show openHighOrCriticalFindingsUnwaived=0.",
      );
    }
    if (opts.imported.found && !edgeOrPrivateOk) {
      notes.push(
        "Import must show authenticatedEdgeControlsConfigured=true or privateOnlyExposureProvenByScan=true.",
      );
    }
    if (opts.imported.found && !scanOk) {
      notes.push("Import must show cspmOrNetworkScanPresent=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INF-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    infM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      dataStores: opts.dataStores,
      controlPlanes: opts.controlPlanes,
      edgeAuth: opts.edgeAuth,
      cspmScan: opts.cspmScan,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      infM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiPublicExposureScanCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const dataStoreRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DATA_STORE_RE.test(path) || DATA_STORE_RE.test(text),
      10,
    );
    const controlPlaneRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CONTROL_PLANE_RE.test(path) || CONTROL_PLANE_RE.test(text),
      10,
    );
    const edgeAuthRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EDGE_AUTH_RE.test(path) || EDGE_AUTH_RE.test(text),
      10,
    );
    const cspmRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CSPM_SCAN_RE.test(path) || CSPM_SCAN_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiPublicExposureScanReport({
      assessedAt: ctx.assessedAt.toISOString(),
      dataStores: { found: dataStoreRefs.length > 0, refs: dataStoreRefs },
      controlPlanes: {
        found: controlPlaneRefs.length > 0,
        refs: controlPlaneRefs,
      },
      edgeAuth: { found: edgeAuthRefs.length > 0, refs: edgeAuthRefs },
      cspmScan: { found: cspmRefs.length > 0, refs: cspmRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-public-exposure-scan-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/ai-public-exposure-scan-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-public-exposure-scan",
          "inf-m1",
          DETECTOR_ID,
          ...(report.summary.infM1Satisfied ? ["inf-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.dataStores.refs,
        ...report.signals.controlPlanes.refs,
        ...report.signals.edgeAuth.refs,
        ...report.signals.cspmScan.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-public-exposure-scan-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INF-M1 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.infM1Satisfied}; report=imports/${PLUGIN_ID}/ai-public-exposure-scan-report.json`,
      nodes,
    };
  },
};
