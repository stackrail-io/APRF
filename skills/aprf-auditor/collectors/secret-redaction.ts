/**
 * secret-redaction — SEC2-M2 detector executor.
 *
 * Looks for log/trace redaction config and synthetic secret-injection canary
 * tests. Code filters alone ≠ PASS — passCondition requires 100% canary detection.
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

const PLUGIN_ID = "secret-redaction";
const RELATED = ["SEC2-M2"] as const;

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
  importedHarness: {
    found: boolean;
    detectionRatePct: number | null;
    caseCount: number | null;
    sources: string[];
  };
  summary: {
    redactionConfigPresent: boolean;
    canaryTestPresent: boolean;
    detectionRatePct: number | null;
    /** true iff config + canary evidence with 100% detection */
    sec2M2Satisfied: boolean | null;
    statusHint: "pass" | "partial" | "fail" | "not_demonstrated";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
}

function looksLikeLogRedaction(text: string, path: string): boolean {
  if (!REDACTION_CONFIG_RE.test(text) && !REDACTION_CONFIG_RE.test(path)) {
    return false;
  }
  // Skip pure LLM thinking redaction files
  if (FALSE_POSITIVE_RE.test(text) && !/\b(log|trace|otel|span|logger)\b/i.test(text)) {
    return false;
  }
  return (
    /\b(log|logger|logging|trace|tracing|otel|opentelemetry|span|spanprocessor|exporter)\b/i.test(
      text + " " + path,
    ) ||
    /\b(redact|mask_secret|SensitiveDataFilter|AttributeProcessor)\b/i.test(text)
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
      // Prefer tests that also mention redact/log/trace
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

function loadImportedHarness(ctx: CollectorContext): {
  found: boolean;
  detectionRatePct: number | null;
  caseCount: number | null;
  sources: string[];
} {
  const sources: string[] = [];
  let detectionRatePct: number | null = null;
  let caseCount: number | null = null;

  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.json$/i.test(file)) continue;
    if (/secret-redaction-report\.json$/i.test(file)) continue;
    const text = readText(file, 2_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(rel(ctx.outputDir, file));

      if (typeof data.detectionRatePct === "number") {
        detectionRatePct = data.detectionRatePct;
      } else if (typeof data.detection_rate === "number") {
        detectionRatePct =
          data.detection_rate <= 1
            ? data.detection_rate * 100
            : data.detection_rate;
      }

      const cases =
        (data.cases as Array<Record<string, unknown>>) ||
        (data.results as Array<Record<string, unknown>>) ||
        [];
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
        const rate = (detected / cases.length) * 100;
        detectionRatePct =
          detectionRatePct === null
            ? rate
            : Math.min(detectionRatePct, rate);
      }

      if (
        typeof data.caseCount === "number" &&
        caseCount === null
      ) {
        caseCount = data.caseCount;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    detectionRatePct,
    caseCount,
    sources,
  };
}

export function buildSecretRedactionReport(opts: {
  assessedAt: string;
  config: { found: boolean; refs: string[] };
  canary: { found: boolean; refs: string[] };
  imported: {
    found: boolean;
    detectionRatePct: number | null;
    caseCount: number | null;
    sources: string[];
  };
}): SecretRedactionReport {
  const notes: string[] = [];
  const redactionConfigPresent = opts.config.found;
  const canaryTestPresent = opts.canary.found || opts.imported.found;
  const detectionRatePct = opts.imported.detectionRatePct;

  if (redactionConfigPresent) {
    notes.push(
      `Redaction/masking config found (e.g. ${opts.config.refs.slice(0, 3).join(", ")}); config alone does not satisfy SEC2-M2.`,
    );
  } else {
    notes.push(
      "No logging/tracing secret-redaction config found (filters, scrubbers, OTel processors).",
    );
  }

  if (opts.canary.found) {
    notes.push(`Canary/redaction tests: ${opts.canary.refs.slice(0, 3).join(", ")}`);
  } else if (!opts.imported.found) {
    notes.push(
      "No synthetic secret-injection canary tests found. SEC2-M2 needs a harness that injects API key/bearer/AWS-key patterns and asserts 100% redaction in persisted logs/traces.",
    );
  }

  if (opts.imported.found) {
    notes.push(
      `Imported harness: ${opts.imported.sources.join(", ")} (detectionRatePct=${detectionRatePct}, cases=${opts.imported.caseCount})`,
    );
  }

  let statusHint: SecretRedactionReport["summary"]["statusHint"];
  let sec2M2Satisfied: boolean | null = null;

  if (detectionRatePct !== null && detectionRatePct < 100) {
    statusHint = "fail";
    sec2M2Satisfied = false;
    notes.push(
      `Canary detection rate ${detectionRatePct}% < 100% required by passCondition.`,
    );
  } else if (
    redactionConfigPresent &&
    canaryTestPresent &&
    detectionRatePct === 100
  ) {
    statusHint = "pass";
    sec2M2Satisfied = true;
  } else if (redactionConfigPresent || canaryTestPresent) {
    statusHint = "partial";
    sec2M2Satisfied = false;
    if (canaryTestPresent && detectionRatePct === null) {
      notes.push(
        "Canary evidence present but no measured detectionRatePct: 100 — import harness JSON to PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2M2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
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
    importedHarness: {
      found: opts.imported.found,
      detectionRatePct,
      caseCount: opts.imported.caseCount,
      sources: opts.imported.sources,
    },
    summary: {
      redactionConfigPresent,
      canaryTestPresent,
      detectionRatePct,
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
    const imported = loadImportedHarness(ctx);

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
          ...(report.redactionConfig.found ? ["redaction-config"] : []),
          ...(report.canaryTests.found || report.importedHarness.found
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
