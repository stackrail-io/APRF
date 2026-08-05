/**
 * ai-warm-standby — REL-R6 / repo-ai-warm-standby.
 *
 * Discovers self-hosted inference warm standby + failover RTO + capacity.
 * Import warmStandbyArchitectureDocumented +
 * failoverWithinRtoWithin90Days +
 * standbyCapacityCoversDeclaredPeak under imports/ai-warm-standby/
 * to unlock PASS (measuredAt ≤90d). NA when no self-hosted inference.
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

const PLUGIN_ID = "ai-warm-standby";
const RELATED = ["REL-R6"] as const;
const DETECTOR_ID = "repo-ai-warm-standby";
const IMPORT_MAX_AGE_DAYS = 90;

const SELF_HOSTED_RE =
  /\b(self[_-]?host(ed)?|on[_-]?prem(ise)?|vllm|tgi|triton|ollama|local[_-]?(llm|model|inference)|gpu[_-]?(fleet|cluster|node)|inference[_-]?(server|cluster|fleet))\b/i;

const WARM_STANDBY_RE =
  /\b(warm[_-]?standby|hot[_-]?standby|standby[_-]?(inference|model|gpu)|active[_-]?passive[_-]?inference|redundant[_-]?inference)\b/i;

const FAILOVER_RTO_RE =
  /\b(standby[_-]?failover|warm[_-]?standby[_-]?(test|failover)|failover[_-]?(test|drill).*rto|rto[_-]?(met|result|test))\b/i;

const CAPACITY_RE =
  /\b(standby[_-]?capacity|peak[_-]?(capacity|load|qps|throughput)|declared[_-]?peak|capacity[_-]?(cover|sizing|reserve))\b/i;

export interface AiWarmStandbyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    selfHosted: { found: boolean; refs: string[] };
    warmStandby: { found: boolean; refs: string[] };
    failover: { found: boolean; refs: string[] };
    capacity: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    warmStandbyArchitectureDocumented: boolean | null;
    failoverWithinRtoWithin90Days: boolean | null;
    standbyCapacityCoversDeclaredPeak: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    selfHostedSignalsPresent: boolean;
    standbySignalsPresent: boolean;
    relR6Satisfied: boolean | null;
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
    extensions: [
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".tf",
      ".ts",
      ".py",
      ".pdf",
    ],
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
): AiWarmStandbyReport["importedResults"] {
  const sources: string[] = [];
  let warmStandbyArchitectureDocumented: boolean | null = null;
  let failoverWithinRtoWithin90Days: boolean | null = null;
  let standbyCapacityCoversDeclaredPeak: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-warm-standby-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      warmStandbyArchitectureDocumented =
        asBool(data.warmStandbyArchitectureDocumented) ??
        asBool(data.warm_standby_architecture_documented) ??
        asBool(data.warmStandbyDocumented) ??
        warmStandbyArchitectureDocumented;
      failoverWithinRtoWithin90Days =
        asBool(data.failoverWithinRtoWithin90Days) ??
        asBool(data.failover_within_rto_within_90_days) ??
        asBool(data.failoverMetRto) ??
        asBool(data.failoverTestSucceededWithin90Days) ??
        failoverWithinRtoWithin90Days;
      standbyCapacityCoversDeclaredPeak =
        asBool(data.standbyCapacityCoversDeclaredPeak) ??
        asBool(data.standby_capacity_covers_declared_peak) ??
        asBool(data.capacityCoversPeak) ??
        standbyCapacityCoversDeclaredPeak;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    warmStandbyArchitectureDocumented,
    failoverWithinRtoWithin90Days,
    standbyCapacityCoversDeclaredPeak,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiWarmStandbyReport(opts: {
  assessedAt: string;
  selfHosted: { found: boolean; refs: string[] };
  warmStandby: { found: boolean; refs: string[] };
  failover: { found: boolean; refs: string[] };
  capacity: { found: boolean; refs: string[] };
  imported: AiWarmStandbyReport["importedResults"];
}): AiWarmStandbyReport {
  const notes: string[] = [];
  const selfHostedSignalsPresent = opts.selfHosted.found;
  const standbySignalsPresent =
    opts.warmStandby.found || opts.failover.found || opts.capacity.found;

  if (
    !selfHostedSignalsPresent &&
    !standbySignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No self-hosted inference / warm-standby signals — REL-R6 may be NOT_APPLICABLE.",
    );
  }
  if (opts.selfHosted.found) {
    notes.push(
      `Self-hosted refs: ${opts.selfHosted.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.warmStandby.found) {
    notes.push(
      `Warm-standby refs: ${opts.warmStandby.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.failover.found) {
    notes.push(`Failover refs: ${opts.failover.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.capacity.found) {
    notes.push(`Capacity refs: ${opts.capacity.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (arch=${opts.imported.warmStandbyArchitectureDocumented}, failoverRto=${opts.imported.failoverWithinRtoWithin90Days}, capacity=${opts.imported.standbyCapacityCoversDeclaredPeak})`,
    );
  } else if (standbySignalsPresent || selfHostedSignalsPresent) {
    notes.push(
      "Self-hosted/standby signals alone are PARTIAL — import warmStandbyArchitectureDocumented=true + failoverWithinRtoWithin90Days=true + standbyCapacityCoversDeclaredPeak=true (measuredAt ≤90d) under imports/ai-warm-standby/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const archOk = opts.imported.warmStandbyArchitectureDocumented === true;
  const failoverOk = opts.imported.failoverWithinRtoWithin90Days === true;
  const capacityOk = opts.imported.standbyCapacityCoversDeclaredPeak === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiWarmStandbyReport["summary"]["statusHint"];
  let relR6Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.warmStandbyArchitectureDocumented === false ||
      opts.imported.failoverWithinRtoWithin90Days === false ||
      opts.imported.standbyCapacityCoversDeclaredPeak === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !selfHostedSignalsPresent &&
    !standbySignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    relR6Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR6Satisfied = false;
    notes.push(
      "Imported evidence shows missing warm-standby architecture, failover within RTO ≤90 days, peak capacity coverage, or attest older than 90 days — REL-R6 fail.",
    );
  } else if (
    (standbySignalsPresent ||
      selfHostedSignalsPresent ||
      opts.imported.found) &&
    archOk &&
    failoverOk &&
    capacityOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR6Satisfied = true;
  } else if (
    standbySignalsPresent ||
    selfHostedSignalsPresent ||
    opts.imported.found
  ) {
    statusHint = "partial";
    relR6Satisfied = false;
    if (opts.imported.found && !archOk) {
      notes.push("Import must show warmStandbyArchitectureDocumented=true.");
    }
    if (opts.imported.found && !failoverOk) {
      notes.push("Import must show failoverWithinRtoWithin90Days=true.");
    }
    if (opts.imported.found && !capacityOk) {
      notes.push("Import must show standbyCapacityCoversDeclaredPeak=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R6 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relR6Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      selfHosted: opts.selfHosted,
      warmStandby: opts.warmStandby,
      failover: opts.failover,
      capacity: opts.capacity,
    },
    importedResults: opts.imported,
    summary: {
      selfHostedSignalsPresent,
      standbySignalsPresent,
      relR6Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiWarmStandbyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const selfHostedRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SELF_HOSTED_RE.test(path) || SELF_HOSTED_RE.test(text),
      10,
    );
    const warmStandbyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => WARM_STANDBY_RE.test(path) || WARM_STANDBY_RE.test(text),
      8,
    );
    const failoverRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        FAILOVER_RTO_RE.test(path) ||
        (/(test|drill|report)/i.test(path) && FAILOVER_RTO_RE.test(text)),
      8,
    );
    const capacityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CAPACITY_RE.test(path) || CAPACITY_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiWarmStandbyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      selfHosted: { found: selfHostedRefs.length > 0, refs: selfHostedRefs },
      warmStandby: {
        found: warmStandbyRefs.length > 0,
        refs: warmStandbyRefs,
      },
      failover: { found: failoverRefs.length > 0, refs: failoverRefs },
      capacity: { found: capacityRefs.length > 0, refs: capacityRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-warm-standby-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-warm-standby-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-warm-standby",
          "rel-r6",
          DETECTOR_ID,
          ...(report.summary.relR6Satisfied ? ["rel-r6-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.selfHosted.refs,
        ...report.signals.warmStandby.refs,
        ...report.signals.failover.refs,
        ...report.signals.capacity.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-warm-standby-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R6 status=${report.summary.statusHint} selfHosted=${report.summary.selfHostedSignalsPresent} satisfied=${report.summary.relR6Satisfied}; report=imports/${PLUGIN_ID}/ai-warm-standby-report.json`,
      nodes,
    };
  },
};
