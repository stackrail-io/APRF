/**
 * ai-multi-provider-continuity — REL-R7 / repo-ai-multi-provider-continuity.
 *
 * Discovers alternate-provider contractual/technical continuity + failover tests.
 * Import alternateProviderPathDocumented +
 * failoverTestSucceededWithin180Days under
 * imports/ai-multi-provider-continuity/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-multi-provider-continuity";
const RELATED = ["REL-R7"] as const;
const DETECTOR_ID = "repo-ai-multi-provider-continuity";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MULTI_PROVIDER_RE =
  /\b(multi[_-]?provider|alternate[_-]?provider|secondary[_-]?provider|backup[_-]?provider|dual[_-]?provider|provider[_-]?(failover|redundanc)|multi[_-]?cloud[_-]?(llm|model|ai))\b/i;

const CONTRACT_RE =
  /\b(contract|msa|sla|vendor[_-]?(agreement|contract)|commercial[_-]?term|procurement)\b/i;

const FAILOVER_TEST_RE =
  /\b(failover[_-]?test|provider[_-]?failover|alternate[_-]?path[_-]?test|cross[_-]?provider[_-]?test)\b/i;

export interface AiMultiProviderContinuityReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    multiProvider: { found: boolean; refs: string[] };
    contract: { found: boolean; refs: string[] };
    failoverTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    alternateProviderPathDocumented: boolean | null;
    failoverTestSucceededWithin180Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    continuitySignalsPresent: boolean;
    relR7Satisfied: boolean | null;
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
    extensions: [".md", ".txt", ".yml", ".yaml", ".json", ".pdf"],
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
): AiMultiProviderContinuityReport["importedResults"] {
  const sources: string[] = [];
  let alternateProviderPathDocumented: boolean | null = null;
  let failoverTestSucceededWithin180Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-multi-provider-continuity-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      alternateProviderPathDocumented =
        asBool(data.alternateProviderPathDocumented) ??
        asBool(data.alternate_provider_path_documented) ??
        asBool(data.multiProviderDocumented) ??
        asBool(data.contractualAlternateExists) ??
        alternateProviderPathDocumented;
      failoverTestSucceededWithin180Days =
        asBool(data.failoverTestSucceededWithin180Days) ??
        asBool(data.failover_test_succeeded_within_180_days) ??
        asBool(data.failoverTestPassed) ??
        asBool(data.failoverWithin180Days) ??
        failoverTestSucceededWithin180Days;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    alternateProviderPathDocumented,
    failoverTestSucceededWithin180Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiMultiProviderContinuityReport(opts: {
  assessedAt: string;
  multiProvider: { found: boolean; refs: string[] };
  contract: { found: boolean; refs: string[] };
  failoverTest: { found: boolean; refs: string[] };
  imported: AiMultiProviderContinuityReport["importedResults"];
}): AiMultiProviderContinuityReport {
  const notes: string[] = [];
  const continuitySignalsPresent =
    opts.multiProvider.found ||
    opts.contract.found ||
    opts.failoverTest.found;

  if (!continuitySignalsPresent && !opts.imported.found) {
    notes.push(
      "No multi-provider continuity signals — REL-R7 may be NOT_APPLICABLE if there are no Level-5 AI workloads.",
    );
  }
  if (opts.multiProvider.found) {
    notes.push(
      `Multi-provider refs: ${opts.multiProvider.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.contract.found) {
    notes.push(`Contract refs: ${opts.contract.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.failoverTest.found) {
    notes.push(
      `Failover-test refs: ${opts.failoverTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (documented=${opts.imported.alternateProviderPathDocumented}, failover180d=${opts.imported.failoverTestSucceededWithin180Days})`,
    );
  } else if (continuitySignalsPresent) {
    notes.push(
      "Multi-provider signals alone are PARTIAL — import alternateProviderPathDocumented=true + failoverTestSucceededWithin180Days=true (measuredAt ≤90d) under imports/ai-multi-provider-continuity/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const documentedOk = opts.imported.alternateProviderPathDocumented === true;
  const failoverOk = opts.imported.failoverTestSucceededWithin180Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiMultiProviderContinuityReport["summary"]["statusHint"];
  let relR7Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.alternateProviderPathDocumented === false ||
      opts.imported.failoverTestSucceededWithin180Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!continuitySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relR7Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relR7Satisfied = false;
    notes.push(
      "Imported evidence shows missing alternate provider/path docs, failed/absent failover test ≤180 days, or attest older than 90 days — REL-R7 fail.",
    );
  } else if (
    (continuitySignalsPresent || opts.imported.found) &&
    documentedOk &&
    failoverOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relR7Satisfied = true;
  } else if (continuitySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relR7Satisfied = false;
    if (opts.imported.found && !documentedOk) {
      notes.push("Import must show alternateProviderPathDocumented=true.");
    }
    if (opts.imported.found && !failoverOk) {
      notes.push(
        "Import must show failoverTestSucceededWithin180Days=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-R7 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    relR7Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      multiProvider: opts.multiProvider,
      contract: opts.contract,
      failoverTest: opts.failoverTest,
    },
    importedResults: opts.imported,
    summary: {
      continuitySignalsPresent,
      relR7Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiMultiProviderContinuityCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const multiProviderRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        MULTI_PROVIDER_RE.test(path) || MULTI_PROVIDER_RE.test(text),
      10,
    );
    const contractRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CONTRACT_RE.test(path) || CONTRACT_RE.test(text)) &&
        (MULTI_PROVIDER_RE.test(path + text) ||
          /provider|vendor|openai|anthropic|bedrock/i.test(path + text)),
      8,
    );
    const failoverRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        FAILOVER_TEST_RE.test(path) ||
        (/(test|spec|e2e|drill|report)/i.test(path) &&
          FAILOVER_TEST_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiMultiProviderContinuityReport({
      assessedAt: ctx.assessedAt.toISOString(),
      multiProvider: {
        found: multiProviderRefs.length > 0,
        refs: multiProviderRefs,
      },
      contract: { found: contractRefs.length > 0, refs: contractRefs },
      failoverTest: { found: failoverRefs.length > 0, refs: failoverRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-multi-provider-continuity-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-multi-provider-continuity-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-multi-provider-continuity",
          "rel-r7",
          DETECTOR_ID,
          ...(report.summary.relR7Satisfied ? ["rel-r7-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.multiProvider.refs,
        ...report.signals.contract.refs,
        ...report.signals.failoverTest.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-multi-provider-continuity-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-R7 status=${report.summary.statusHint} signals=${report.summary.continuitySignalsPresent} satisfied=${report.summary.relR7Satisfied}; report=imports/${PLUGIN_ID}/ai-multi-provider-continuity-report.json`,
      nodes,
    };
  },
};
