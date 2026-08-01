/**
 * ai-safety-edge-sampling — SAF-R1 / repo-ai-safety-edge-sampling.
 *
 * Discovers human safety edge-case sampling plans + review packets.
 * Import safetyEdgeCaseSamplingPlanConfigured +
 * lastPacketWithin90DaysWithDispositionsAndReviewers +
 * backlogLinkedWhenNeeded under imports/ai-safety-edge-sampling/
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

const PLUGIN_ID = "ai-safety-edge-sampling";
const RELATED = ["SAF-R1"] as const;
const DETECTOR_ID = "repo-ai-safety-edge-sampling";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PLAN_RE =
  /\b(safety[_-]?(edge[_-]?)?case[_-]?(sampling|review)|edge[_-]?case[_-]?(sampling|review)|human[_-]?safety[_-]?review|safety[_-]?sampling[_-]?(plan|cadence))\b/i;

const PACKET_RE =
  /\b(review[_-]?packet|sampling[_-]?packet|edge[_-]?case[_-]?(label|disposition)|reviewer[_-]?name|human[_-]?label)\b/i;

const CADENCE_RE =
  /\b(monthly|per[_-]?release|cadence|sample[_-]?size|sampling[_-]?rate)\b/i;

const BACKLOG_RE =
  /\b(safety[_-]?backlog|backlog[_-]?(link|item)|disposition|remediation[_-]?ticket)\b/i;

export interface AiSafetyEdgeSamplingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    plan: { found: boolean; refs: string[] };
    packet: { found: boolean; refs: string[] };
    cadence: { found: boolean; refs: string[] };
    backlog: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    safetyEdgeCaseSamplingPlanConfigured: boolean | null;
    lastPacketWithin90DaysWithDispositionsAndReviewers: boolean | null;
    backlogLinkedWhenNeeded: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    samplingSignalsPresent: boolean;
    safR1Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".csv", ".pdf"],
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
): AiSafetyEdgeSamplingReport["importedResults"] {
  const sources: string[] = [];
  let safetyEdgeCaseSamplingPlanConfigured: boolean | null = null;
  let lastPacketWithin90DaysWithDispositionsAndReviewers: boolean | null =
    null;
  let backlogLinkedWhenNeeded: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-safety-edge-sampling-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      safetyEdgeCaseSamplingPlanConfigured =
        asBool(data.safetyEdgeCaseSamplingPlanConfigured) ??
        asBool(data.safety_edge_case_sampling_plan_configured) ??
        asBool(data.samplingPlanConfigured) ??
        safetyEdgeCaseSamplingPlanConfigured;
      lastPacketWithin90DaysWithDispositionsAndReviewers =
        asBool(
          data.lastPacketWithin90DaysWithDispositionsAndReviewers,
        ) ??
        asBool(
          data.last_packet_within_90_days_with_dispositions_and_reviewers,
        ) ??
        asBool(data.lastPacketComplete) ??
        lastPacketWithin90DaysWithDispositionsAndReviewers;
      backlogLinkedWhenNeeded =
        asBool(data.backlogLinkedWhenNeeded) ??
        asBool(data.backlog_linked_when_needed) ??
        asBool(data.backlogLinksPresent) ??
        backlogLinkedWhenNeeded;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    safetyEdgeCaseSamplingPlanConfigured,
    lastPacketWithin90DaysWithDispositionsAndReviewers,
    backlogLinkedWhenNeeded,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiSafetyEdgeSamplingReport(opts: {
  assessedAt: string;
  plan: { found: boolean; refs: string[] };
  packet: { found: boolean; refs: string[] };
  cadence: { found: boolean; refs: string[] };
  backlog: { found: boolean; refs: string[] };
  imported: AiSafetyEdgeSamplingReport["importedResults"];
}): AiSafetyEdgeSamplingReport {
  const notes: string[] = [];
  const samplingSignalsPresent =
    opts.plan.found ||
    opts.packet.found ||
    opts.cadence.found ||
    opts.backlog.found;

  if (!samplingSignalsPresent && !opts.imported.found) {
    notes.push(
      "No safety edge-case sampling signals — SAF-R1 may be NOT_APPLICABLE if there is no production safety-relevant AI surface.",
    );
  }
  if (opts.plan.found) {
    notes.push(`Plan refs: ${opts.plan.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.packet.found) {
    notes.push(`Packet refs: ${opts.packet.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (plan=${opts.imported.safetyEdgeCaseSamplingPlanConfigured}, packet=${opts.imported.lastPacketWithin90DaysWithDispositionsAndReviewers}, backlog=${opts.imported.backlogLinkedWhenNeeded})`,
    );
  } else if (samplingSignalsPresent) {
    notes.push(
      "Sampling signals alone are PARTIAL — import safetyEdgeCaseSamplingPlanConfigured=true + lastPacketWithin90DaysWithDispositionsAndReviewers=true + backlogLinkedWhenNeeded=true (measuredAt ≤90d) under imports/ai-safety-edge-sampling/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const planOk = opts.imported.safetyEdgeCaseSamplingPlanConfigured === true;
  const packetOk =
    opts.imported.lastPacketWithin90DaysWithDispositionsAndReviewers === true;
  const backlogOk = opts.imported.backlogLinkedWhenNeeded === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiSafetyEdgeSamplingReport["summary"]["statusHint"];
  let safR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.safetyEdgeCaseSamplingPlanConfigured === false ||
      opts.imported.lastPacketWithin90DaysWithDispositionsAndReviewers ===
        false ||
      opts.imported.backlogLinkedWhenNeeded === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!samplingSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing plan, incomplete/stale packet, missing backlog links when needed, or attest older than 90 days — SAF-R1 fail.",
    );
  } else if (
    (samplingSignalsPresent || opts.imported.found) &&
    planOk &&
    packetOk &&
    backlogOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    safR1Satisfied = true;
  } else if (samplingSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safR1Satisfied = false;
    if (opts.imported.found && !planOk) {
      notes.push(
        "Import must show safetyEdgeCaseSamplingPlanConfigured=true.",
      );
    }
    if (opts.imported.found && !packetOk) {
      notes.push(
        "Import must show lastPacketWithin90DaysWithDispositionsAndReviewers=true.",
      );
    }
    if (opts.imported.found && !backlogOk) {
      notes.push("Import must show backlogLinkedWhenNeeded=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      plan: opts.plan,
      packet: opts.packet,
      cadence: opts.cadence,
      backlog: opts.backlog,
    },
    importedResults: opts.imported,
    summary: {
      samplingSignalsPresent,
      safR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiSafetyEdgeSamplingCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const planRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PLAN_RE.test(path) || PLAN_RE.test(text),
      10,
    );
    const packetRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PACKET_RE.test(path) || PACKET_RE.test(text),
      10,
    );
    const cadenceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        CADENCE_RE.test(path) ||
        ((PLAN_RE.test(path) || PLAN_RE.test(text)) && CADENCE_RE.test(text)),
      8,
    );
    const backlogRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => BACKLOG_RE.test(path) || BACKLOG_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiSafetyEdgeSamplingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      plan: { found: planRefs.length > 0, refs: planRefs },
      packet: { found: packetRefs.length > 0, refs: packetRefs },
      cadence: { found: cadenceRefs.length > 0, refs: cadenceRefs },
      backlog: { found: backlogRefs.length > 0, refs: backlogRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-safety-edge-sampling-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-safety-edge-sampling-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-safety-edge-sampling",
          "saf-r1",
          DETECTOR_ID,
          ...(report.summary.safR1Satisfied ? ["saf-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.plan.refs,
        ...report.signals.packet.refs,
        ...report.signals.cadence.refs,
        ...report.signals.backlog.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-safety-edge-sampling-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-R1 status=${report.summary.statusHint} signals=${report.summary.samplingSignalsPresent} satisfied=${report.summary.safR1Satisfied}; report=imports/${PLUGIN_ID}/ai-safety-edge-sampling-report.json`,
      nodes,
    };
  },
};
