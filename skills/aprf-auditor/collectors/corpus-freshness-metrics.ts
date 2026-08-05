/**
 * corpus-freshness-metrics — DG-R1 / repo-corpus-freshness detector executor.
 *
 * Discovers corpus freshness SLO + metric/alert signals.
 * Import ≥95% meet-rate (≤7d) + alert proof under
 * imports/corpus-freshness-metrics/ to unlock PASS.
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

const PLUGIN_ID = "corpus-freshness-metrics";
const RELATED = ["DG-R1"] as const;
const DETECTOR_ID = "repo-corpus-freshness";
/** Spec: sample window last 7 days. */
const SAMPLE_MAX_AGE_DAYS = 7;
const MEET_SLO_MIN_PCT = 95;

const CORPUS_PATH_RE =
  /(corpus|rag|vector|index|freshness|coverage|retriev|pinecone|weaviate|qdrant|chroma)/i;

const FRESHNESS_RE =
  /\b(freshness[\s_-]*(slo|sla|metric|alert|job|dashboard)|max[\s_-]*age|stale[\s_-]*(threshold|alert)|doc[\s_-]*age|corpus[\s_-]*fresh)\b/i;

const COVERAGE_RE =
  /\b(coverage[\s_-]*(metric|slo|dashboard|gap)|document[\s_-]*coverage|index[\s_-]*coverage)\b/i;

const SLO_RE =
  /\b(freshness[\s_-]*slo|slo[\s_-]*(hours|days)|max[\s_-]*age[\s_-]*(hours|days)|freshness[\s_-]*threshold)\b/i;

const ALERT_RE =
  /\b(freshness[\s_-]*alert|stale[\s_-]*alert|alert[\s_-]*on[\s_-]*(freshness|stale)|pager|on[\s_-]*call|threshold[\s_-]*breach)\b/i;

export interface CorpusFreshnessMetricsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    freshness: { found: boolean; refs: string[] };
    coverage: { found: boolean; refs: string[] };
    slo: { found: boolean; refs: string[] };
    alerts: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    criticalCorpusCount: number | null;
    coversAllCriticalCorpora: boolean | null;
    freshnessSloDefinedForAll: boolean | null;
    sampledMeetSloPct: number | null;
    freshnessAlertConfigured: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    corpusSignalsPresent: boolean;
    metricSignalsPresent: boolean;
    dgR1Satisfied: boolean | null;
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
      ".toml",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectCorpusSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        CORPUS_PATH_RE.test(path) ||
        FRESHNESS_RE.test(text) ||
        /\b(corpus|vector[\s_-]*index|rag)\b/i.test(text),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): CorpusFreshnessMetricsReport["importedResults"] {
  const sources: string[] = [];
  let criticalCorpusCount: number | null = null;
  let coversAllCriticalCorpora: boolean | null = null;
  let freshnessSloDefinedForAll: boolean | null = null;
  let sampledMeetSloPct: number | null = null;
  let freshnessAlertConfigured: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/corpus-freshness-metrics-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      criticalCorpusCount =
        asNum(data.criticalCorpusCount) ??
        asNum(data.corpusCount) ??
        criticalCorpusCount;
      coversAllCriticalCorpora =
        asBool(data.coversAllCriticalCorpora) ??
        asBool(data.coversAllCorpora) ??
        coversAllCriticalCorpora;
      freshnessSloDefinedForAll =
        asBool(data.freshnessSloDefinedForAll) ??
        asBool(data.allHaveFreshnessSlo) ??
        freshnessSloDefinedForAll;
      sampledMeetSloPct =
        asNum(data.sampledMeetSloPct) ??
        asNum(data.meetSloPct) ??
        asNum(data.freshnessCompliancePct) ??
        sampledMeetSloPct;
      freshnessAlertConfigured =
        asBool(data.freshnessAlertConfigured) ??
        asBool(data.alertFiresOnBreach) ??
        asBool(data.hasFreshnessAlert) ??
        freshnessAlertConfigured;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const corpora = Array.isArray(data.corpora)
        ? (data.corpora as Array<Record<string, unknown>>)
        : Array.isArray(data.criticalCorpora)
          ? (data.criticalCorpora as Array<Record<string, unknown>>)
          : [];
      if (corpora.length > 0) {
        criticalCorpusCount = corpora.length;
        let withSlo = 0;
        const pcts: number[] = [];
        let alerts = 0;
        for (const c of corpora) {
          const slo =
            c.freshnessSloHours != null ||
            c.freshnessSlo != null ||
            c.hasFreshnessSlo === true ||
            (typeof c.freshnessSlo === "string" &&
              String(c.freshnessSlo).trim().length > 0);
          if (slo) withSlo += 1;
          const pct = asNum(c.sampledMeetSloPct) ?? asNum(c.meetSloPct);
          if (pct != null) pcts.push(pct);
          if (
            c.alertConfigured === true ||
            c.freshnessAlertConfigured === true
          ) {
            alerts += 1;
          }
        }
        freshnessSloDefinedForAll = withSlo === corpora.length;
        if (pcts.length > 0) {
          sampledMeetSloPct =
            pcts.reduce((a, b) => a + b, 0) / pcts.length;
        }
        if (freshnessAlertConfigured == null) {
          freshnessAlertConfigured = alerts === corpora.length;
        }
        if (coversAllCriticalCorpora == null) {
          coversAllCriticalCorpora = true;
        }
      }

      if (asBool(data.sampledMeetSloOk) === true && sampledMeetSloPct == null) {
        sampledMeetSloPct = MEET_SLO_MIN_PCT;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    criticalCorpusCount,
    coversAllCriticalCorpora,
    freshnessSloDefinedForAll,
    sampledMeetSloPct,
    freshnessAlertConfigured,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildCorpusFreshnessMetricsReport(opts: {
  assessedAt: string;
  signals: CorpusFreshnessMetricsReport["signals"];
  corpusSignals: boolean;
  imported: CorpusFreshnessMetricsReport["importedResults"];
}): CorpusFreshnessMetricsReport {
  const notes: string[] = [];
  const metricSignalsPresent =
    opts.signals.freshness.found ||
    opts.signals.slo.found ||
    opts.signals.alerts.found;

  if (!opts.corpusSignals && !metricSignalsPresent && !opts.imported.found) {
    notes.push(
      "No corpus freshness signals — DG-R1 may be NOT_APPLICABLE if there are no critical corpora.",
    );
  }
  if (opts.signals.freshness.found) {
    notes.push(
      `Freshness refs: ${opts.signals.freshness.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.coverage.found) {
    notes.push(
      `Coverage refs: ${opts.signals.coverage.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.slo.found) {
    notes.push(`SLO refs: ${opts.signals.slo.refs.slice(0, 2).join(", ")}`);
  }
  if (opts.signals.alerts.found) {
    notes.push(
      `Alert refs: ${opts.signals.alerts.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (corpora=${opts.imported.criticalCorpusCount}, coversAll=${opts.imported.coversAllCriticalCorpora}, sloAll=${opts.imported.freshnessSloDefinedForAll}, meetPct=${opts.imported.sampledMeetSloPct}, alert=${opts.imported.freshnessAlertConfigured}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (metricSignalsPresent) {
    notes.push(
      "Metric config alone is PARTIAL — import SLOs + ≥95% meet-rate (≤7d) + freshness alert under imports/corpus-freshness-metrics/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= SAMPLE_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    SAMPLE_MAX_AGE_DAYS,
  );
  const meetOk =
    opts.imported.sampledMeetSloPct !== null &&
    opts.imported.sampledMeetSloPct >= MEET_SLO_MIN_PCT;
  const passOk =
    opts.imported.coversAllCriticalCorpora === true &&
    opts.imported.freshnessSloDefinedForAll === true &&
    meetOk &&
    opts.imported.freshnessAlertConfigured === true &&
    ageOk &&
    importFresh;

  let statusHint: CorpusFreshnessMetricsReport["summary"]["statusHint"];
  let dgR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllCriticalCorpora === false ||
      opts.imported.freshnessSloDefinedForAll === false ||
      (opts.imported.sampledMeetSloPct !== null &&
        opts.imported.sampledMeetSloPct < MEET_SLO_MIN_PCT) ||
      opts.imported.freshnessAlertConfigured === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > SAMPLE_MAX_AGE_DAYS));

  if (
    !opts.corpusSignals &&
    !opts.signals.freshness.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgR1Satisfied = false;
    notes.push(
      "Imported results show missing SLOs, <95% meet-rate, no alert, or sample older than 7 days — DG-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgR1Satisfied = true;
    if ((opts.imported.criticalCorpusCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllCriticalCorpora with zero corpora — confirm no critical corpus surface.",
      );
    }
  } else if (
    opts.signals.freshness.found ||
    opts.signals.slo.found ||
    opts.signals.coverage.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgR1Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllCriticalCorpora !== true) {
        notes.push("Import must show coversAllCriticalCorpora=true.");
      }
      if (opts.imported.freshnessSloDefinedForAll !== true) {
        notes.push("Import must show freshnessSloDefinedForAll=true.");
      }
      if (!meetOk) {
        notes.push(
          `Import must show sampledMeetSloPct ≥ ${MEET_SLO_MIN_PCT}.`,
        );
      }
      if (opts.imported.freshnessAlertConfigured !== true) {
        notes.push("Import must show freshnessAlertConfigured=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤7 days) — required to unlock DG-R1 PASS.",
        );
      }
    }
  } else if (opts.corpusSignals) {
    statusHint = "not_demonstrated";
    dgR1Satisfied = null;
    notes.push(
      "Corpus signals present but no freshness/coverage metric configs found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      corpusSignalsPresent: opts.corpusSignals,
      metricSignalsPresent,
      dgR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const corpusFreshnessMetricsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const corpusSignals = detectCorpusSignals(ctx.targetPath, maxFiles);

    const inCorpusContext = (path: string, text: string) =>
      CORPUS_PATH_RE.test(path) ||
      FRESHNESS_RE.test(text) ||
      COVERAGE_RE.test(text) ||
      /\b(corpus|rag|vector)\b/i.test(path);

    const freshnessRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (FRESHNESS_RE.test(path) || FRESHNESS_RE.test(text)) &&
        inCorpusContext(path, text),
    );
    const coverageRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (COVERAGE_RE.test(path) || COVERAGE_RE.test(text)) &&
        inCorpusContext(path, text),
      12,
    );
    const sloRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SLO_RE.test(path) || SLO_RE.test(text)) &&
        inCorpusContext(path, text),
      12,
    );
    const alertRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ALERT_RE.test(path) || ALERT_RE.test(text)) &&
        inCorpusContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildCorpusFreshnessMetricsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        freshness: {
          found: freshnessRefs.length > 0,
          refs: freshnessRefs,
        },
        coverage: { found: coverageRefs.length > 0, refs: coverageRefs },
        slo: { found: sloRefs.length > 0, refs: sloRefs },
        alerts: { found: alertRefs.length > 0, refs: alertRefs },
      },
      corpusSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "corpus-freshness-metrics-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime-config",
        ref: `imports/${PLUGIN_ID}/corpus-freshness-metrics-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "corpus-freshness-metrics",
          "dg-r1",
          DETECTOR_ID,
          ...(report.summary.metricSignalsPresent
            ? ["freshness-metric-signals"]
            : []),
          ...(report.summary.dgR1Satisfied ? ["dg-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...freshnessRefs.slice(0, 2),
        ...sloRefs.slice(0, 2),
        ...alertRefs.slice(0, 2),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["corpus-freshness-metrics-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-R1 status=${report.summary.statusHint} metrics=${report.summary.metricSignalsPresent} satisfied=${report.summary.dgR1Satisfied}; report=imports/${PLUGIN_ID}/corpus-freshness-metrics-report.json`,
      nodes,
    };
  },
};
