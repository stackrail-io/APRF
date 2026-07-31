/**
 * Smoke: eval-suite-ci needs full journey + change coverage for PASS.
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
  evalSuiteCiCollector,
  type EvalSuiteCiReport,
} from "../collectors/eval-suite-ci.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(target: string, outDir: string): Promise<EvalSuiteCiReport> {
  await evalSuiteCiCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "eval-suite-ci", "eval-suite-ci-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "promptfooconfig.yaml"),
      "description: offline eval suite for critical journey checkout\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    mkdirSync(join(t2, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "journey_eval.yaml"),
      "eval_suite: critical_journey_registry offline eval\n",
    );
    writeFileSync(
      join(t2, ".github", "workflows", "eval.yml"),
      "on:\n  pull_request:\njobs:\n  eval:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx promptfoo eval\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-suite-ci"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-suite-ci", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criticalJourneysMissingSuite: 0,
        relevantChangesMissingTriggerOrWaiver: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "golden_suite.md"),
      "golden suite offline eval harness\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-suite-ci"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-suite-ci", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criticalJourneysMissingSuite: 2,
        relevantChangesMissingTriggerOrWaiver: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("eval-suite-ci smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
