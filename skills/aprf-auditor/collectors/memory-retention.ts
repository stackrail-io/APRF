/**
 * memory-retention — MEM-M2 / repo-memory-retention.
 *
 * Discovers AI memory retention policies and TTL/deletion jobs. Import a purge
 * test under imports/memory-retention/ to unlock PASS.
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

const PLUGIN_ID = "memory-retention";
const RELATED = ["MEM-M2"] as const;
const DETECTOR_ID = "repo-memory-retention";
const INVENTORY_MAX_AGE_DAYS = 90;

const MEMORY_PATH_RE =
  /(memory|memories|conversation|vector|embedding|retriev|durable[\s_-]*mem|session[\s_-]*mem|rag)/i;

const POLICY_RE =
  /\b(retention[\s_-]*(policy|period|ttl)|ttl[\s_-]*(policy|days|hours)|memory[\s_-]*class|retain[\s_-]*for|expires?[\s_-]*after)\b/i;

const JOB_RE =
  /\b(ttl[\s_-]*(job|worker|cron)|deletion[\s_-]*job|purge[\s_-]*(job|worker|cron)|expire[\s_-]*memory|cleanup[\s_-]*memory|retention[\s_-]*job)\b/i;

const TEST_RE =
  /\b(retention[\s_-]*test|ttl[\s_-]*test|purge[\s_-]*test|older[\s_-]*than[\s_-]*retention|expired[\s_-]*memory|assert.*(?:absent|deleted|purged|expired))\b/i;

export interface MemoryRetentionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    retentionPolicy: { found: boolean; refs: string[] };
    ttlOrDeletionJob: { found: boolean; refs: string[] };
    purgeTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    retentionPeriodsPerMemoryClass: boolean | null;
    ttlOrDeletionJobConfigured: boolean | null;
    purgeTestSucceeded: boolean | null;
    olderThanRetentionAbsent: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    retentionSignalsPresent: boolean;
    memM2Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): MemoryRetentionReport["importedResults"] {
  const sources: string[] = [];
  let retentionPeriodsPerMemoryClass: boolean | null = null;
  let ttlOrDeletionJobConfigured: boolean | null = null;
  let purgeTestSucceeded: boolean | null = null;
  let olderThanRetentionAbsent: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-retention-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      retentionPeriodsPerMemoryClass =
        asBool(data.retentionPeriodsPerMemoryClass) ??
        asBool(data.policyDocumentsRetentionPerClass) ??
        retentionPeriodsPerMemoryClass;
      ttlOrDeletionJobConfigured =
        asBool(data.ttlOrDeletionJobConfigured) ??
        asBool(data.ttlJobConfigured) ??
        asBool(data.deletionJobConfigured) ??
        ttlOrDeletionJobConfigured;
      purgeTestSucceeded =
        asBool(data.purgeTestSucceeded) ??
        asBool(data.ttlTestSucceeded) ??
        asBool(data.deletionTestSucceeded) ??
        purgeTestSucceeded;
      olderThanRetentionAbsent =
        asBool(data.olderThanRetentionAbsent) ??
        asBool(data.sampleOlderThanRetentionAbsent) ??
        olderThanRetentionAbsent;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.memM2Complete) === true) {
        retentionPeriodsPerMemoryClass =
          retentionPeriodsPerMemoryClass ?? true;
        ttlOrDeletionJobConfigured = ttlOrDeletionJobConfigured ?? true;
        purgeTestSucceeded = purgeTestSucceeded ?? true;
        olderThanRetentionAbsent = olderThanRetentionAbsent ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    retentionPeriodsPerMemoryClass,
    ttlOrDeletionJobConfigured,
    purgeTestSucceeded,
    olderThanRetentionAbsent,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryRetentionReport(opts: {
  assessedAt: string;
  signals: MemoryRetentionReport["signals"];
  memorySignals: boolean;
  imported: MemoryRetentionReport["importedResults"];
}): MemoryRetentionReport {
  const notes: string[] = [];
  const retentionSignalsPresent =
    opts.signals.retentionPolicy.found ||
    opts.signals.ttlOrDeletionJob.found ||
    opts.signals.purgeTest.found;

  if (!opts.memorySignals && !retentionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI memory retention signals — MEM-M2 may be NOT_APPLICABLE if there are no retained AI memory classes.",
    );
  }
  if (opts.signals.retentionPolicy.found) {
    notes.push(
      `Policy refs: ${opts.signals.retentionPolicy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.ttlOrDeletionJob.found) {
    notes.push(
      `Job refs: ${opts.signals.ttlOrDeletionJob.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (policy=${opts.imported.retentionPeriodsPerMemoryClass}, job=${opts.imported.ttlOrDeletionJobConfigured}, test=${opts.imported.purgeTestSucceeded}, absent=${opts.imported.olderThanRetentionAbsent}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (retentionSignalsPresent) {
    notes.push(
      "Retention signals alone are PARTIAL — import policy + job + purge test (measuredAt ≤90d) under imports/memory-retention/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= INVENTORY_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    INVENTORY_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.retentionPeriodsPerMemoryClass === true &&
    opts.imported.ttlOrDeletionJobConfigured === true &&
    opts.imported.purgeTestSucceeded === true &&
    opts.imported.olderThanRetentionAbsent === true &&
    ageOk &&
    importFresh;

  let statusHint: MemoryRetentionReport["summary"]["statusHint"];
  let memM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.retentionPeriodsPerMemoryClass === false ||
      opts.imported.ttlOrDeletionJobConfigured === false ||
      opts.imported.purgeTestSucceeded === false ||
      opts.imported.olderThanRetentionAbsent === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (!opts.memorySignals && !retentionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    memM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memM2Satisfied = false;
    notes.push(
      "Imported evidence shows missing per-class retention, missing job, failed purge test, remaining over-retention samples, or evidence older than 90 days — MEM-M2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memM2Satisfied = true;
  } else if (retentionSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    memM2Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.retentionPeriodsPerMemoryClass !== true) {
        notes.push(
          "Import must show retentionPeriodsPerMemoryClass=true.",
        );
      }
      if (opts.imported.ttlOrDeletionJobConfigured !== true) {
        notes.push("Import must show ttlOrDeletionJobConfigured=true.");
      }
      if (opts.imported.purgeTestSucceeded !== true) {
        notes.push("Import must show purgeTestSucceeded=true.");
      }
      if (opts.imported.olderThanRetentionAbsent !== true) {
        notes.push("Import must show olderThanRetentionAbsent=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-M2 PASS.",
        );
      }
    }
  } else if (opts.memorySignals) {
    statusHint = "not_demonstrated";
    memM2Satisfied = null;
    notes.push(
      "Memory signals present but no retention policy or TTL/deletion job found.",
    );
  } else {
    statusHint = "not_demonstrated";
    memM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      retentionSignalsPresent,
      memM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryRetentionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const memorySignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => MEMORY_PATH_RE.test(path) || MEMORY_PATH_RE.test(text),
        5,
      ).length > 0;

    const inMem = (path: string, text: string) =>
      MEMORY_PATH_RE.test(path) ||
      MEMORY_PATH_RE.test(text) ||
      POLICY_RE.test(text) ||
      JOB_RE.test(text);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (POLICY_RE.test(path) || POLICY_RE.test(text)) && inMem(path, text),
    );
    const jobRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (JOB_RE.test(path) || JOB_RE.test(text)) && inMem(path, text),
    );
    const testRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TEST_RE.test(path) || TEST_RE.test(text)) && inMem(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildMemoryRetentionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        retentionPolicy: { found: policyRefs.length > 0, refs: policyRefs },
        ttlOrDeletionJob: { found: jobRefs.length > 0, refs: jobRefs },
        purgeTest: { found: testRefs.length > 0, refs: testRefs },
      },
      memorySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-retention-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-retention-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-retention",
          "mem-m2",
          DETECTOR_ID,
          ...(report.summary.retentionSignalsPresent
            ? ["retention-signals"]
            : []),
          ...(report.summary.memM2Satisfied ? ["mem-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...policyRefs.slice(0, 2),
        ...jobRefs.slice(0, 1),
        ...testRefs.slice(0, 1),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["memory-retention-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-M2 status=${report.summary.statusHint} retention=${report.summary.retentionSignalsPresent} satisfied=${report.summary.memM2Satisfied}; report=imports/${PLUGIN_ID}/memory-retention-report.json`,
      nodes,
    };
  },
};
