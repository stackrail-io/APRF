/**
 * secret-redaction — SEC2-M2 / repo-secret-redaction.
 *
 * Discovers log/trace redaction config and synthetic secret-injection canary
 * tests. Import harness under imports/secret-redaction/ unlocks PASS
 * (measuredAt ≤90d). Config alone ≠ PASS.
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
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "secret-redaction";
const RELATED = ["SEC2-M2"] as const;
const DETECTOR_ID = "repo-secret-redaction";
const IMPORT_MAX_AGE_DAYS = 90;

const REDACTION_CONFIG_RE =
  /\b(redact|redaction|mask_secret|masking|sanitize_log|scrub_secret|secret.?filter|SensitiveDataFilter|AttributeProcessor|filter_span|log.?scrub|PII.?filter|credential.?mask)\b/i;

/** Exclude LLM “redacted_thinking” and UI copy that is not log redaction. */
const FALSE_POSITIVE_RE =
  /\b(redacted_thinking|thinking.?block|censored.?content)\b/i;

const CANARY_TEST_RE =
  /\b(canary|synthetic.?secret|secret.?injection|inject.*(?:api.?key|bearer|AKIA)|redact.*(?:test|harness|assert)|assert.*redact)/i;

const TEST_FILE_RE =
  /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)|[._-](test|spec)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

export interface SecretRedactionReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  redactionConfig: {
    found: boolean;
    refs: string[];
  };
  canaryTests: {
    found: boolean;
    refs: string[];
  };
  importedResults: {
    found: boolean;
    productionLoggingOrTracingPipelinesPresent: boolean | null;
    redactionConfigPresent: boolean | null;
    detectionRatePct: number | null;
    caseCount: number | null;
    canaryCoversApiKeyBearerAndAwsKeyPatterns: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    redactionConfigPresent: boolean;
    canaryTestPresent: boolean;
    detectionRatePct: number | null;
    gateSignalsPresent: boolean;
    sec2M2Satisfied: boolean | null;
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

function looksLikeLogRedaction(text: string, path: string): boolean {
  if (!REDACTION_CONFIG_RE.test(text) && !REDACTION_CONFIG_RE.test(path)) {
    return false;
  }
  if (
    FALSE_POSITIVE_RE.test(text) &&
    !/\b(log|trace|otel|span|logger)\b/i.test(text)
  ) {
    return false;
  }
  return (
    /\b(log|logger|logging|trace|tracing|otel|opentelemetry|span|spanprocessor|telemetry)\b/i.test(
      text + " " + path,
    ) ||
    /\b(redact|mask_secret|SensitiveDataFilter|AttributeProcessor)\b/i.test(
      text,
    )
  );
}

function detectRedactionConfig(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".py",
      ".ts",
      ".js",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".go",
      ".rs",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    if (
      /redact|scrub|mask.?secret|sensitive.?data/i.test(basename(f)) &&
      !/thinking/i.test(basename(f))
    ) {
      const text = readText(f, 80_000) || "";
      if (looksLikeLogRedaction(text || "log", r)) {
        refs.push(r);
        continue;
      }
    }
    const text = readText(f, 120_000);
    if (!text) continue;
    if (looksLikeLogRedaction(text, r)) refs.push(r);
    if (refs.length >= 16) break;
  }
  return { found: refs.length > 0, refs: [...new Set(refs)].slice(0, 16) };
}

function detectCanaryTests(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".go"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    if (!TEST_FILE_RE.test(f) && !CANARY_TEST_RE.test(r)) continue;
    const text = readText(f, 300_000);
    if (!text) continue;
    if (CANARY_TEST_RE.test(text) || CANARY_TEST_RE.test(r)) {
      if (
        REDACTION_CONFIG_RE.test(text) ||
        /\b(log|trace|span|otel)\b/i.test(text)
      ) {
        refs.push(r);
      } else if (CANARY_TEST_RE.test(text)) {
        refs.push(r);
      }
    }
    if (refs.length >= 16) break;
  }
  return { found: refs.length > 0, refs: [...new Set(refs)].slice(0, 16) };
}

