/**
 * Smoke: train-serve-skew-monitor needs recent job + threshold + breach routing for PASS.
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
  trainServeSkewMonitorCollector,
  type TrainServeSkewMonitorReport,
} from "../collectors/train-serve-skew-monitor.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): TrainServeSkewMonitorReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "train-serve-skew-monitor",
        "train-serve-skew-monitor-report.json",
      ),
      "utf8",
    ),
  ) as TrainServeSkewMonitorReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgr2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgr2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await trainServeSkewMonitorCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "ops", "ml"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "ml", "train_serve_skew.yaml"),
    `
# Embedding pipeline train/serve skew monitor
job: weekly embedding skew
skew_threshold: 0.2
on_breach: create ticket and page pagerduty
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgr2-1-"));
  await trainServeSkewMonitorCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.skewSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgr2-2-"));
  mkdirSync(join(out2, "imports", "train-serve-skew-monitor"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "train-serve-skew-monitor", "report.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 2,
      coversAllProductionPipelines: true,
      pipelineCount: 1,
      skewJobWithin7Days: true,
      thresholdDocumented: true,
      breachCreatesTicketOrPage: true,
    }),
    "utf8",
  );
  await trainServeSkewMonitorCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgR2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("train-serve-skew-monitor smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
