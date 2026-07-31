/**
 * Smoke: ai-finops-unit-economics needs metrics signals + imported review for PASS.
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
  aiFinopsUnitEconomicsCollector,
  type AiFinopsUnitEconomicsReport,
} from "../collectors/ai-finops-unit-economics.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiFinopsUnitEconomicsReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-finops-unit-economics",
        "ai-finops-unit-economics-report.json",
      ),
      "utf8",
    ),
  ) as AiFinopsUnitEconomicsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costr3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costr3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiFinopsUnitEconomicsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "docs", "finops"), { recursive: true });
  writeFileSync(
    join(targetDir, "docs", "finops", "ai_unit_economics.md"),
    `
# FinOps AI unit economics
Track cost_per_successful_task per LLM product.
finops_review quarterly; outlier_threshold and outlier_owner required.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costr3-1-"));
  await aiFinopsUnitEconomicsCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.metricsPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costr3-2-"));
  mkdirSync(join(out2, "imports", "ai-finops-unit-economics"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "ai-finops-unit-economics", "review.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 20,
      unitMetricsPresent: true,
      coversCustomerFacingProducts: true,
      quarterCovered: true,
      reviewOccurred: true,
      outliersHaveOwners: true,
      products: [{ name: "chat", costPerTask: 0.12 }],
      outliers: [{ product: "chat", owner: "finops-alice" }],
    }),
    "utf8",
  );
  await aiFinopsUnitEconomicsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costR3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-finops-unit-economics smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
