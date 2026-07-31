/**
 * Smoke: dataset-cards-registry needs complete major-set cards for PASS.
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
  datasetCardsRegistryCollector,
  type DatasetCardsRegistryReport,
} from "../collectors/dataset-cards-registry.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): DatasetCardsRegistryReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "dataset-cards-registry",
        "dataset-cards-registry-report.json",
      ),
      "utf8",
    ),
  ) as DatasetCardsRegistryReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgr3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgr3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await datasetCardsRegistryCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "datasets", "eval-core"), { recursive: true });
  writeFileSync(
    join(targetDir, "datasets", "eval-core", "DATASET_CARD.md"),
    `
# Dataset card — eval-core

## Purpose
Core regression evaluation set for production promote gates.

## Source
Licensed product docs sample; collected_from internal corpus.

## PII handling
No PII; redacted before packaging.

## Last updated
2026-01-15
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgr3-1-"));
  await datasetCardsRegistryCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.cardSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgr3-2-"));
  mkdirSync(join(out2, "imports", "dataset-cards-registry"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "dataset-cards-registry", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 5,
      coversAllMajorEvalFinetuneSets: true,
      majorSetCount: 1,
      missingPurposeCount: 0,
      missingSourceCount: 0,
      missingPiiHandlingCount: 0,
      staleCardCount: 0,
      cards: [
        {
          name: "eval-core",
          purpose: "core regression eval",
          source: "licensed product docs",
          piiHandling: "no PII",
          updatedWithin12Months: true,
          lastUpdated: new Date().toISOString(),
        },
      ],
    }),
    "utf8",
  );
  await datasetCardsRegistryCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgR3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-dgr3-3-"));
  mkdirSync(join(out3, "imports", "dataset-cards-registry"), {
    recursive: true,
  });
  writeFileSync(
    join(out3, "imports", "dataset-cards-registry", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllMajorEvalFinetuneSets: true,
      cards: [
        {
          name: "undated",
          purpose: "x",
          source: "y",
          piiHandling: "z",
        },
      ],
    }),
    "utf8",
  );
  await datasetCardsRegistryCollector.collect({
    ...baseCtx,
    outputDir: out3,
  });
  const r3 = readReport(out3);
  if (
    r3.summary.statusHint !== "fail" ||
    r3.importedResults.staleCardCount !== 1
  ) {
    throw new Error(
      `expected fail on undated card, got ${JSON.stringify(r3.summary)} stale=${r3.importedResults.staleCardCount}`,
    );
  }

  console.log("dataset-cards-registry smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
