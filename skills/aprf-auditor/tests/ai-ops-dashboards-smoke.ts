/**
 * Smoke: ai-ops-dashboards needs full panel coverage + near-realtime for PASS.
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
  aiOpsDashboardsCollector,
  type AiOpsDashboardsReport,
} from "../collectors/ai-ops-dashboards.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiOpsDashboardsReport> {
  await aiOpsDashboardsCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-ops-dashboards",
        "ai-ops-dashboards-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-perf-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai-dashboard.md"),
      "Grafana AI dashboard draft\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.perfR4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "ops-dashboard.md"),
      "Near real-time grafana dashboard with latency error throughput panels\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-ops-dashboards"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-ops-dashboards", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        dashboardCoversLatencyErrorThroughput: true,
        dashboardCoversResourceUtilization: true,
        dashboardCoversAiQuality: true,
        nearRealtimeRefreshConfigured: true,
        panelFreshnessMinutes: 5,
      }),
    );
    const r2 = await run(t2, out2);
    if (
      r2.summary.statusHint !== "pass" ||
      r2.summary.perfR4Satisfied !== true
    ) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "llm-dashboard.md"),
      "Datadog dashboard refresh interval notes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-ops-dashboards"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-ops-dashboards", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        dashboardCoversLatencyErrorThroughput: true,
        dashboardCoversResourceUtilization: true,
        dashboardCoversAiQuality: true,
        panelFreshnessMinutes: 60,
      }),
    );
    const r3 = await run(t3, out3);
    if (
      r3.summary.statusHint !== "fail" ||
      r3.summary.perfR4Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-ops-dashboards smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
