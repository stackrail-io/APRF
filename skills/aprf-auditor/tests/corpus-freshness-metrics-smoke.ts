/**
 * Smoke: corpus-freshness-metrics needs SLOs + ≥95% meet-rate + alert for PASS.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  corpusFreshnessMetricsCollector,
  type CorpusFreshnessMetricsReport,
} from "../collectors/corpus-freshness-metrics.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): CorpusFreshnessMetricsReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "corpus-freshness-metrics",
        "corpus-freshness-metrics-report.json",
      ),
      "utf8",
    ),
  ) as CorpusFreshnessMetricsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgr1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgr1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await corpusFreshnessMetricsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "ops", "corpus"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "corpus", "freshness.yaml"),
    `
# RAG corpus freshness metrics
corpora:
  - id: product-docs
    freshness_slo_hours: 24
    coverage_metric: enabled
    freshness_alert: pagerduty on stale threshold breach
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgr1-1-"));
  await corpusFreshnessMetricsCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.metricSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgr1-2-"));
  mkdirSync(join(out2, "imports", "corpus-freshness-metrics"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "corpus-freshness-metrics", "sample.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 1,
      coversAllCriticalCorpora: true,
      criticalCorpusCount: 1,
      freshnessSloDefinedForAll: true,
      sampledMeetSloPct: 97.5,
      freshnessAlertConfigured: true,
    }),
    "utf8",
  );
  await corpusFreshnessMetricsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgR1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("corpus-freshness-metrics smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
