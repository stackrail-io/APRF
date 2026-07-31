/**
 * Smoke: platform-dx-metrics needs formulas + 30d series + bypass alert/owner for PASS.
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
  platformDxMetricsCollector,
  type PlatformDxMetricsReport,
} from "../collectors/platform-dx-metrics.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformDxMetricsReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-dx-metrics",
        "platform-dx-metrics-report.json",
      ),
      "utf8",
    ),
  ) as PlatformDxMetricsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxr3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxr3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformDxMetricsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "docs", "platform"), { recursive: true });
  writeFileSync(
    join(targetDir, "docs", "platform", "dx-metrics.md"),
    `
# AI platform DX metrics

## time-to-safe-production
Formula / definition: median days from scaffold to golden-path promote.

## policy-bypass rate
Formula: bypass PRs / total AI PRs. Alert threshold 5% with owner platform-dx.
Dashboard / weekly report last 30 days series in Grafana.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxr3-1-"));
  await platformDxMetricsCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.bothMetricsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxr3-2-"));
  mkdirSync(join(out2, "imports", "platform-dx-metrics"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "platform-dx-metrics", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 2,
      ttspFormulaDefined: true,
      bypassFormulaDefined: true,
      publishedConsecutiveDays: 45,
      publishedFor30Days: true,
      bypassHasAlertOrThreshold: true,
      bypassOwnerNamed: true,
      bypassOwner: "platform-dx",
    }),
    "utf8",
  );
  await platformDxMetricsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxR3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-dx-metrics smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
