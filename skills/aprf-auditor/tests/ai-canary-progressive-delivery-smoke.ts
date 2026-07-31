/**
 * Smoke: ai-canary-progressive-delivery needs canary + rollback criteria + metrics link for PASS.
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
  aiCanaryProgressiveDeliveryCollector,
  type AiCanaryProgressiveDeliveryReport,
} from "../collectors/ai-canary-progressive-delivery.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiCanaryProgressiveDeliveryReport> {
  await aiCanaryProgressiveDeliveryCollector.collect({
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
        "ai-canary-progressive-delivery",
        "ai-canary-progressive-delivery-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "deploy"), { recursive: true });
    writeFileSync(
      join(t1, "deploy", "prompt-canary.yaml"),
      "strategy: canary\nprompt_rollout: progressive delivery\nautomated_rollback: abort_on_slo\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "deploy"), { recursive: true });
    writeFileSync(
      join(t2, "deploy", "model-canary.md"),
      "canary progressive rollout for model pins with automated rollback criteria and canary metrics grafana link\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-canary-progressive-delivery"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-canary-progressive-delivery", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficAiChangeCount: 2,
        canaryOrProgressiveConfigured: true,
        automatedRollbackCriteriaPresent: true,
        lastHighTrafficReleaseHasCanaryMetricsLink: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "deploy"), { recursive: true });
    writeFileSync(
      join(t3, "deploy", "tool-canary.md"),
      "flagger canary for tool catalog changes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-canary-progressive-delivery"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-canary-progressive-delivery", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficAiChangeCount: 1,
        canaryOrProgressiveConfigured: true,
        automatedRollbackCriteriaPresent: true,
        lastHighTrafficReleaseHasCanaryMetricsLink: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(t4, { recursive: true });
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "ai-canary-progressive-delivery"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "ai-canary-progressive-delivery", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficAiChangeCount: 0,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r4.summary)}`);
    }

    console.log("ai-canary-progressive-delivery smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
