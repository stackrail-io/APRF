/**
 * ai-exfil-detection — SEC-R3 / repo-ai-exfil-detection.
 *
 * Discovers canary/honeytoken OR equivalent DLP/SIEM/UEBA/egress exfil detection
 * for sensitive AI contexts. Import sensitiveAiContextsExfilDetectionConfigured +
 * detectionMechanismCoversSensitiveAiPaths +
 * latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses
 * under imports/ai-exfil-detection/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-exfil-detection";
const RELATED = ["SEC-R3"] as const;
const DETECTOR_ID = "repo-ai-exfil-detection";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CANARY_RE =
  /\b(canary[_-]?(token|tripwire|string)|honeytoken|honey[_-]?token|tripwire)\b/i;

const DLP_SIEM_RE =
  /\b(dlp|data[_-]?loss[_-]?prevention|siem|ueba|guardduty|cloudtrail|purview|insider[_-]?risk|sentinel|exfiltrat(e|ion)[_-]?(detect|alert|monitor)|egress[_-]?(monitor|alert))\b/i;

const SENSITIVE_AI_RE =
  /\b(sensitive[_-]?(ai|prompt|context|corpus)|prompt[_-]?exfil|tool[_-]?exfil|ai[_-]?exfiltrat)\b/i;

const VALIDATION_RE =
  /\b((detection|canary|dlp|exfil)[_-]?(test|validation|drill|exercise)|silent[_-]?miss|expected[_-]?alert)\b/i;

export interface AiExfilDetectionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    canary: { found: boolean; refs: string[] };
    dlpSiem: { found: boolean; refs: string[] };
    sensitiveAi: { found: boolean; refs: string[] };
    validation: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sensitiveAiContextsExfilDetectionConfigured: boolean | null;
    detectionMechanismCoversSensitiveAiPaths: boolean | null;
    latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses:
      | boolean
      | null;
    mechanismClass: string | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secR3Satisfied: boolean | null;
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

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
): AiExfilDetectionReport["importedResults"] {
  const sources: string[] = [];
  let sensitiveAiContextsExfilDetectionConfigured: boolean | null = null;
  let detectionMechanismCoversSensitiveAiPaths: boolean | null = null;
  let latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses:
    | boolean
    | null = null;
  let mechanismClass: string | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-exfil-detection-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      mechanismClass =
        asStr(data.mechanismClass) ??
        asStr(data.mechanism_class) ??
        asStr(data.detectionMechanismClass) ??
        mechanismClass;
      sensitiveAiContextsExfilDetectionConfigured =
        asBool(data.sensitiveAiContextsExfilDetectionConfigured) ??
        asBool(data.sensitive_ai_contexts_exfil_detection_configured) ??
        asBool(data.exfilDetectionConfigured) ??
        sensitiveAiContextsExfilDetectionConfigured;
      detectionMechanismCoversSensitiveAiPaths =
        asBool(data.detectionMechanismCoversSensitiveAiPaths) ??
        asBool(data.detection_mechanism_covers_sensitive_ai_paths) ??
        asBool(data.coversSensitiveAiPaths) ??
        detectionMechanismCoversSensitiveAiPaths;
      latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses =
        asBool(
          data.latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses,
        ) ??
        asBool(
          data.latest_detection_validation_within_90_days_with_expected_alerts_or_zero_silent_misses,
        ) ??
        asBool(data.validationWithin90DaysExpectedAlerts) ??
        asBool(data.zeroSilentMisses) ??
        latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sensitiveAiContextsExfilDetectionConfigured,
    detectionMechanismCoversSensitiveAiPaths,
    latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses,
    mechanismClass,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiExfilDetectionReport(opts: {
  assessedAt: string;
  canary: { found: boolean; refs: string[] };
  dlpSiem: { found: boolean; refs: string[] };
  sensitiveAi: { found: boolean; refs: string[] };
  validation: { found: boolean; refs: string[] };
  imported: AiExfilDetectionReport["importedResults"];
}): AiExfilDetectionReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.canary.found ||
    opts.dlpSiem.found ||
    opts.sensitiveAi.found ||
    opts.validation.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI exfil-detection signals — SEC-R3 may be NOT_APPLICABLE if there are no sensitive AI contexts.",
    );
  }
  if (opts.canary.found) {
    notes.push(
      `Canary/honeytoken refs: ${opts.canary.refs.slice(0, 3).join(", ")} (acceptable mechanism; not required alone)`,
    );
  }
  if (opts.dlpSiem.found) {
    notes.push(
      `DLP/SIEM/UEBA/equivalent refs: ${opts.dlpSiem.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.sensitiveAi.found) {
    notes.push(
      `Sensitive-AI refs: ${opts.sensitiveAi.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (configured=${opts.imported.sensitiveAiContextsExfilDetectionConfigured}, covers=${opts.imported.detectionMechanismCoversSensitiveAiPaths}, validated=${opts.imported.latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses}, class=${opts.imported.mechanismClass})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Detection signals alone are PARTIAL — import sensitiveAiContextsExfilDetectionConfigured=true + detectionMechanismCoversSensitiveAiPaths=true + latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses=true (measuredAt ≤90d) under imports/ai-exfil-detection/ to PASS. mechanismClass may name canary, dlp, siem, ueba, or equivalent.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const configuredOk =
    opts.imported.sensitiveAiContextsExfilDetectionConfigured === true;
  const coversOk =
    opts.imported.detectionMechanismCoversSensitiveAiPaths === true;
  const validatedOk =
    opts.imported
      .latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses ===
    true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiExfilDetectionReport["summary"]["statusHint"];
  let secR3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.sensitiveAiContextsExfilDetectionConfigured === false ||
      opts.imported.detectionMechanismCoversSensitiveAiPaths === false ||
      opts.imported
        .latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses ===
        false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    secR3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing detection config/coverage, failed validation, or attest older than 90 days — SEC-R3 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    configuredOk &&
    coversOk &&
    validatedOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secR3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secR3Satisfied = false;
    if (opts.imported.found && !configuredOk) {
      notes.push(
        "Import must show sensitiveAiContextsExfilDetectionConfigured=true.",
      );
    }
    if (opts.imported.found && !coversOk) {
      notes.push(
        "Import must show detectionMechanismCoversSensitiveAiPaths=true.",
      );
    }
    if (opts.imported.found && !validatedOk) {
      notes.push(
        "Import must show latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-R3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secR3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      canary: opts.canary,
      dlpSiem: opts.dlpSiem,
      sensitiveAi: opts.sensitiveAi,
      validation: opts.validation,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiExfilDetectionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const canaryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CANARY_RE.test(path) || CANARY_RE.test(text),
      10,
    );
    const dlpRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DLP_SIEM_RE.test(path) || DLP_SIEM_RE.test(text),
      10,
    );
    const sensitiveRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SENSITIVE_AI_RE.test(path) || SENSITIVE_AI_RE.test(text),
      10,
    );
    const validationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => VALIDATION_RE.test(path) || VALIDATION_RE.test(text),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildAiExfilDetectionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      canary: { found: canaryRefs.length > 0, refs: canaryRefs },
      dlpSiem: { found: dlpRefs.length > 0, refs: dlpRefs },
      sensitiveAi: { found: sensitiveRefs.length > 0, refs: sensitiveRefs },
      validation: { found: validationRefs.length > 0, refs: validationRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-exfil-detection-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: `imports/${PLUGIN_ID}/ai-exfil-detection-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-exfil-detection",
          "sec-r3",
          DETECTOR_ID,
          ...(report.summary.secR3Satisfied ? ["sec-r3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.canary.refs,
        ...report.signals.dlpSiem.refs,
        ...report.signals.sensitiveAi.refs,
        ...report.signals.validation.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "runtime",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-exfil-detection-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-R3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secR3Satisfied}; report=imports/${PLUGIN_ID}/ai-exfil-detection-report.json`,
      nodes,
    };
  },
};