function loadImported(
  ctx: CollectorContext,
): SecretRedactionReport["importedResults"] {
  const sources: string[] = [];
  let productionLoggingOrTracingPipelinesPresent: boolean | null = null;
  let redactionConfigPresent: boolean | null = null;
  let detectionRatePct: number | null = null;
  let caseCount: number | null = null;
  let canaryCoversApiKeyBearerAndAwsKeyPatterns: boolean | null = null;
  let measuredAt: string | null = null;

  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.json$/i.test(file)) continue;
    if (/secret-redaction-report\.json$/i.test(file)) continue;
    const text = readText(file, 2_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(file));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));

      productionLoggingOrTracingPipelinesPresent = mergeOrBool(
        productionLoggingOrTracingPipelinesPresent,
        asBool(data.productionLoggingOrTracingPipelinesPresent) ??
          asBool(data.production_logging_or_tracing_pipelines_present) ??
          asBool(data.loggingOrTracingPresent),
      );
      redactionConfigPresent = mergeAndBool(
        redactionConfigPresent,
        asBool(data.redactionConfigPresent) ??
          asBool(data.redaction_config_present) ??
          asBool(data.configPresent),
      );
      canaryCoversApiKeyBearerAndAwsKeyPatterns = mergeAndBool(
        canaryCoversApiKeyBearerAndAwsKeyPatterns,
        asBool(data.canaryCoversApiKeyBearerAndAwsKeyPatterns) ??
          asBool(data.canary_covers_api_key_bearer_and_aws_key_patterns) ??
          asBool(data.coversApiKeyBearerAwsPatterns),
      );

      // PASS requires measured cases/results. Bare detectionRatePct=100 does not
      // unlock; bare rate <100 still counts as fail evidence.
      const cases = Array.isArray(data.cases)
        ? (data.cases as Array<Record<string, unknown>>)
        : Array.isArray(data.results)
          ? (data.results as Array<Record<string, unknown>>)
          : [];
      const rate =
        asNum(data.detectionRatePct) ??
        (typeof data.detection_rate === "number"
          ? data.detection_rate <= 1
            ? data.detection_rate * 100
            : data.detection_rate
          : null);
      if (cases.length) {
        caseCount = (caseCount ?? 0) + cases.length;
        const detected = cases.filter((c) => {
          const r = String(c.result || c.status || "").toLowerCase();
          return (
            c.redacted === true ||
            c.detected === true ||
            c.ok === true ||
            r === "pass" ||
            r === "redacted" ||
            r === "ok"
          );
        }).length;
        const computed = (detected / cases.length) * 100;
        detectionRatePct = mergeMinNum(detectionRatePct, computed);
        detectionRatePct = mergeMinNum(detectionRatePct, rate);
      } else if (rate !== null && rate < 100) {
        detectionRatePct = mergeMinNum(detectionRatePct, rate);
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionLoggingOrTracingPipelinesPresent,
    redactionConfigPresent,
    detectionRatePct,
    caseCount,
    canaryCoversApiKeyBearerAndAwsKeyPatterns,
    measuredAt,
    sources,
  };
}

