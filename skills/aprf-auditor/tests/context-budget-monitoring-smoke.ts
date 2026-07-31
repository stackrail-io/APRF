/**
 * Smoke: context-budget-monitoring needs ≥99% emit + alert notify for PASS.
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
  contextBudgetMonitoringCollector,
  type ContextBudgetMonitoringReport,
} from "../collectors/context-budget-monitoring.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ContextBudgetMonitoringReport> {
  await contextBudgetMonitoringCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "context-budget-monitoring",
        "context-budget-monitoring-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "context_budget_usage.yml"),
      "metric: context_budget_usage\nalert: saturation when near_limit of max context\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.ctxR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "otel_context.yml"),
      "context_token_usage metric\ncontext_budget_alert on saturation truncate_rate\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-budget-monitoring"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "context-budget-monitoring", "sample.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        emitCoveragePct: 99.5,
        saturationAlertConfigured: true,
        alertNotifyProven: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "prompt_tokens.yml"),
      "prompt_tokens_used metric with alert pagerduty\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-budget-monitoring"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "context-budget-monitoring", "sample.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        emitCoveragePct: 80,
        saturationAlertConfigured: true,
        alertNotifyProven: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-budget-monitoring smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
