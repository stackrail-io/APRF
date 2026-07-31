/**
 * Smoke: eval-online-signals needs both metrics + cadence + ≤24h freshness for PASS.
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
  evalOnlineSignalsCollector,
  type EvalOnlineSignalsReport,
} from "../collectors/eval-online-signals.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EvalOnlineSignalsReport> {
  await evalOnlineSignalsCollector.collect({
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
        "eval-online-signals",
        "eval-online-signals-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "ai_metrics.yml"),
      "dashboard:\n  - task_success_rate\n  - task_failure_rate\n  - safety_refusal_rate\n  alert: on-call review cadence\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "grafana_ai.md"),
      "prometheus metric task_success and safety_refusal_rate with alert pager\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-online-signals"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-online-signals", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        taskSuccessFailureMetricPresent: true,
        safetyRefusalMetricPresent: true,
        alertOrReviewCadenceDefined: true,
        dashboardFreshnessHours: 6,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "datadog_ai.yml"),
      "task_failure_rate metric and safety refusal rate dashboard\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-online-signals"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-online-signals", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        taskSuccessFailureMetricPresent: true,
        safetyRefusalMetricPresent: true,
        alertOrReviewCadenceDefined: true,
        dashboardFreshnessHours: 48,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("eval-online-signals smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
