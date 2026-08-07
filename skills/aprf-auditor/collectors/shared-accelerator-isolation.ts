/**
 * shared-accelerator-isolation — INF-M4 / repo-shared-accelerator-isolation.
 *
 * Discovers shared GPU/accelerator isolation + capacity-test signals.
 * Import coverage under imports/shared-accelerator-isolation/ to unlock PASS
 * (measuredAt ≤90d). N/A when shared accelerator infra is not operated
 * (managed API / CPU-only / single-tenant / dedicated GPU).
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
  mergeAndBool,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "shared-accelerator-isolation";
const RELATED = ["INF-M4"] as const;
const DETECTOR_ID = "repo-shared-accelerator-isolation";
const IMPORT_MAX_AGE_DAYS = 90;

const SHARED_ACCEL_RE =
  /\b(shared[_-]?(gpu|accelerator)|multi[_-]?tenant[_-]?(gpu|inference)|gpu[_-]?cluster|nvidia[_-]?mig|\bmig\b|vgpu|triton[_-]?inference|ray[_-]?serve|vllm|internal[_-]?(llm|model)[_-]?platform|gpu[_-]?schedul)\b/i;

const ISOLATION_RE =
  /\b(gpu[_-]?isolation|accelerator[_-]?isolation|noisy[_-]?neighbor|tenant[_-]?qos|resource[_-]?quot(a|as)|device[_-]?plugin|gpu[_-]?sharing|time[_-]?slicing|mps\b|cuda[_-]?mps)\b/i;

const CAPACITY_TEST_RE =
  /\b(isolation[_-]?test|capacity[_-]?test|noisy[_-]?neighbor[_-]?(test|bench)|gpu[_-]?(bench|load[_-]?test)|accelerator[_-]?capacity)\b/i;

export interface SharedAcceleratorIsolationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    sharedAccelerators: { found: boolean; refs: string[] };
    isolationControls: { found: boolean; refs: string[] };
    capacityOrIsolationTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sharedAiAcceleratorInfrastructurePresent: boolean | null;
    isolationControlsDocumented: boolean | null;
    isolationOrCapacityTestMeetsStatedLimits: boolean | null;
    tenantQosOrSchedulingPolicyPresent: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    infM4Satisfied: boolean | null;
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

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [...SCAN_EXTENSIONS, ".tf"],
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
): SharedAcceleratorIsolationReport["importedResults"] {
  const sources: string[] = [];
  let sharedAiAcceleratorInfrastructurePresent: boolean | null = null;
  let isolationControlsDocumented: boolean | null = null;
  let isolationOrCapacityTestMeetsStatedLimits: boolean | null = null;
  let tenantQosOrSchedulingPolicyPresent: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/shared-accelerator-isolation-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      sharedAiAcceleratorInfrastructurePresent = mergeOrBool(
        sharedAiAcceleratorInfrastructurePresent,
        asBool(data.sharedAiAcceleratorInfrastructurePresent) ??
          asBool(data.shared_ai_accelerator_infrastructure_present) ??
          asBool(data.sharedAcceleratorsPresent),
      );
      isolationControlsDocumented = mergeAndBool(
        isolationControlsDocumented,
        asBool(data.isolationControlsDocumented) ??
          asBool(data.isolation_controls_documented) ??
          asBool(data.isolationDocumented),
      );
      isolationOrCapacityTestMeetsStatedLimits = mergeAndBool(
        isolationOrCapacityTestMeetsStatedLimits,
        asBool(data.isolationOrCapacityTestMeetsStatedLimits) ??
          asBool(data.isolation_or_capacity_test_meets_stated_limits) ??
          asBool(data.capacityTestMeetsLimits),
      );
      tenantQosOrSchedulingPolicyPresent = mergeAndBool(
        tenantQosOrSchedulingPolicyPresent,
        asBool(data.tenantQosOrSchedulingPolicyPresent) ??
          asBool(data.tenant_qos_or_scheduling_policy_present) ??
          asBool(data.schedulingPolicyPresent),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sharedAiAcceleratorInfrastructurePresent,
    isolationControlsDocumented,
    isolationOrCapacityTestMeetsStatedLimits,
    tenantQosOrSchedulingPolicyPresent,
    measuredAt,
    sources,
  };
}

export function buildSharedAcceleratorIsolationReport(opts: {
  assessedAt: string;
  sharedAccelerators: { found: boolean; refs: string[] };
  isolationControls: { found: boolean; refs: string[] };
  capacityOrIsolationTest: { found: boolean; refs: string[] };
  imported: SharedAcceleratorIsolationReport["importedResults"];
}): SharedAcceleratorIsolationReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.sharedAccelerators.found ||
    opts.isolationControls.found ||
    opts.capacityOrIsolationTest.found;
  // Only shared-accelerator inventory proves the INF-M4 surface for N/A
  // override — bare isolation/test docs must not launder present=false.
  const surfaceProvedForNaOverride = opts.sharedAccelerators.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No shared-accelerator isolation signals — INF-M4 remains not demonstrated until isolation design + capacity/isolation test evidence or an explicit N/A attest (sharedAiAcceleratorInfrastructurePresent=false for managed-API/CPU-only/single-tenant/dedicated GPU) is imported.",
    );
  }
  if (opts.sharedAccelerators.found) {
    notes.push(
      `Shared-accelerator refs: ${opts.sharedAccelerators.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.isolationControls.found) {
    notes.push(
      `Isolation/QoS refs: ${opts.isolationControls.refs.slice(0, 3).join(", ")}; design alone does not satisfy INF-M4.`,
    );
  }
  if (opts.capacityOrIsolationTest.found) {
    notes.push(
      `Isolation/capacity-test refs: ${opts.capacityOrIsolationTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.sharedAiAcceleratorInfrastructurePresent}, isolationDoc=${opts.imported.isolationControlsDocumented}, testOk=${opts.imported.isolationOrCapacityTestMeetsStatedLimits}, qos=${opts.imported.tenantQosOrSchedulingPolicyPresent}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import inventory (or present=true) plus isolationControlsDocumented=true + isolationOrCapacityTestMeetsStatedLimits=true (measuredAt ≤90d) under imports/shared-accelerator-isolation/ to PASS. Set sharedAiAcceleratorInfrastructurePresent=false for NOT_APPLICABLE (managed API / CPU-only / single-tenant / dedicated GPU).",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.sharedAiAcceleratorInfrastructurePresent === false &&
    !surfaceProvedForNaOverride;
  const scopePresent =
    opts.imported.sharedAiAcceleratorInfrastructurePresent === true;
  // PASS requires shared-accelerator inventory — isolation/test docs alone
  // must not unlock INF-M4 even with perfect import metrics.
  const inventoryPresent = opts.sharedAccelerators.found || scopePresent;

  const isolationOk = opts.imported.isolationControlsDocumented === true;
  const testOk = opts.imported.isolationOrCapacityTestMeetsStatedLimits === true;
  // QoS/scheduling is supporting evidence — preferred but not required alone for PASS
  // when isolation doc + test already hold (aligned with passCondition).

  let statusHint: SharedAcceleratorIsolationReport["summary"]["statusHint"];
  let infM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.isolationControlsDocumented === false ||
      opts.imported.isolationOrCapacityTestMeetsStatedLimits === false);

  if (
    opts.imported.found &&
    opts.imported.sharedAiAcceleratorInfrastructurePresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    infM4Satisfied = null;
    notes.push(
      "Imported sharedAiAcceleratorInfrastructurePresent=false — INF-M4 NOT_APPLICABLE (managed API / CPU-only / single-tenant / dedicated GPU, or equivalent).",
    );
  } else if (
    opts.imported.sharedAiAcceleratorInfrastructurePresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported sharedAiAcceleratorInfrastructurePresent=false ignored — in-repo shared accelerator inventory proves the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      infM4Satisfied = false;
      notes.push(
        "Imported evidence shows missing isolation design or failing/missing capacity/isolation test — INF-M4 fail.",
      );
    } else if (
      inventoryPresent &&
      isolationOk &&
      testOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      infM4Satisfied = true;
    } else {
      statusHint = "partial";
      infM4Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    infM4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    infM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing isolation design or failing/missing capacity/isolation test — INF-M4 fail.",
    );
  } else if (
    inventoryPresent &&
    isolationOk &&
    testOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    infM4Satisfied = true;
    if (opts.imported.tenantQosOrSchedulingPolicyPresent !== true) {
      notes.push(
        "Optional: tenantQosOrSchedulingPolicyPresent not attested — strengthen evidence with GPU scheduling / tenant QoS policy.",
      );
    }
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    infM4Satisfied = false;
    if (opts.imported.found && !inventoryPresent) {
      notes.push(
        "PASS requires shared AI accelerator inventory (in-repo or sharedAiAcceleratorInfrastructurePresent=true) — isolation/test signals alone are insufficient.",
      );
    }
    if (opts.imported.found && !isolationOk) {
      notes.push("Import must show isolationControlsDocumented=true.");
    }
    if (opts.imported.found && !testOk) {
      notes.push(
        "Import must show isolationOrCapacityTestMeetsStatedLimits=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INF-M4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    infM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      sharedAccelerators: opts.sharedAccelerators,
      isolationControls: opts.isolationControls,
      capacityOrIsolationTest: opts.capacityOrIsolationTest,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      infM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const sharedAcceleratorIsolationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const sharedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SHARED_ACCEL_RE.test(path) || SHARED_ACCEL_RE.test(text),
      10,
    );
    const isolationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ISOLATION_RE.test(path) || ISOLATION_RE.test(text),
      10,
    );
    const testRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CAPACITY_TEST_RE.test(path) || CAPACITY_TEST_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildSharedAcceleratorIsolationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      sharedAccelerators: { found: sharedRefs.length > 0, refs: sharedRefs },
      isolationControls: {
        found: isolationRefs.length > 0,
        refs: isolationRefs,
      },
      capacityOrIsolationTest: { found: testRefs.length > 0, refs: testRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "shared-accelerator-isolation-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "iac",
        ref: `imports/${PLUGIN_ID}/shared-accelerator-isolation-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "shared-accelerator-isolation",
          "inf-m4",
          DETECTOR_ID,
          ...(report.summary.infM4Satisfied ? ["inf-m4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.sharedAccelerators.refs,
        ...report.signals.isolationControls.refs,
        ...report.signals.capacityOrIsolationTest.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "iac",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["shared-accelerator-isolation-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INF-M4 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.infM4Satisfied}; report=imports/${PLUGIN_ID}/shared-accelerator-isolation-report.json`,
      nodes,
    };
  },
};
