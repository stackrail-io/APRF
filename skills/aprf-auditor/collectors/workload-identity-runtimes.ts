/**
 * workload-identity-runtimes — AUTHN-R2 / repo-workload-identity-runtimes.
 *
 * Discovers self-hosted model runtime + workload-identity binding signals.
 * Import selfHostedModelRuntimesWithWorkloadIdentityPct=100 +
 * staticSharedKeysInRuntimeInventory=0 under
 * imports/workload-identity-runtimes/ to unlock PASS (measuredAt ≤90d).
 * Set selfHostedModelRuntimesPresent=false for N/A.
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
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "workload-identity-runtimes";
const RELATED = ["AUTHN-R2"] as const;
const DETECTOR_ID = "repo-workload-identity-runtimes";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const RUNTIME_RE =
  /\b(self[_-]?hosted|vllm|text[_-]?generation[_-]?inference|\btgi\b|triton[_-]?inference|ollama|llama\.cpp|inference[_-]?(server|pod|runtime)|model[_-]?server|gpu[_-]?serving)\b/i;

const WORKLOAD_ID_RE =
  /\b(workload[_-]?identity|spiffe|spire|irsa|service[_-]?account[_-]?(token|annotation)|aws[_-]?iam[_-]?role[_-]?for[_-]?sa|gcp[_-]?workload[_-]?identity|azure[_-]?workload[_-]?identity|projected[_-]?service[_-]?account)\b/i;

const STATIC_KEY_RE =
  /\b(static[_-]?(shared[_-]?)?(api[_-]?key|bearer|secret)|shared[_-]?(model[_-]?)?(api[_-]?key|secret)|MODEL_API_KEY|INFERENCE_API_KEY)\b/i;

const TRACE_RE =
  /\b(authenticated[_-]?call|workload[_-]?identity[_-]?(trace|call|proof)|sample[_-]?(trace|harness).{0,40}(spiffe|iam[_-]?role|workload))\b/i;

export interface WorkloadIdentityRuntimesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    runtimes: { found: boolean; refs: string[] };
    workloadIdentity: { found: boolean; refs: string[] };
    staticKeys: { found: boolean; refs: string[] };
    traces: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    selfHostedModelRuntimesPresent: boolean | null;
    selfHostedModelRuntimesWithWorkloadIdentityPct: number | null;
    staticSharedKeysInRuntimeInventory: number | null;
    sampleAuthenticatedCallsPresent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authnR2Satisfied: boolean | null;
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
): WorkloadIdentityRuntimesReport["importedResults"] {
  const sources: string[] = [];
  let selfHostedModelRuntimesPresent: boolean | null = null;
  let selfHostedModelRuntimesWithWorkloadIdentityPct: number | null = null;
  let staticSharedKeysInRuntimeInventory: number | null = null;
  let sampleAuthenticatedCallsPresent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/workload-identity-runtimes-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      ageDays = mergeMaxNum(
        ageDays,
        asNum(data.ageDays) ?? asNum(data.age_days),
      );
      selfHostedModelRuntimesPresent = mergeOrBool(
        selfHostedModelRuntimesPresent,
        asBool(data.selfHostedModelRuntimesPresent) ??
          asBool(data.self_hosted_model_runtimes_present) ??
          asBool(data.hasSelfHostedModelRuntimes),
      );
      selfHostedModelRuntimesWithWorkloadIdentityPct = mergeMinNum(
        selfHostedModelRuntimesWithWorkloadIdentityPct,
        asNum(data.selfHostedModelRuntimesWithWorkloadIdentityPct) ??
          asNum(data.self_hosted_model_runtimes_with_workload_identity_pct) ??
          asNum(data.workloadIdentityCoveragePct) ??
          asNum(data.runtimeWorkloadIdentityPct),
      );
      staticSharedKeysInRuntimeInventory = mergeMaxNum(
        staticSharedKeysInRuntimeInventory,
        asNum(data.staticSharedKeysInRuntimeInventory) ??
          asNum(data.static_shared_keys_in_runtime_inventory) ??
          asNum(data.staticSharedKeyCount),
      );
      sampleAuthenticatedCallsPresent = mergeAndBool(
        sampleAuthenticatedCallsPresent,
        asBool(data.sampleAuthenticatedCallsPresent) ??
          asBool(data.sample_authenticated_calls_present) ??
          asBool(data.sampleTracesPresent),
      );

      const runtimes =
        (data.runtimes as Array<Record<string, unknown>>) ||
        (data.inventory as Array<Record<string, unknown>>) ||
        [];
      if (runtimes.length) {
        const withWi = runtimes.filter(
          (r) =>
            r.workloadIdentity === true ||
            r.hasWorkloadIdentity === true ||
            Boolean(r.spiffeId) ||
            Boolean(r.iamRole) ||
            Boolean(r.workloadIdentityBinding) ||
            Boolean(r.awsRoleArn) ||
            Boolean(r.gcpServiceAccount) ||
            // Bare Kubernetes serviceAccount names (e.g. "default") are not WI.
            (typeof r.serviceAccount === "string" &&
              /(?:workload|irsa|federat|gke-wi|spiffe)/i.test(
                r.serviceAccount,
              )),
        ).length;
        const staticKeys = runtimes.filter(
          (r) =>
            r.usesStaticSharedKey === true ||
            r.hasStaticSharedKey === true ||
            Boolean(r.staticApiKey),
        ).length;
        const pct = (withWi / runtimes.length) * 100;
        selfHostedModelRuntimesWithWorkloadIdentityPct = mergeMinNum(
          selfHostedModelRuntimesWithWorkloadIdentityPct,
          pct,
        );
        staticSharedKeysInRuntimeInventory = mergeMaxNum(
          staticSharedKeysInRuntimeInventory,
          staticKeys,
        );
        selfHostedModelRuntimesPresent = mergeOrBool(
          selfHostedModelRuntimesPresent,
          true,
        );
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    selfHostedModelRuntimesPresent,
    selfHostedModelRuntimesWithWorkloadIdentityPct,
    staticSharedKeysInRuntimeInventory,
    sampleAuthenticatedCallsPresent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildWorkloadIdentityRuntimesReport(opts: {
  assessedAt: string;
  runtimes: { found: boolean; refs: string[] };
  workloadIdentity: { found: boolean; refs: string[] };
  staticKeys: { found: boolean; refs: string[] };
  traces: { found: boolean; refs: string[] };
  imported: WorkloadIdentityRuntimesReport["importedResults"];
}): WorkloadIdentityRuntimesReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.runtimes.found ||
    opts.workloadIdentity.found ||
    opts.staticKeys.found ||
    opts.traces.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No self-hosted runtime / workload-identity signals — AUTHN-R2 remains not demonstrated until inventory evidence or an explicit N/A attest (selfHostedModelRuntimesPresent=false) is imported.",
    );
  }
  if (opts.runtimes.found) {
    notes.push(
      `Self-hosted runtime refs: ${opts.runtimes.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.workloadIdentity.found) {
    notes.push(
      `Workload-identity refs: ${opts.workloadIdentity.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.staticKeys.found) {
    notes.push(
      `Static-key signal refs: ${opts.staticKeys.refs.slice(0, 3).join(", ")} (supporting — import must show count=0 to PASS)`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.selfHostedModelRuntimesPresent}, wiPct=${opts.imported.selfHostedModelRuntimesWithWorkloadIdentityPct}, staticKeys=${opts.imported.staticSharedKeysInRuntimeInventory}, sampleCalls=${opts.imported.sampleAuthenticatedCallsPresent}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import selfHostedModelRuntimesWithWorkloadIdentityPct=100 + staticSharedKeysInRuntimeInventory=0 + sampleAuthenticatedCallsPresent=true (measuredAt ≤90d) under imports/workload-identity-runtimes/ to PASS. Set selfHostedModelRuntimesPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const wiOk =
    opts.imported.selfHostedModelRuntimesWithWorkloadIdentityPct === 100;
  const staticOk = opts.imported.staticSharedKeysInRuntimeInventory === 0;
  const sampleOk = opts.imported.sampleAuthenticatedCallsPresent === true;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
  );
  const scopeAbsent =
    opts.imported.selfHostedModelRuntimesPresent === false &&
    !gateSignalsPresent;
  const scopePresent = opts.imported.selfHostedModelRuntimesPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  let statusHint: WorkloadIdentityRuntimesReport["summary"]["statusHint"];
  let authnR2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported.selfHostedModelRuntimesWithWorkloadIdentityPct !== null &&
      opts.imported.selfHostedModelRuntimesWithWorkloadIdentityPct < 100) ||
      (opts.imported.staticSharedKeysInRuntimeInventory !== null &&
        opts.imported.staticSharedKeysInRuntimeInventory > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    authnR2Satisfied = null;
    notes.push(
      "Imported selfHostedModelRuntimesPresent=false — AUTHN-R2 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    authnR2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    authnR2Satisfied = false;
    notes.push(
      "Imported evidence shows workload-identity coverage <100%, static shared keys >0, or attest older than 90 days — AUTHN-R2 fail.",
    );
  } else if (
    surfaceOk &&
    wiOk &&
    staticOk &&
    sampleOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authnR2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authnR2Satisfied = false;
    if (opts.imported.found && !surfaceOk) {
      notes.push(
        "Import must set selfHostedModelRuntimesPresent=true (or discover in-repo runtime/WI signals) — coverage metrics alone without an attested surface cannot unlock PASS.",
      );
    }
    if (opts.imported.found && !wiOk) {
      notes.push(
        "Import must show selfHostedModelRuntimesWithWorkloadIdentityPct=100.",
      );
    }
    if (opts.imported.found && !staticOk) {
      notes.push(
        "Import must show staticSharedKeysInRuntimeInventory=0.",
      );
    }
    if (opts.imported.found && !sampleOk) {
      notes.push(
        "Import must show sampleAuthenticatedCallsPresent=true — in-repo trace regex alone does not unlock AUTHN-R2 PASS.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AUTHN-R2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authnR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      runtimes: opts.runtimes,
      workloadIdentity: opts.workloadIdentity,
      staticKeys: opts.staticKeys,
      traces: opts.traces,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authnR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const workloadIdentityRuntimesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const runtimeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RUNTIME_RE.test(path) || RUNTIME_RE.test(text),
      10,
    );
    const wiRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => WORKLOAD_ID_RE.test(path) || WORKLOAD_ID_RE.test(text),
      10,
    );
    const staticRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => STATIC_KEY_RE.test(path) || STATIC_KEY_RE.test(text),
      8,
    );
    const traceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TRACE_RE.test(path) || TRACE_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildWorkloadIdentityRuntimesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      runtimes: { found: runtimeRefs.length > 0, refs: runtimeRefs },
      workloadIdentity: { found: wiRefs.length > 0, refs: wiRefs },
      staticKeys: { found: staticRefs.length > 0, refs: staticRefs },
      traces: { found: traceRefs.length > 0, refs: traceRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "workload-identity-runtimes-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: `imports/${PLUGIN_ID}/workload-identity-runtimes-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "workload-identity-runtimes",
          "authn-r2",
          DETECTOR_ID,
          ...(report.summary.authnR2Satisfied ? ["authn-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.runtimes.refs,
        ...report.signals.workloadIdentity.refs,
        ...report.signals.staticKeys.refs,
        ...report.signals.traces.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["workload-identity-runtimes-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHN-R2 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.authnR2Satisfied}; report=imports/${PLUGIN_ID}/workload-identity-runtimes-report.json`,
      nodes,
    };
  },
};
