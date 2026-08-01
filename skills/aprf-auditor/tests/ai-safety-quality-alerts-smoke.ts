/**
 * Smoke: ai-safety-quality-alerts needs ≥2 paging signals + thresholds/owners + review for PASS.
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
  aiSafetyQualityAlertsCollector,
  type AiSafetyQualityAlertsReport,
} from "../collectors/ai-safety-quality-alerts.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiSafetyQualityAlertsReport> {
  await aiSafetyQualityAlertsCollector.collect({
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
        "ai-safety-quality-alerts",
        "ai-safety-quality-alerts-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "refusal-rate-alert.md"),
      "PagerDuty alert for refusal-rate spike\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "alerting"), { recursive: true });
    writeFileSync(
      join(t2, "alerting", "safety-quality-paging.yaml"),
      "on-call pages for toxicity and eval-score drop with threshold and owner\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-safety-quality-alerts"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-safety-quality-alerts", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        atLeastTwoNonInfraPagingSignals: true,
        eachSignalHasThresholdAndOwner: true,
        policyReviewedWithin90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "jailbreak-alert.md"),
      "On-call paging policy for jailbreak hit rate\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-safety-quality-alerts"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-safety-quality-alerts", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        nonInfraPagingSignalCount: 1,
        eachSignalHasThresholdAndOwner: true,
        policyReviewedWithin90Days: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-safety-quality-alerts smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
