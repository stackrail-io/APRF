/**
 * Smoke: ai-slo-burn-alerts needs SLO coverage + notify proof for PASS.
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
  aiSloBurnAlertsCollector,
  type AiSloBurnAlertsReport,
} from "../collectors/ai-slo-burn-alerts.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiSloBurnAlertsReport> {
  await aiSloBurnAlertsCollector.collect({
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
        "ai-slo-burn-alerts",
        "ai-slo-burn-alerts-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-perf-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "burn-rate-alert.md"),
      "Burn-rate alert draft for AI journeys\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.perfM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "slo-alert.md"),
      "Critical journey SLO alert to pagerduty; alert test fire documented\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-slo-burn-alerts"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-slo-burn-alerts", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        alertPoliciesCoverCriticalJourneySlos: true,
        notificationPathProvenByTestOrDocumentedFire: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.perfM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "error-budget-alert.md"),
      "Error budget alert notes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-slo-burn-alerts"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-slo-burn-alerts", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        alertPoliciesCoverCriticalJourneySlos: true,
        notificationPathProvenByTestOrDocumentedFire: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.perfM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-slo-burn-alerts smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
