/**
 * Smoke: dataset-secret-scan-gate needs scan gate + blocking + 100% linked
 * reports + measuredAt ≤90d; gate docs alone ≠ PASS.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  datasetSecretScanGateCollector,
  type DatasetSecretScanGateReport,
} from "../collectors/dataset-secret-scan-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<DatasetSecretScanGateReport> {
  await datasetSecretScanGateCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "dataset-secret-scan-gate",
        "dataset-secret-scan-gate-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    fineTuneOrEvalCorpusPublishPresent: true,
    datasetSecretPiiScanGateConfigured: true,
    publishBlockedWhenCriticalFindingsOpen: true,
    fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct: 100,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-r3-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tGate = join(root, "t-gate");
    mkdirSync(join(tGate, "ci"), { recursive: true });
    writeFileSync(
      join(tGate, "ci", "dataset_secret_scan_gate.yml"),
      `
name: dataset-secret-scan
on:
  workflow_call:
jobs:
  scan:
    steps:
      - run: scan-dataset --pii --secrets --fail-on-critical
        # blocks corpus publish on critical findings
`,
    );
    const r1 = await run(tGate, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.scanGatePresent) {
      throw new Error(
        `expected partial with scan gate, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Fail: linked pct < 100
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "dataset-secret-scan-gate", "coverage.json"),
      coverage({
        fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct: 80,
      }),
    );
    const r2 = await run(tGate, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Metrics without measuredAt → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "dataset-secret-scan-gate", "coverage.json"),
      JSON.stringify({
        fineTuneOrEvalCorpusPublishPresent: true,
        datasetSecretPiiScanGateConfigured: true,
        publishBlockedWhenCriticalFindingsOpen: true,
        fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct: 100,
      }),
    );
    const rStale = await run(tGate, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `without measuredAt expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "dataset-secret-scan-gate", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tGate, outPass);
    if (r3.summary.sec2R3Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "dataset-secret-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fineTuneOrEvalCorpusPublishPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // N/A overridden by scan gate → pass with full import
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "dataset-secret-scan-gate", "coverage.json"),
      coverage({ fineTuneOrEvalCorpusPublishPresent: false }),
    );
    const rOv = await run(tGate, outOverride);
    if (rOv.summary.statusHint !== "pass") {
      throw new Error(
        `scan gate should override N/A to pass: ${JSON.stringify(rOv.summary)}`,
      );
    }

    // Generic blocking wording alone must not block N/A.
    const tBlock = join(root, "t-block");
    mkdirSync(join(tBlock, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tBlock, ".github", "workflows", "ci.yml"),
      "jobs:\n  build:\n    steps:\n      - run: echo fail the job if critical findings\n",
    );
    const outBlockNa = join(root, "o-block-na");
    mkdirSync(join(outBlockNa, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outBlockNa, "imports", "dataset-secret-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fineTuneOrEvalCorpusPublishPresent: false,
      }),
    );
    const rBlockNa = await run(tBlock, outBlockNa);
    if (rBlockNa.summary.statusHint !== "not_applicable") {
      throw new Error(
        `blocking-only must allow N/A: ${JSON.stringify(rBlockNa.summary)}`,
      );
    }

    // Corpus-publish alone blocks N/A launder.
    const tCorpus = join(root, "t-corpus");
    mkdirSync(join(tCorpus, "docs"), { recursive: true });
    writeFileSync(
      join(tCorpus, "docs", "corpus_publish.md"),
      "Pipeline for fine-tune corpus publish to the training registry.\n",
    );
    const outCorpusNa = join(root, "o-corpus-na");
    mkdirSync(join(outCorpusNa, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outCorpusNa, "imports", "dataset-secret-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fineTuneOrEvalCorpusPublishPresent: false,
      }),
    );
    const rCorpusNa = await run(tCorpus, outCorpusNa);
    if (rCorpusNa.summary.statusHint === "not_applicable") {
      throw new Error("corpus-publish must block N/A launder");
    }

    // Failing linked-pct beats N/A with no in-repo surface.
    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "dataset-secret-scan-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "dataset-secret-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fineTuneOrEvalCorpusPublishPresent: false,
        fineTuneOrEvalCorporaPublishedInLast90DaysWithLinkedScanReportPct: 40,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing metrics must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor dataset-secret-scan-gate smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
