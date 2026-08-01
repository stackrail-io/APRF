/**
 * Smoke: ai-slo-dashboards needs named SLOs + 3 burn dims + alerts for PASS.
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
  aiSloDashboardsCollector,
  type AiSloDashboardsReport,
} from "../collectors/ai-slo-dashboards.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiSloDashboardsReport> {
  await aiSloDashboardsCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-slo-dashboards", "ai-slo-dashboards-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai-slo.md"),
      "AI SLO dashboard for LLM journeys\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "slo-burn.md"),
      "AI SLO dashboard with quality burn and burn-rate alert\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-slo-dashboards"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-slo-dashboards", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        namedSloTargetsForCriticalAiJourneys: true,
        coversLatencyErrorAndQualityBurn: true,
        burnRateAlertConfigured: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "error-budget.md"),
      "Service level objective error budget notes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-slo-dashboards"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-slo-dashboards", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        namedSloTargetsForCriticalAiJourneys: true,
        coversLatencyErrorAndQualityBurn: false,
        burnRateAlertConfigured: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.obsR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-slo-dashboards smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
