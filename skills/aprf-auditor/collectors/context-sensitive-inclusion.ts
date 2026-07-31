/**
 * context-sensitive-inclusion — CTX-M3 / repo-context-sensitive-inclusion.
 *
 * Discovers sensitive-class inclusion policies + strip/block tests.
 * Import sensitiveClassesEnumerated + allowDenyRulesPresent +
 * blockOrStripRatePct≥95 under imports/context-sensitive-inclusion/ to PASS.
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

const PLUGIN_ID = "context-sensitive-inclusion";
const RELATED = ["CTX-M3"] as const;
const DETECTOR_ID = "repo-context-sensitive-inclusion";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_BLOCK_RATE_PCT = 95;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CTX_PATH_RE =
  /(context|prompt|rag|assembl|dlp|redact|secret|pii|regulated)/i;

const POLICY_RE =
  /\b(inclusion[\s_-]*polic|sensitive[\s_-]*(class|context|data)|data[\s_-]*class|allow[\s_-]*deny|deny[\s_-]*list|allowlist|blocklist|context[\s_-]*polic)\b/i;

const ENFORCE_RE =
  /\b(strip|block|redact|dlp|filter[_-]?out|remove[_-]?(secret|pii|sensitive)|disallow)\b/i;

const FIXTURE_TEST_RE =
  /\b(fixture|sensitive[_-]?class|secret[_-]?(fixture|inject)|pii[_-]?fixture|block[_-]?rate|strip[_-]?rate)\b/i;

export interface ContextSensitiveInclusionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    policy: { found: boolean; refs: string[] };
    enforcement: { found: boolean; refs: string[] };
    fixtureTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sensitiveClassesEnumerated: boolean | null;
    allowDenyRulesPresent: boolean | null;
    blockOrStripRatePct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    contextSignalsPresent: boolean;
    policySignalsPresent: boolean;
    ctxM3Satisfied: boolean | null;
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

function detectContextSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CTX_PATH_RE.test(path) ||
        /\b(context[_-]?assembl|build[_-]?messages|rag|retriev|prompt)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): ContextSensitiveInclusionReport["importedResults"] {
  const sources: string[] = [];
  let sensitiveClassesEnumerated: boolean | null = null;
  let allowDenyRulesPresent: boolean | null = null;
  let blockOrStripRatePct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/context-sensitive-inclusion-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      sensitiveClassesEnumerated =
        asBool(data.sensitiveClassesEnumerated) ??
        asBool(data.sensitive_classes_enumerated) ??
        sensitiveClassesEnumerated;
      allowDenyRulesPresent =
        asBool(data.allowDenyRulesPresent) ??
        asBool(data.allow_deny_rules_present) ??
        allowDenyRulesPresent;
      blockOrStripRatePct =
        asNum(data.blockOrStripRatePct) ??
        asNum(data.block_or_strip_rate_pct) ??
        asNum(data.stripRatePct) ??
        blockOrStripRatePct;

      if (asBool(data.policyComplete) === true) {
        sensitiveClassesEnumerated = true;
        allowDenyRulesPresent = true;
      }
      if (asBool(data.meetsBlockThreshold) === true && blockOrStripRatePct === null) {
        blockOrStripRatePct = MIN_BLOCK_RATE_PCT;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sensitiveClassesEnumerated,
    allowDenyRulesPresent,
    blockOrStripRatePct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildContextSensitiveInclusionReport(opts: {
  assessedAt: string;
  policy: { found: boolean; refs: string[] };
  enforcement: { found: boolean; refs: string[] };
  fixtureTests: { found: boolean; refs: string[] };
  contextSignals: boolean;
  imported: ContextSensitiveInclusionReport["importedResults"];
}): ContextSensitiveInclusionReport {
  const notes: string[] = [];
  const policySignalsPresent = opts.policy.found;

  if (!opts.contextSignals && !policySignalsPresent && !opts.imported.found) {
    notes.push(
      "No context/sensitive-inclusion signals — CTX-M3 may be NOT_APPLICABLE if context cannot carry secrets/regulated data.",
    );
  }
  if (policySignalsPresent) {
    notes.push(`Policy refs: ${opts.policy.refs.slice(0, 4).join(", ")}`);
  } else {
    notes.push("No sensitive-class inclusion policy signals found.");
  }
  if (opts.enforcement.found) {
    notes.push(
      `Enforcement refs: ${opts.enforcement.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.fixtureTests.found) {
    notes.push(
      `Fixture-test refs: ${opts.fixtureTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (enumerated=${opts.imported.sensitiveClassesEnumerated}, allowDeny=${opts.imported.allowDenyRulesPresent}, blockRate=${opts.imported.blockOrStripRatePct})`,
    );
  } else if (policySignalsPresent) {
    notes.push(
      "Policy signals alone are PARTIAL — import sensitiveClassesEnumerated + allowDenyRulesPresent + blockOrStripRatePct≥95 (measuredAt ≤90d) under imports/context-sensitive-inclusion/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const policyOk =
    opts.imported.sensitiveClassesEnumerated === true &&
    opts.imported.allowDenyRulesPresent === true;
  const rateOk =
    opts.imported.blockOrStripRatePct !== null &&
    opts.imported.blockOrStripRatePct >= MIN_BLOCK_RATE_PCT;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: ContextSensitiveInclusionReport["summary"]["statusHint"] =
    "not_demonstrated";
  let ctxM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.sensitiveClassesEnumerated === false ||
      opts.imported.allowDenyRulesPresent === false ||
      (opts.imported.blockOrStripRatePct !== null &&
        opts.imported.blockOrStripRatePct < MIN_BLOCK_RATE_PCT) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.contextSignals && !policySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    ctxM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    ctxM3Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete policy, block/strip rate below 95%, or evidence older than 90 days — CTX-M3 fail.",
    );
  } else if (
    policySignalsPresent &&
    policyOk &&
    rateOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    ctxM3Satisfied = true;
  } else if (
    policySignalsPresent ||
    opts.enforcement.found ||
    opts.fixtureTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    ctxM3Satisfied = false;
    if (opts.imported.found && !policyOk) {
      notes.push(
        "Import must show sensitiveClassesEnumerated=true and allowDenyRulesPresent=true.",
      );
    }
    if (opts.imported.found && !rateOk) {
      notes.push("Import must show blockOrStripRatePct≥95.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CTX-M3 PASS.",
      );
    }
  } else if (opts.contextSignals) {
    statusHint = "not_demonstrated";
    ctxM3Satisfied = null;
    notes.push(
      "Context signals present but no sensitive-inclusion policy or enforcement evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    ctxM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      policy: opts.policy,
      enforcement: opts.enforcement,
      fixtureTests: opts.fixtureTests,
    },
    importedResults: opts.imported,
    summary: {
      contextSignalsPresent: opts.contextSignals,
      policySignalsPresent,
      ctxM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const contextSensitiveInclusionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const contextSignals = detectContextSignals(ctx.targetPath, maxFiles);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!POLICY_RE.test(path) && !POLICY_RE.test(text)) return false;
        return (
          CTX_PATH_RE.test(path) ||
          CTX_PATH_RE.test(text) ||
          POLICY_RE.test(path)
        );
      },
    );
    const enforceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CTX_PATH_RE.test(path) || CTX_PATH_RE.test(text) || POLICY_RE.test(text)) &&
        ENFORCE_RE.test(text),
      12,
    );
    const fixtureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        /(test|spec|e2e|fixture)/i.test(path) &&
        (POLICY_RE.test(text) || ENFORCE_RE.test(text) || CTX_PATH_RE.test(text)) &&
        FIXTURE_TEST_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildContextSensitiveInclusionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      policy: { found: policyRefs.length > 0, refs: policyRefs },
      enforcement: { found: enforceRefs.length > 0, refs: enforceRefs },
      fixtureTests: { found: fixtureRefs.length > 0, refs: fixtureRefs },
      contextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "context-sensitive-inclusion-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/context-sensitive-inclusion-report.json`,
        signals: [
          "context-sensitive-inclusion",
          "ctx-m3",
          DETECTOR_ID,
          ...(report.summary.ctxM3Satisfied ? ["ctx-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of report.signals.policy.refs.slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:policy:${r}`,
        class: "docs",
        ref: r,
        signals: ["context-sensitive-inclusion-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      detail: `CTX-M3 status=${report.summary.statusHint} policy=${report.summary.policySignalsPresent} satisfied=${report.summary.ctxM3Satisfied}; report=imports/${PLUGIN_ID}/context-sensitive-inclusion-report.json`,
      nodes,
    };
  },
};
