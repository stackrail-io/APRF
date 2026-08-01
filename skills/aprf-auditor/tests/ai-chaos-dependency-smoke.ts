/**
 * Smoke: ai-chaos-dependency needs AI-mode plan + ≤180d exercise + actions.
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
  aiChaosDependencyCollector,
  type AiChaosDependencyReport,
} from "../collectors/ai-chaos-dependency.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiChaosDependencyReport> {
  await aiChaosDependencyCollector.collect({
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
        "ai-chaos-dependency",
        "ai-chaos-dependency-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r5-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "chaos"), { recursive: true });
    writeFileSync(
      join(t1, "chaos", "plan.md"),
      "Chaos experiment plan for provider outage and tool failure\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR5Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "chaos"), { recursive: true });
    writeFileSync(
      join(t2, "chaos", "ai-dependency.md"),
      "AI dependency chaos: bedrock outage injection with after-action\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-chaos-dependency"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-chaos-dependency", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        chaosPlanCoversAiDependencies: true,
        aiDependencyChaosExerciseCompletedWithin180Days: true,
        afterActionRetainedWithActions: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR5Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "chaos"), { recursive: true });
    writeFileSync(
      join(t3, "chaos", "game-day.md"),
      "Litmus chaosmesh game day for openai gateway fail\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-chaos-dependency"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-chaos-dependency", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        chaosPlanCoversAiDependencies: true,
        aiDependencyChaosExerciseCompletedWithin180Days: false,
        afterActionRetainedWithActions: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR5Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-chaos-dependency smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