export function buildSecretRedactionReport(opts: {
  assessedAt: string;
  config: { found: boolean; refs: string[] };
  canary: { found: boolean; refs: string[] };
  imported: SecretRedactionReport["importedResults"];
}): SecretRedactionReport {
  const notes: string[] = [];
  const gateSignalsPresent = opts.config.found || opts.canary.found;
  const surfaceProvedForNaOverride = opts.config.found || opts.canary.found;
  const redactionConfigPresent =
    opts.config.found || opts.imported.redactionConfigPresent === true;
  // Any import JSON is not canary evidence — require measured cases/results
  // (or in-repo canary harness refs).
  const canaryTestPresent =
    opts.canary.found || (opts.imported.caseCount ?? 0) > 0;
  const detectionRatePct = opts.imported.detectionRatePct;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No secret-redaction signals — SEC2-M2 remains not demonstrated until redaction config + canary harness evidence or an explicit N/A attest (productionLoggingOrTracingPipelinesPresent=false) is imported.",
    );
  }
  if (opts.config.found) {
    notes.push(
      `Redaction/masking config found (e.g. ${opts.config.refs.slice(0, 3).join(", ")}); config alone does not satisfy SEC2-M2.`,
    );
  } else if (!redactionConfigPresent) {
    notes.push(
      "No logging/tracing secret-redaction config found (filters, scrubbers, OTel processors).",
    );
  }
  if (opts.canary.found) {
    notes.push(
      `Canary/redaction tests: ${opts.canary.refs.slice(0, 3).join(", ")}; tests alone do not prove measured 100% detection.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.productionLoggingOrTracingPipelinesPresent}, config=${opts.imported.redactionConfigPresent}, detectionRatePct=${detectionRatePct}, cases=${opts.imported.caseCount}, coversPatterns=${opts.imported.canaryCoversApiKeyBearerAndAwsKeyPatterns}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import non-empty cases/results plus detectionRatePct=100 + canaryCoversApiKeyBearerAndAwsKeyPatterns=true (measuredAt ≤90d) under imports/secret-redaction/ to PASS. Set productionLoggingOrTracingPipelinesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const configOk = redactionConfigPresent;
  const rateOk = detectionRatePct === 100;
  const coversOk =
    opts.imported.canaryCoversApiKeyBearerAndAwsKeyPatterns === true;
  const casesOk = (opts.imported.caseCount ?? 0) > 0;

  let statusHint: SecretRedactionReport["summary"]["statusHint"];
  let sec2M2Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((detectionRatePct !== null && detectionRatePct < 100) ||
      opts.imported.canaryCoversApiKeyBearerAndAwsKeyPatterns === false ||
      (opts.imported.redactionConfigPresent === false && !opts.config.found));

  if (explicitFail) {
    statusHint = "fail";
    sec2M2Satisfied = false;
    if (
      opts.imported.productionLoggingOrTracingPipelinesPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(
        "Imported productionLoggingOrTracingPipelinesPresent=false ignored — in-repo redaction/canary signals prove the surface exists.",
      );
    }
    notes.push(
      "Imported evidence shows detectionRatePct<100, missing pattern coverage, or missing redaction config — SEC2-M2 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.productionLoggingOrTracingPipelinesPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2M2Satisfied = null;
    notes.push(
      "Imported productionLoggingOrTracingPipelinesPresent=false — SEC2-M2 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionLoggingOrTracingPipelinesPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionLoggingOrTracingPipelinesPresent=false ignored — in-repo redaction/canary signals prove the surface exists.",
    );
    if (
      configOk &&
      canaryTestPresent &&
      casesOk &&
      rateOk &&
      coversOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2M2Satisfied = true;
    } else {
      statusHint = "partial";
      sec2M2Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2M2Satisfied = null;
  } else if (
    configOk &&
    canaryTestPresent &&
    casesOk &&
    rateOk &&
    coversOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sec2M2Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2M2Satisfied = false;
    if (opts.imported.found && !configOk) {
      notes.push(
        "PASS requires redaction config (in-repo or redactionConfigPresent=true).",
      );
    }
    if (opts.imported.found && !casesOk) {
      notes.push(
        "Import must include non-empty cases/results (bare detectionRatePct does not prove a measured canary).",
      );
    }
    if (opts.imported.found && !rateOk) {
      notes.push("Import must show detectionRatePct=100 from measured cases.");
    }
    if (opts.imported.found && !coversOk) {
      notes.push(
        "Import must show canaryCoversApiKeyBearerAndAwsKeyPatterns=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC2-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2M2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    redactionConfig: {
      found: redactionConfigPresent,
      refs: opts.config.refs,
    },
    canaryTests: {
      found: opts.canary.found,
      refs: opts.canary.refs,
    },
    importedResults: opts.imported,
    summary: {
      redactionConfigPresent,
      canaryTestPresent,
      detectionRatePct,
      gateSignalsPresent,
      sec2M2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const secretRedactionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const config = detectRedactionConfig(ctx.targetPath, ctx.maxFiles ?? 4000);
    const canary = detectCanaryTests(ctx.targetPath, ctx.maxFiles ?? 4000);
    const imported = loadImported(ctx);

    const report = buildSecretRedactionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      config,
      canary,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "secret-redaction-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/secret-redaction-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "secret-redaction",
          "sec2-m2",
          DETECTOR_ID,
          ...(report.redactionConfig.found ? ["redaction-config"] : []),
          ...(report.canaryTests.found || report.importedResults.found
            ? ["canary-redaction-test"]
            : []),
          ...(report.summary.sec2M2Satisfied
            ? ["sec2-m2-satisfied"]
            : ["sec2-m2-fail-or-incomplete"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    if (config.found) {
      nodes.push({
        id: `${PLUGIN_ID}:config`,
        class: "code",
        ref: config.refs[0],
        excerpt: redact(
          `Redaction config refs: ${config.refs.slice(0, 6).join(", ")}`,
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["redaction-config", "sec2-m2"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-M2 status=${report.summary.statusHint} config=${report.summary.redactionConfigPresent} canary=${report.summary.canaryTestPresent} rate=${report.summary.detectionRatePct} satisfied=${report.summary.sec2M2Satisfied}; report=imports/${PLUGIN_ID}/secret-redaction-report.json`,
      nodes,
    };
  },
};
