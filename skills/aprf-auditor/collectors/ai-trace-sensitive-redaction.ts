/**
 * ai-trace-sensitive-redaction — OBS-M2 / repo-ai-trace-sensitive-redaction.
 *
 * Discovers AI/OTel trace redaction or ACL for secrets/sensitive span fields.
 * Import paths:
 * - N/A: tracesContainSecretsOrSensitiveData=false
 * - PASS: tracesContainSecretsOrSensitiveData=true (or omitted with signals) +
 *   syntheticSensitiveFieldRedactionOrAclPct=100 + measuredAt ≤90d
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

const PLUGIN_ID = "ai-trace-sensitive-redaction";
const RELATED = ["OBS-M2"] as const;
const DETECTOR_ID = "repo-ai-trace-sensitive-redaction";
const IMPORT_MAX_AGE_DAYS = 90;
const REDACTION_PCT_MIN = 100;

const TRACE_REDACTION_RE =
  /\b(span[\s_-]*redact|trace[\s_-]*redact|attribute[\s_-]*processor|otel[\s_-]*redact|mask[\s_-]*span|scrub[\s_-]*span|sensitive[\s_-]*data[\s_-]*filter)\b/i;

const SENSITIVE_CLASS_RE =
  /\b(api[\s_-]*key|jwt|bearer|password|pii|phi|ssn|pan|credit[\s_-]*card|financial[\s_-]*data|secret|credential)\b/i;

const SYNTHETIC_TEST_RE =
  /\b(synthetic[\s_-]*(secret|pii|sensitive)|canary[\s_-]*(secret|pii)|sensitive[\s_-]*field[\s_-]*test|redact[\s_-]*test|assert[\s_-]*redact)\b/i;

const ACL_RE =
  /\b(trace[\s_-]*acl|span[\s_-]*acl|unauthorized[\s_-]*access|access[\s_-]*control[\s_-]*trace|deny[\s_-]*trace[\s_-]*read)\b/i;

export interface AiTraceSensitiveRedactionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    redaction: { found: boolean; refs: string[] };
    sensitiveClass: { found: boolean; refs: string[] };
    syntheticTest: { found: boolean; refs: string[] };
    acl: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    tracesContainSecretsOrSensitiveData: boolean | null;
    syntheticSensitiveFieldRedactionOrAclPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    controlSignalsPresent: boolean;
    obsM2Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  /** Customer-facing asks for REPORT.html "What you need next". */
  gapNotes: string[];
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
      ".ts",
      ".js",
      ".py",
      ".go",
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".tf",
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
): AiTraceSensitiveRedactionReport["importedResults"] {
  const sources: string[] = [];
  let tracesContainSecretsOrSensitiveData: boolean | null = null;
  let syntheticSensitiveFieldRedactionOrAclPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-trace-sensitive-redaction-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      tracesContainSecretsOrSensitiveData =
        asBool(data.tracesContainSecretsOrSensitiveData) ??
        asBool(data.traces_contain_secrets_or_sensitive_data) ??
        asBool(data.sensitiveDataInTraces) ??
        tracesContainSecretsOrSensitiveData;
      syntheticSensitiveFieldRedactionOrAclPct =
        asNum(data.syntheticSensitiveFieldRedactionOrAclPct) ??
        asNum(data.synthetic_sensitive_field_redaction_or_acl_pct) ??
        asNum(data.redactionOrAclPct) ??
        syntheticSensitiveFieldRedactionOrAclPct;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    tracesContainSecretsOrSensitiveData,
    syntheticSensitiveFieldRedactionOrAclPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTraceSensitiveRedactionReport(opts: {
  assessedAt: string;
  redaction: { found: boolean; refs: string[] };
  sensitiveClass: { found: boolean; refs: string[] };
  syntheticTest: { found: boolean; refs: string[] };
  acl: { found: boolean; refs: string[] };
  imported: AiTraceSensitiveRedactionReport["importedResults"];
}): AiTraceSensitiveRedactionReport {
  const notes: string[] = [];
  const gapNotes: string[] = [];
  const controlSignalsPresent =
    opts.redaction.found ||
    opts.sensitiveClass.found ||
    opts.syntheticTest.found ||
    opts.acl.found;

  if (!controlSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI trace sensitive-redaction signals — OBS-M2 may be not applicable if no production tracing is in scope, or if traces cannot carry secrets/sensitive data.",
    );
  }
  if (opts.redaction.found) {
    notes.push(`Redaction refs: ${opts.redaction.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.syntheticTest.found) {
    notes.push(
      `Synthetic-test refs: ${opts.syntheticTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.acl.found) {
    notes.push(`ACL refs: ${opts.acl.refs.slice(0, 2).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (sensitiveInTraces=${opts.imported.tracesContainSecretsOrSensitiveData}, redactionPct=${opts.imported.syntheticSensitiveFieldRedactionOrAclPct})`,
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const notInSensitiveScope =
    opts.imported.found &&
    opts.imported.tracesContainSecretsOrSensitiveData === false;
  const inSensitiveScope =
    opts.imported.tracesContainSecretsOrSensitiveData === true ||
    (opts.imported.tracesContainSecretsOrSensitiveData === null &&
      controlSignalsPresent);
  const redactionOk =
    opts.imported.syntheticSensitiveFieldRedactionOrAclPct !== null &&
    opts.imported.syntheticSensitiveFieldRedactionOrAclPct >= REDACTION_PCT_MIN;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiTraceSensitiveRedactionReport["summary"]["statusHint"];
  let obsM2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !notInSensitiveScope &&
    ((typeof opts.imported.syntheticSensitiveFieldRedactionOrAclPct ===
      "number" &&
      opts.imported.syntheticSensitiveFieldRedactionOrAclPct <
        REDACTION_PCT_MIN) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (notInSensitiveScope) {
    statusHint = "not_applicable";
    obsM2Satisfied = null;
    notes.push(
      "Imported attestation: traces cannot carry secrets/regulated sensitive data — OBS-M2 not applicable.",
    );
  } else if (!controlSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    obsM2Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    obsM2Satisfied = false;
    notes.push(
      "Imported evidence shows synthetic redaction/ACL below 100% or evidence older than 90 days — OBS-M2 fail.",
    );
    gapNotes.push(
      "Show that synthetic sensitive fields in traces are redacted or ACL-denied at 100%, with evidence measured within the last 90 days (place results under imports/ai-trace-sensitive-redaction/)",
    );
  } else if (
    (controlSignalsPresent || opts.imported.found) &&
    inSensitiveScope &&
    redactionOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    obsM2Satisfied = true;
  } else if (controlSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    obsM2Satisfied = false;
    if (!opts.imported.found && controlSignalsPresent) {
      gapNotes.push(
        "We found redaction or ACL controls for AI traces, but still need a recent measured result (within 90 days) showing 100% redaction or deny of synthetic sensitive fields — place it under imports/ai-trace-sensitive-redaction/",
      );
      gapNotes.push(
        "If production traces cannot contain secrets or regulated sensitive data, attest that under imports/ai-trace-sensitive-redaction/ so this check can be marked not applicable",
      );
    }
    if (opts.imported.found && opts.imported.tracesContainSecretsOrSensitiveData === null) {
      gapNotes.push(
        "Say whether production traces can contain secrets or regulated sensitive data (yes → measure redaction; no → mark not applicable)",
      );
    }
    if (opts.imported.found && !redactionOk) {
      gapNotes.push(
        "Show that synthetic sensitive fields in traces are redacted or ACL-denied at 100%",
      );
    }
    if (opts.imported.found && !importFresh) {
      gapNotes.push(
        "Refresh the redaction evidence so it was measured within the last 90 days",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    obsM2Satisfied = null;
    gapNotes.push(
      "Provide recent measured evidence of AI-trace sensitive-field redaction under imports/ai-trace-sensitive-redaction/, or attest that traces cannot carry secrets/sensitive data",
    );
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      redaction: opts.redaction,
      sensitiveClass: opts.sensitiveClass,
      syntheticTest: opts.syntheticTest,
      acl: opts.acl,
    },
    importedResults: opts.imported,
    summary: {
      controlSignalsPresent,
      obsM2Satisfied,
      statusHint,
    },
    gapNotes: gapNotes.slice(0, 8),
    notes,
  };
}

export const aiTraceSensitiveRedactionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const redaction = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        TRACE_REDACTION_RE.test(path) || TRACE_REDACTION_RE.test(text),
      10,
    );
    const sensitiveClass = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SENSITIVE_CLASS_RE.test(path) || SENSITIVE_CLASS_RE.test(text)) &&
        (/trace|otel|span|attribute/i.test(path + text) ||
          TRACE_REDACTION_RE.test(path + text)),
      8,
    );
    const syntheticTest = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SYNTHETIC_TEST_RE.test(path) || SYNTHETIC_TEST_RE.test(text),
      8,
    );
    const acl = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => ACL_RE.test(path) || ACL_RE.test(text),
      6,
    );

    const imported = loadImported(ctx);
    const report = buildAiTraceSensitiveRedactionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      redaction: { found: redaction.length > 0, refs: redaction },
      sensitiveClass: {
        found: sensitiveClass.length > 0,
        refs: sensitiveClass,
      },
      syntheticTest: { found: syntheticTest.length > 0, refs: syntheticTest },
      acl: { found: acl.length > 0, refs: acl },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-trace-sensitive-redaction-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-trace-sensitive-redaction-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-trace-sensitive-redaction",
          "obs-m2",
          DETECTOR_ID,
          ...(report.summary.obsM2Satisfied ? ["obs-m2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.redaction.refs,
        ...report.signals.sensitiveClass.refs,
        ...report.signals.syntheticTest.refs,
        ...report.signals.acl.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-trace-sensitive-redaction-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `OBS-M2 status=${report.summary.statusHint} signals=${report.summary.controlSignalsPresent} satisfied=${report.summary.obsM2Satisfied}; report=imports/${PLUGIN_ID}/ai-trace-sensitive-redaction-report.json`,
      nodes,
    };
  },
};
