/**
 * key-rotation-scope — SEC2-M3 / repo-key-rotation-scope.
 *
 * Discovers provider/cloud key inventory, rotation/scope, and client-bundle
 * scan signals. Import coverage under imports/key-rotation-scope/ unlocks
 * PASS (measuredAt ≤90d). Secrets-manager wiring alone ≠ PASS.
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
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "key-rotation-scope";
const RELATED = ["SEC2-M3"] as const;
const DETECTOR_ID = "repo-key-rotation-scope";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

// No trailing \b — filenames like key_rotation_policy.md / api_key_inventory.yaml
// treat `_` as a word char, so end-boundaries falsely miss path matches.
const KEY_INVENTORY_RE =
  /\b(api[_-]?key[_-]?(inventory|register|catalog)|key[_-]?(inventory|register|catalog)|credential[_-]?(inventory|register)|provider[_-]?key[_-]?(inventory|register)|cloud[_-]?key[_-]?(inventory|register))/i;

const ROTATION_RE =
  /\b(key[_-]?rotation|rotate[_-]?(keys?|credentials?)|rotation[_-]?(policy|schedule|sla|date)|short[_-]?lived[_-]?(credential|key)|temporary[_-]?credentials?|sts[_-]?(assume|token)|workload[_-]?identity)/i;

const SCOPE_RE =
  /\b(least[_-]?privilege|scoped[_-]?(key|credential|token)|iam[_-]?(policy|role)|permission[_-]?boundary|key[_-]?scope|principle[_-]?of[_-]?least[_-]?privilege)/i;

const CLIENT_KEY_RE =
  /\b(client[_-]?(app|bundle|sdk).{0,40}(api[_-]?key|secret|akia)|mobile[_-]?(api[_-]?key|secret)|expo[_-]?public|next_public_.{0,20}(key|secret)|VITE_.{0,20}(key|secret)|REACT_APP_.{0,20}(key|secret)|embedded[_-]?(api[_-]?key|secret))\b/i;

export interface KeyRotationScopeReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    keyInventory: { found: boolean; refs: string[] };
    rotationPolicy: { found: boolean; refs: string[] };
    leastPrivilegeScope: { found: boolean; refs: string[] };
    clientKeyRisk: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionProviderOrCloudKeysPresent: boolean | null;
    privilegedProviderOrCloudKeysInClientApps: number | null;
    productionKeysWithDocumentedLeastPrivilegeScopePct: number | null;
    productionKeysWithinRotationPolicyPct: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    sec2M3Satisfied: boolean | null;
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
      ".tsx",
      ".jsx",
      ".py",
      ".env",
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
): KeyRotationScopeReport["importedResults"] {
  const sources: string[] = [];
  let productionProviderOrCloudKeysPresent: boolean | null = null;
  let privilegedProviderOrCloudKeysInClientApps: number | null = null;
  let productionKeysWithDocumentedLeastPrivilegeScopePct: number | null = null;
  let productionKeysWithinRotationPolicyPct: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/key-rotation-scope-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionProviderOrCloudKeysPresent = mergeOrBool(
        productionProviderOrCloudKeysPresent,
        asBool(data.productionProviderOrCloudKeysPresent) ??
          asBool(data.production_provider_or_cloud_keys_present) ??
          asBool(data.productionKeysPresent),
      );
      privilegedProviderOrCloudKeysInClientApps = mergeMaxNum(
        privilegedProviderOrCloudKeysInClientApps,
        asNum(data.privilegedProviderOrCloudKeysInClientApps) ??
          asNum(data.privileged_provider_or_cloud_keys_in_client_apps) ??
          asNum(data.privilegedKeysInClientApps),
      );
      productionKeysWithDocumentedLeastPrivilegeScopePct = mergeMinNum(
        productionKeysWithDocumentedLeastPrivilegeScopePct,
        asNum(data.productionKeysWithDocumentedLeastPrivilegeScopePct) ??
          asNum(
            data.production_keys_with_documented_least_privilege_scope_pct,
          ) ??
          asNum(data.scopedKeysPct),
      );
      productionKeysWithinRotationPolicyPct = mergeMinNum(
        productionKeysWithinRotationPolicyPct,
        asNum(data.productionKeysWithinRotationPolicyPct) ??
          asNum(data.production_keys_within_rotation_policy_pct) ??
          asNum(data.withinRotationPolicyPct),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionProviderOrCloudKeysPresent,
    privilegedProviderOrCloudKeysInClientApps,
    productionKeysWithDocumentedLeastPrivilegeScopePct,
    productionKeysWithinRotationPolicyPct,
    measuredAt,
    sources,
  };
}

export function buildKeyRotationScopeReport(opts: {
  assessedAt: string;
  keyInventory: { found: boolean; refs: string[] };
  rotationPolicy: { found: boolean; refs: string[] };
  leastPrivilegeScope: { found: boolean; refs: string[] };
  clientKeyRisk: { found: boolean; refs: string[] };
  imported: KeyRotationScopeReport["importedResults"];
}): KeyRotationScopeReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.keyInventory.found ||
    opts.rotationPolicy.found ||
    opts.leastPrivilegeScope.found ||
    opts.clientKeyRisk.found;
  // Inventory / client-key risk prove keys exist; rotation/scope docs alone are too generic.
  const surfaceProvedForNaOverride =
    opts.keyInventory.found || opts.clientKeyRisk.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No key-rotation-scope signals — SEC2-M3 remains not demonstrated until key inventory + scope/rotation + client-scan evidence or an explicit N/A attest (productionProviderOrCloudKeysPresent=false) is imported.",
    );
  }
  if (opts.keyInventory.found) {
    notes.push(
      `Key-inventory refs: ${opts.keyInventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.rotationPolicy.found) {
    notes.push(
      `Rotation-policy refs: ${opts.rotationPolicy.refs.slice(0, 3).join(", ")}; rotation docs alone do not satisfy SEC2-M3.`,
    );
  }
  if (opts.leastPrivilegeScope.found) {
    notes.push(
      `Least-privilege/scope refs: ${opts.leastPrivilegeScope.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.clientKeyRisk.found) {
    notes.push(
      `Client-key risk refs: ${opts.clientKeyRisk.refs.slice(0, 3).join(", ")}; patterns alone do not prove disposition — import client-scan metrics.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (keysPresent=${opts.imported.productionProviderOrCloudKeysPresent}, clientPrivileged=${opts.imported.privilegedProviderOrCloudKeysInClientApps}, scopedPct=${opts.imported.productionKeysWithDocumentedLeastPrivilegeScopePct}, rotationPct=${opts.imported.productionKeysWithinRotationPolicyPct}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import inventory (or present=true) plus privilegedProviderOrCloudKeysInClientApps=0 + productionKeysWithDocumentedLeastPrivilegeScopePct=100 + productionKeysWithinRotationPolicyPct=100 (measuredAt ≤90d) under imports/key-rotation-scope/ to PASS. Set productionProviderOrCloudKeysPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const keysPresent =
    opts.imported.productionProviderOrCloudKeysPresent === true;
  const inventoryPresent = opts.keyInventory.found || keysPresent;

  const clientOk =
    opts.imported.privilegedProviderOrCloudKeysInClientApps === 0;
  const scopedOk =
    opts.imported.productionKeysWithDocumentedLeastPrivilegeScopePct === 100;
  const rotationOk =
    opts.imported.productionKeysWithinRotationPolicyPct === 100;

  let statusHint: KeyRotationScopeReport["summary"]["statusHint"];
  let sec2M3Satisfied: boolean | null = null;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionProviderOrCloudKeysPresent === false &&
    !surfaceProvedForNaOverride;
  const contradictingFail =
    opts.imported.privilegedProviderOrCloudKeysInClientApps !== null &&
    opts.imported.privilegedProviderOrCloudKeysInClientApps > 0;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    ((opts.imported.privilegedProviderOrCloudKeysInClientApps !== null &&
      opts.imported.privilegedProviderOrCloudKeysInClientApps > 0) ||
      (opts.imported.productionKeysWithDocumentedLeastPrivilegeScopePct !==
        null &&
        opts.imported.productionKeysWithDocumentedLeastPrivilegeScopePct <
          100) ||
      (opts.imported.productionKeysWithinRotationPolicyPct !== null &&
        opts.imported.productionKeysWithinRotationPolicyPct < 100));

  const naOverrideNote =
    "Imported productionProviderOrCloudKeysPresent=false ignored — in-repo key inventory or client-key signals prove the surface exists.";

  if (explicitFail) {
    statusHint = "fail";
    sec2M3Satisfied = false;
    if (
      opts.imported.productionProviderOrCloudKeysPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(naOverrideNote);
    }
    notes.push(
      "Imported evidence shows privileged client keys, incomplete scope coverage, or rotation-policy breaches — SEC2-M3 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.productionProviderOrCloudKeysPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2M3Satisfied = null;
    notes.push(
      "Imported productionProviderOrCloudKeysPresent=false — SEC2-M3 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionProviderOrCloudKeysPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(naOverrideNote);
    if (
      inventoryPresent &&
      clientOk &&
      scopedOk &&
      rotationOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2M3Satisfied = true;
    } else {
      statusHint = "partial";
      sec2M3Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2M3Satisfied = null;
  } else if (
    inventoryPresent &&
    clientOk &&
    scopedOk &&
    rotationOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sec2M3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2M3Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires production key inventory (in-repo or productionProviderOrCloudKeysPresent=true) — rotation/scope docs alone are insufficient.",
      );
    }
    if (opts.imported.found && !clientOk) {
      notes.push(
        "Import must show privilegedProviderOrCloudKeysInClientApps=0.",
      );
    }
    if (opts.imported.found && !scopedOk) {
      notes.push(
        "Import must show productionKeysWithDocumentedLeastPrivilegeScopePct=100.",
      );
    }
    if (opts.imported.found && !rotationOk) {
      notes.push(
        "Import must show productionKeysWithinRotationPolicyPct=100.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC2-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2M3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      keyInventory: opts.keyInventory,
      rotationPolicy: opts.rotationPolicy,
      leastPrivilegeScope: opts.leastPrivilegeScope,
      clientKeyRisk: opts.clientKeyRisk,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      sec2M3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const keyRotationScopeCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const invRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => KEY_INVENTORY_RE.test(path) || KEY_INVENTORY_RE.test(text),
      10,
    );
    const rotRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ROTATION_RE.test(path) || ROTATION_RE.test(text),
      10,
    );
    const scopeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCOPE_RE.test(path) || SCOPE_RE.test(text),
      10,
    );
    const clientRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CLIENT_KEY_RE.test(path) || CLIENT_KEY_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildKeyRotationScopeReport({
      assessedAt: ctx.assessedAt.toISOString(),
      keyInventory: { found: invRefs.length > 0, refs: invRefs },
      rotationPolicy: { found: rotRefs.length > 0, refs: rotRefs },
      leastPrivilegeScope: { found: scopeRefs.length > 0, refs: scopeRefs },
      clientKeyRisk: { found: clientRefs.length > 0, refs: clientRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "key-rotation-scope-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/key-rotation-scope-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "key-rotation-scope",
          "sec2-m3",
          DETECTOR_ID,
          ...(report.summary.sec2M3Satisfied ? ["sec2-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-M3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.sec2M3Satisfied}; report=imports/${PLUGIN_ID}/key-rotation-scope-report.json`,
      nodes,
    };
  },
};
