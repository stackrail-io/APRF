/**
 * Smoke: ai-error-budget-release-gate needs policy + gated event ≤90d for PASS.
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
  aiErrorBudgetReleaseGateCollector,
  type AiErrorBudgetReleaseGateReport,
} from "../collectors/ai-error-budget-release-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiErrorBudgetReleaseGateReport> {
  await aiErrorBudgetReleaseGateCollector.collect({
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
        "ai-error-budget-release-gate",
        "ai-error-budget-release-gate-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-perf-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "error-budget.md"),
      "Error budget policy draft for AI journeys\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.perfR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "release-freeze.md"),
      "Error budget release freeze and risk acceptance; gated release drill\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-error-budget-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-error-budget-release-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance: true,
        gatedEventOrDrillWithin90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (
      r2.summary.statusHint !== "pass" ||
      r2.summary.perfR1Satisfied !== true
    ) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "budget-policy.md"),
      "SLO budget policy notes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-error-budget-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-error-budget-release-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance: true,
        lastGatedEventAgeDays: 120,
      }),
    );
    const r3 = await run(t3, out3);
    if (
      r3.summary.statusHint !== "fail" ||
      r3.summary.perfR1Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-error-budget-release-gate smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
