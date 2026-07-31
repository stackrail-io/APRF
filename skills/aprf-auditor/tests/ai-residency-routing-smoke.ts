/**
 * Smoke: ai-residency-routing needs labeled regulated workloads + 100% in-region.
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
  aiResidencyRoutingCollector,
  type AiResidencyRoutingReport,
} from "../collectors/ai-residency-routing.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiResidencyRoutingReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-residency-routing",
        "ai-residency-routing-report.json",
      ),
      "utf8",
    ),
  ) as AiResidencyRoutingReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-prim3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-prim3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiResidencyRoutingCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "privacy"), { recursive: true });
  writeFileSync(
    join(targetDir, "privacy", "residency-routing-policy.md"),
    `
# Data residency routing

Regulated workloads (residency_required=true) use approved regions EU-WEST.
Model routing policy pins region allowlist; cross-region deny.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-prim3-1-"));
  await aiResidencyRoutingCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.policySignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-prim3-2-"));
  mkdirSync(join(out2, "imports", "ai-residency-routing"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-residency-routing", "sample.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 1,
      regulatedWorkloadsLabeled: true,
      approvedRegionsDocumented: true,
      sampleInApprovedRegionPct: 100,
    }),
    "utf8",
  );
  await aiResidencyRoutingCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.priM3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-prim3-3-"));
  mkdirSync(join(out3, "imports", "ai-residency-routing"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "ai-residency-routing", "sample.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      regulatedWorkloadsLabeled: true,
      approvedRegionsDocumented: true,
      sampleInApprovedRegionPct: 97,
    }),
    "utf8",
  );
  await aiResidencyRoutingCollector.collect({
    ...baseCtx,
    outputDir: out3,
  });
  const r3 = readReport(out3);
  if (r3.summary.statusHint !== "fail") {
    throw new Error(`expected fail on <100%, got ${r3.summary.statusHint}`);
  }

  console.log("ai-residency-routing smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
