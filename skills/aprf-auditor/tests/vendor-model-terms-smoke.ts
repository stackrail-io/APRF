/**
 * Smoke: vendor-model-terms needs complete provider reviews for PASS.
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
  vendorModelTermsCollector,
  type VendorModelTermsReport,
} from "../collectors/vendor-model-terms.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): VendorModelTermsReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "vendor-model-terms",
        "vendor-model-terms-report.json",
      ),
      "utf8",
    ),
  ) as VendorModelTermsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-prim2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-prim2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await vendorModelTermsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "vendors"), { recursive: true });
  writeFileSync(
    join(targetDir, "vendors", "openai-dpa-review.md"),
    `
# Vendor terms review — OpenAI

## Training use
Opted out of training on customer data; clause reviewed.

## Retention
Completions retained ≤30 days; deletion on request.

Owner: privacy@example.com
Reviewed: 2026-01-10
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-prim2-1-"));
  await vendorModelTermsCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.termsSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-prim2-2-"));
  mkdirSync(join(out2, "imports", "vendor-model-terms"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "vendor-model-terms", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 4,
      coversAllProductionProviders: true,
      providerCount: 1,
      unreviewedProviderCount: 0,
      staleReviewCount: 0,
      missingTrainingUseCount: 0,
      missingRetentionCount: 0,
      providers: [
        {
          name: "openai",
          reviewed: true,
          trainingUseCovered: true,
          retentionCovered: true,
          reviewedWithin12Months: true,
          reviewedAt: new Date().toISOString(),
        },
      ],
    }),
    "utf8",
  );
  await vendorModelTermsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.priR2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-prim2-3-"));
  mkdirSync(join(out3, "imports", "vendor-model-terms"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "vendor-model-terms", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllProductionProviders: true,
      providers: [
        {
          name: "undated",
          reviewed: true,
          trainingUseCovered: true,
          retentionCovered: true,
        },
      ],
    }),
    "utf8",
  );
  await vendorModelTermsCollector.collect({
    ...baseCtx,
    outputDir: out3,
  });
  const r3 = readReport(out3);
  if (
    r3.summary.statusHint !== "fail" ||
    r3.importedResults.staleReviewCount !== 1
  ) {
    throw new Error(
      `expected fail on undated review, got ${JSON.stringify(r3.summary)} stale=${r3.importedResults.staleReviewCount}`,
    );
  }

  console.log("vendor-model-terms smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
