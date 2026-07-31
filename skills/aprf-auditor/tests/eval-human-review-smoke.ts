/**
 * Smoke: eval-human-review needs cadence + fresh sample + adjudication for PASS.
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
  evalHumanReviewCollector,
  type EvalHumanReviewReport,
} from "../collectors/eval-human-review.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EvalHumanReviewReport> {
  await evalHumanReviewCollector.collect({
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
        "eval-human-review",
        "eval-human-review-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "human_preference.md"),
      "human preference sampling protocol\ncadence: weekly\nsample size: 50\nadjudication on disagreement\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "expert_review.yml"),
      "expert_review:\n  sampling_cadence: monthly\n  sample_size: 40\n  inter_rater: true\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-human-review"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-human-review", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        cadenceAndSampleSizeDefined: true,
        lastSampleAgeDays: 14,
        productionLikeCoverage: true,
        disagreementsMissingAdjudication: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "preference.yaml"),
      "human preference eval sampling protocol weekly\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-human-review"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-human-review", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        cadenceAndSampleSizeDefined: true,
        lastSampleAgeDays: 120,
        productionLikeCoverage: true,
        disagreementsMissingAdjudication: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("eval-human-review smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
