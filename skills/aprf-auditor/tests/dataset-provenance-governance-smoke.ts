/**
 * Smoke: dataset-provenance-governance needs complete inventory + promote block for PASS.
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
  datasetProvenanceGovernanceCollector,
  type DatasetProvenanceGovernanceReport,
} from "../collectors/dataset-provenance-governance.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): DatasetProvenanceGovernanceReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "dataset-provenance-governance",
        "dataset-provenance-governance-report.json",
      ),
      "utf8",
    ),
  ) as DatasetProvenanceGovernanceReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgm2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgm2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await datasetProvenanceGovernanceCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "datasets", "eval-core"), { recursive: true });
  mkdirSync(join(targetDir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(targetDir, "datasets", "eval-core", "DATASET_CARD.md"),
    `
# Dataset card — eval-core

## Provenance
Collected from licensed product docs; derived_from internal corpus v3.

## Quality criteria
Label quality ≥95%; contamination checks; acceptance criteria documented.
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, ".github", "workflows", "dataset-card-gate.yml"),
    `
name: dataset card gate
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: npm run check-dataset-cards
      # blocks promote / required_check when missing card
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgm2-1-"));
  await datasetProvenanceGovernanceCollector.collect({
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

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgm2-2-"));
  mkdirSync(join(out2, "imports", "dataset-provenance-governance"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "dataset-provenance-governance", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 2,
      coversAllEvalAndFinetuneDatasets: true,
      datasetCount: 1,
      missingProvenanceCount: 0,
      missingQualityCriteriaCount: 0,
      promotionBlockedIfMissing: true,
      datasets: [
        {
          name: "eval-core",
          provenance: "licensed product docs",
          qualityCriteria: "label quality >=95%",
        },
      ],
    }),
    "utf8",
  );
  await datasetProvenanceGovernanceCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("dataset-provenance-governance smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
