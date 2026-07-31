/**
 * Smoke: ai-cost-alerts needs both alert classes + imported notify for PASS.
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
  aiCostAlertsCollector,
  type AiCostAlertsReport,
} from "../collectors/ai-cost-alerts.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiCostAlertsReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-cost-alerts", "ai-cost-alerts-report.json"),
      "utf8",
    ),
  ) as AiCostAlertsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costm2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costm2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiCostAlertsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "ops", "alerts"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "alerts", "llm_budget_burn_alert.yaml"),
    `
# openai llm token spend budget_burn alert → pagerduty
metric: ai_token_cost_usd
budget_burn_threshold_pct: 80
notification_channel: pagerduty
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "alerts", "llm_spend_anomaly_alert.yaml"),
    `
# cost_anomaly / spend_anomaly alert for llm token usage
anomaly_detector: cost_anomaly
spend_anomaly_zscore: 3
alert: true
pager: oncall
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "alerts", "cost_dashboard.md"),
    `# FinOps cost dashboard for LLM token spend\nGrafana board: ai-cost\n`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costm2-1-"));
  await aiCostAlertsCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.bothAlertClassesPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costm2-2-"));
  mkdirSync(join(out2, "imports", "ai-cost-alerts"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-cost-alerts", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 14,
      hasBudgetBurnAlert: true,
      hasAnomalyAlert: true,
      notifyProven: true,
      events: [{ fired: true, notified: true, budgetBurn: true }],
    }),
    "utf8",
  );
  await aiCostAlertsCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-cost-alerts smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
