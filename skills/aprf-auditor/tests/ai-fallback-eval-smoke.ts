/**
 * Smoke: ai-fallback-eval needs config + exercise + quality/safety eval bars.
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
  aiFallbackEvalCollector,
  type AiFallbackEvalReport,
} from "../collectors/ai-fallback-eval.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiFallbackEvalReport> {
  await aiFallbackEvalCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-fallback-eval", "ai-fallback-eval-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "multi-provider-fallback.md"),
      "Secondary provider fallback path for llm\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "cross-region-failover.md"),
      "multi-region fallback + primary vs fallback quality bar eval\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-fallback-eval"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-fallback-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fallbackPathConfigured: true,
        fallbackExercisedWithin90Days: true,
        fallbackEvalMeetsQualitySafetyBars: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "fallback_exercise.md"),
      "fallback_test exercised secondary provider\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-fallback-eval"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-fallback-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fallbackPathConfigured: true,
        fallbackExercisedWithin90Days: true,
        fallbackEvalMeetsQualitySafetyBars: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-fallback-eval smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
