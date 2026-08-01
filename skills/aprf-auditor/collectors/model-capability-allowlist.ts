/**
 * model-capability-allowlist — MOD-R2 / repo-model-capability-allowlist.
 *
 * Discovers per-workload model capability allowlists and deny evidence.
 * Import workloadsMissingCapabilityAllowlist=0 +
 * deniedCapabilityAttemptRecorded under imports/model-capability-allowlist/
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

const PLUGIN_ID = "model-capability-allowlist";
const RELATED = ["MOD-R2"] as const;
const DETECTOR_ID = "repo-model-capability-allowlist";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MODEL_PATH_RE =
  /(model|llm|openai|anthropic|bedrock|vertex|provider|inference|gateway)/i;

const ALLOWLIST_RE =
  /\b(capability[\s_-]*allowlist\w*|allowed[\s_-]*capabilit\w*|model[\s_-]*capabilit\w*|capabilit\w*[\s_-]*(allow|permit|bound)\w*)\b/i;

const CAPABILITY_RE =
  /\b(code[\s_-]*execution|vision|browsing|web[\s_-]*search|tool[\s_-]*calling|function[\s_-]*calling|computer[\s_-]*use|image[\s_-]*input)\b/i;

const DENY_RE =
  /\b(denied[\s_-]*capabilit\w*|capability[\s_-]*denied|block[\s_-]*capabilit\w*|forbid[\s_-]*capabilit\w*|deny[\s_-]*(vision|browsing|code[\s_-]*execution))\b/i;

export interface ModelCapabilityAllowlistReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    allowlist: { found: boolean; refs: string[] };
    capabilities: { found: boolean; refs: string[] };
    deny: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    workloadsMissingCapabilityAllowlist: number | null;
    deniedCapabilityAttemptRecorded: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelSignalsPresent: boolean;
    allowlistSignalsPresent: boolean;
    modR2Satisfied: boolean | null;
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
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

function detectModelSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        MODEL_PATH_RE.test(path) ||
        /\b(openai|anthropic|bedrock|vertexai|azure.?openai|llm)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ModelCapabilityAllowlistReport["importedResults"] {
  const sources: string[] = [];
  let workloadsMissingCapabilityAllowlist: number | null = null;
  let deniedCapabilityAttemptRecorded: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-capability-allowlist-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      workloadsMissingCapabilityAllowlist =
        asNum(data.workloadsMissingCapabilityAllowlist) ??
        asNum(data.workloads_missing_capability_allowlist) ??
        workloadsMissingCapabilityAllowlist;
      deniedCapabilityAttemptRecorded =
        asBool(data.deniedCapabilityAttemptRecorded) ??
        asBool(data.denied_capability_attempt_recorded) ??
        deniedCapabilityAttemptRecorded;

      const deniedCount =
        asNum(data.deniedCapabilityAttemptsInLast90Days) ??
        asNum(data.denied_capability_attempts_in_last_90_days);
      // Count is positive evidence: ≥1 always records true (do not let an
      // earlier explicit false block via ??).
      if (deniedCount !== null && deniedCount >= 1) {
        deniedCapabilityAttemptRecorded = true;
      } else if (
        deniedCount !== null &&
        deniedCapabilityAttemptRecorded === null
      ) {
        deniedCapabilityAttemptRecorded = false;
      }
      if (asBool(data.allWorkloadsHaveCapabilityAllowlist) === true) {
        workloadsMissingCapabilityAllowlist =
          workloadsMissingCapabilityAllowlist ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    workloadsMissingCapabilityAllowlist,
    deniedCapabilityAttemptRecorded,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelCapabilityAllowlistReport(opts: {
  assessedAt: string;
  allowlist: { found: boolean; refs: string[] };
  capabilities: { found: boolean; refs: string[] };
  deny: { found: boolean; refs: string[] };
  modelSignals: boolean;
  imported: ModelCapabilityAllowlistReport["importedResults"];
}): ModelCapabilityAllowlistReport {
  const notes: string[] = [];
  const allowlistSignalsPresent =
    opts.allowlist.found || opts.capabilities.found || opts.deny.found;

  if (!opts.modelSignals && !allowlistSignalsPresent && !opts.imported.found) {
    notes.push(
      "No model/capability signals — MOD-R2 may be NOT_APPLICABLE if models have no optional capabilities.",
    );
  }
  if (opts.allowlist.found) {
    notes.push(`Allowlist refs: ${opts.allowlist.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.capabilities.found) {
    notes.push(
      `Capability refs: ${opts.capabilities.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.deny.found) {
    notes.push(`Deny refs: ${opts.deny.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No denied-capability attempt signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingAllowlist=${opts.imported.workloadsMissingCapabilityAllowlist}, deniedRecorded=${opts.imported.deniedCapabilityAttemptRecorded})`,
    );
  } else if (allowlistSignalsPresent) {
    notes.push(
      "Allowlist signals alone are PARTIAL — import workloadsMissingCapabilityAllowlist=0 + deniedCapabilityAttemptRecorded=true (measuredAt ≤90d) under imports/model-capability-allowlist/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.workloadsMissingCapabilityAllowlist !== null &&
    opts.imported.workloadsMissingCapabilityAllowlist === 0;
  const denyOk = opts.imported.deniedCapabilityAttemptRecorded === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ModelCapabilityAllowlistReport["summary"]["statusHint"];
  let modR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.workloadsMissingCapabilityAllowlist !== null &&
      opts.imported.workloadsMissingCapabilityAllowlist > 0) ||
      opts.imported.deniedCapabilityAttemptRecorded === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.modelSignals && !allowlistSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    modR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    modR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing allowlists, no denied attempt recorded, or evidence older than 90 days — MOD-R2 fail.",
    );
  } else if (
    (allowlistSignalsPresent || opts.imported.found) &&
    coverageOk &&
    denyOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    modR2Satisfied = true;
  } else if (allowlistSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    modR2Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show workloadsMissingCapabilityAllowlist=0.");
    }
    if (opts.imported.found && !denyOk) {
      notes.push("Import must show deniedCapabilityAttemptRecorded=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock MOD-R2 PASS.",
      );
    }
  } else if (opts.modelSignals) {
    statusHint = "not_demonstrated";
    modR2Satisfied = null;
    notes.push(
      "Model signals present but no capability allowlist / deny evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    modR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      allowlist: opts.allowlist,
      capabilities: opts.capabilities,
      deny: opts.deny,
    },
    importedResults: opts.imported,
    summary: {
      modelSignalsPresent: opts.modelSignals,
      allowlistSignalsPresent,
      modR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelCapabilityAllowlistCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelSignals = detectModelSignals(ctx.targetPath, maxFiles);

    const allowlistRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ALLOWLIST_RE.test(path) || ALLOWLIST_RE.test(text),
      12,
    );
    const capabilityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ALLOWLIST_RE.test(path) || MODEL_PATH_RE.test(path)) &&
        (CAPABILITY_RE.test(text) || CAPABILITY_RE.test(path)),
      12,
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DENY_RE.test(path) || DENY_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelCapabilityAllowlistReport({
      assessedAt: ctx.assessedAt.toISOString(),
      allowlist: { found: allowlistRefs.length > 0, refs: allowlistRefs },
      capabilities: { found: capabilityRefs.length > 0, refs: capabilityRefs },
      deny: { found: denyRefs.length > 0, refs: denyRefs },
      modelSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-capability-allowlist-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/model-capability-allowlist-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "model-capability-allowlist",
          "mod-r2",
          DETECTOR_ID,
          ...(report.summary.modR2Satisfied ? ["mod-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.allowlist.refs,
        ...report.signals.capabilities.refs,
        ...report.signals.deny.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["model-capability-allowlist-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MOD-R2 status=${report.summary.statusHint} allowlist=${report.summary.allowlistSignalsPresent} satisfied=${report.summary.modR2Satisfied}; report=imports/${PLUGIN_ID}/model-capability-allowlist-report.json`,
      nodes,
    };
  },
};
