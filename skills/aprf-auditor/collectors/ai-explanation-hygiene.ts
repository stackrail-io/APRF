/**
 * ai-explanation-hygiene — EXP-M3 / repo-ai-explanation-hygiene.
 *
 * Discovers explanation-payload redaction + synthetic tests + sample scans.
 * Import explanationRedactionPolicyConfigured +
 * syntheticSecretPiiRedactedOrBlockedPct=100 +
 * productionExplanationSampleSecretHits=0 under imports/ai-explanation-hygiene/
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

const PLUGIN_ID = "ai-explanation-hygiene";
const RELATED = ["EXP-M3"] as const;
const DETECTOR_ID = "repo-ai-explanation-hygiene";
const IMPORT_MAX_AGE_DAYS = 90;

const EXPLANATION_RE =
  /\b(explanation|explainability|rationale|decision[_-]?path[_-]?(text|payload|snippet)|citation[_-]?(snippet|payload)|user[_-]?facing[_-]?(reason|rationale))\b/i;

const REDACTION_RE =
  /\b(redact(ion|or|ed)?|scrub(ber|bing)?|mask(ing)?|sanitize|block[_-]?(secret|pii)|dlp)\b/i;

const FIXTURE_TEST_RE =
  /\b(synthetic[_-]?(secret|pii)|canary[_-]?(secret|pii)|secret[_-]?fixture|pii[_-]?fixture|explanation[_-]?(redaction|scrub)[_-]?test)\b/i;

const SAMPLE_SCAN_RE =
  /\b(explanation[_-]?(sample|scan|audit)|sample[_-]?scan|production[_-]?explanation|secret[_-]?pattern[_-]?(hit|scan))\b/i;

export interface AiExplanationHygieneReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    explanation: { found: boolean; refs: string[] };
    redaction: { found: boolean; refs: string[] };
    fixtureTest: { found: boolean; refs: string[] };
    sampleScan: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    explanationRedactionPolicyConfigured: boolean | null;
    syntheticSecretPiiRedactedOrBlockedPct: number | null;
    productionExplanationSampleSecretHits: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    hygieneSignalsPresent: boolean;
    expM3Satisfied: boolean | null;
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
      ".ts",
      ".js",
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
): AiExplanationHygieneReport["importedResults"] {
  const sources: string[] = [];
  let explanationRedactionPolicyConfigured: boolean | null = null;
  let syntheticSecretPiiRedactedOrBlockedPct: number | null = null;
  let productionExplanationSampleSecretHits: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-explanation-hygiene-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      explanationRedactionPolicyConfigured =
        asBool(data.explanationRedactionPolicyConfigured) ??
        asBool(data.explanation_redaction_policy_configured) ??
        asBool(data.redactionPolicyConfigured) ??
        asBool(data.explanationRedactionConfigured) ??
        explanationRedactionPolicyConfigured;
      syntheticSecretPiiRedactedOrBlockedPct =
        asNum(data.syntheticSecretPiiRedactedOrBlockedPct) ??
        asNum(data.synthetic_secret_pii_redacted_or_blocked_pct) ??
        asNum(data.syntheticRedactionPct) ??
        asNum(data.fixtureRedactionPct) ??
        syntheticSecretPiiRedactedOrBlockedPct;
      productionExplanationSampleSecretHits =
        asNum(data.productionExplanationSampleSecretHits) ??
        asNum(data.production_explanation_sample_secret_hits) ??
        asNum(data.sampleSecretHits) ??
        asNum(data.privilegedSecretHits) ??
        productionExplanationSampleSecretHits;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    explanationRedactionPolicyConfigured,
    syntheticSecretPiiRedactedOrBlockedPct,
    productionExplanationSampleSecretHits,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiExplanationHygieneReport(opts: {
  assessedAt: string;
  explanation: { found: boolean; refs: string[] };
  redaction: { found: boolean; refs: string[] };
  fixtureTest: { found: boolean; refs: string[] };
  sampleScan: { found: boolean; refs: string[] };
  imported: AiExplanationHygieneReport["importedResults"];
}): AiExplanationHygieneReport {
  const notes: string[] = [];
  const hygieneSignalsPresent =
    opts.explanation.found ||
    opts.redaction.found ||
    opts.fixtureTest.found ||
    opts.sampleScan.found;

  if (!hygieneSignalsPresent && !opts.imported.found) {
    notes.push(
      "No explanation-hygiene signals — EXP-M3 may be NOT_APPLICABLE if there are no explanation payloads in scope.",
    );
  }
  if (opts.explanation.found) {
    notes.push(
      `Explanation refs: ${opts.explanation.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.redaction.found) {
    notes.push(`Redaction refs: ${opts.redaction.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.fixtureTest.found) {
    notes.push(
      `Fixture-test refs: ${opts.fixtureTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.sampleScan.found) {
    notes.push(
      `Sample-scan refs: ${opts.sampleScan.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (policy=${opts.imported.explanationRedactionPolicyConfigured}, syntheticPct=${opts.imported.syntheticSecretPiiRedactedOrBlockedPct}, sampleHits=${opts.imported.productionExplanationSampleSecretHits})`,
    );
  } else if (hygieneSignalsPresent) {
    notes.push(
      "Hygiene signals alone are PARTIAL — import explanationRedactionPolicyConfigured=true + syntheticSecretPiiRedactedOrBlockedPct=100 + productionExplanationSampleSecretHits=0 (measuredAt ≤90d) under imports/ai-explanation-hygiene/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const policyOk = opts.imported.explanationRedactionPolicyConfigured === true;
  const syntheticOk =
    opts.imported.syntheticSecretPiiRedactedOrBlockedPct === 100;
  const sampleOk = opts.imported.productionExplanationSampleSecretHits === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiExplanationHygieneReport["summary"]["statusHint"];
  let expM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.explanationRedactionPolicyConfigured === false ||
      (opts.imported.syntheticSecretPiiRedactedOrBlockedPct !== null &&
        opts.imported.syntheticSecretPiiRedactedOrBlockedPct < 100) ||
      (opts.imported.productionExplanationSampleSecretHits !== null &&
        opts.imported.productionExplanationSampleSecretHits > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!hygieneSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing explanation redaction policy, synthetic redaction <100%, production sample secret hits >0, or attest older than 90 days — EXP-M3 fail.",
    );
  } else if (
    (hygieneSignalsPresent || opts.imported.found) &&
    policyOk &&
    syntheticOk &&
    sampleOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expM3Satisfied = true;
  } else if (hygieneSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expM3Satisfied = false;
    if (opts.imported.found && !policyOk) {
      notes.push(
        "Import must show explanationRedactionPolicyConfigured=true.",
      );
    }
    if (opts.imported.found && !syntheticOk) {
      notes.push(
        "Import must show syntheticSecretPiiRedactedOrBlockedPct=100.",
      );
    }
    if (opts.imported.found && !sampleOk) {
      notes.push(
        "Import must show productionExplanationSampleSecretHits=0.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      explanation: opts.explanation,
      redaction: opts.redaction,
      fixtureTest: opts.fixtureTest,
      sampleScan: opts.sampleScan,
    },
    importedResults: opts.imported,
    summary: {
      hygieneSignalsPresent,
      expM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiExplanationHygieneCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const explanationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => EXPLANATION_RE.test(path) || EXPLANATION_RE.test(text),
      10,
    );
    const redactionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!REDACTION_RE.test(path) && !REDACTION_RE.test(text)) return false;
        return (
          EXPLANATION_RE.test(path) ||
          EXPLANATION_RE.test(text) ||
          REDACTION_RE.test(path)
        );
      },
      10,
    );
    const fixtureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        FIXTURE_TEST_RE.test(path) ||
        (/(test|spec|fixture|canary)/i.test(path) &&
          (FIXTURE_TEST_RE.test(text) ||
            (REDACTION_RE.test(text) && EXPLANATION_RE.test(text)))),
      8,
    );
    const sampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SAMPLE_SCAN_RE.test(path) || SAMPLE_SCAN_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiExplanationHygieneReport({
      assessedAt: ctx.assessedAt.toISOString(),
      explanation: {
        found: explanationRefs.length > 0,
        refs: explanationRefs,
      },
      redaction: { found: redactionRefs.length > 0, refs: redactionRefs },
      fixtureTest: { found: fixtureRefs.length > 0, refs: fixtureRefs },
      sampleScan: { found: sampleRefs.length > 0, refs: sampleRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-explanation-hygiene-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-explanation-hygiene-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-explanation-hygiene",
          "exp-m3",
          DETECTOR_ID,
          ...(report.summary.expM3Satisfied ? ["exp-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.explanation.refs,
        ...report.signals.redaction.refs,
        ...report.signals.fixtureTest.refs,
        ...report.signals.sampleScan.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-explanation-hygiene-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-M3 status=${report.summary.statusHint} signals=${report.summary.hygieneSignalsPresent} satisfied=${report.summary.expM3Satisfied}; report=imports/${PLUGIN_ID}/ai-explanation-hygiene-report.json`,
      nodes,
    };
  },
};
