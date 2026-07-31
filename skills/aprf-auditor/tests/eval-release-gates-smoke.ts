/**
 * Smoke: eval-release-gates needs quality+safety coverage and blocking gate for PASS.
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
  evalReleaseGatesCollector,
  type EvalReleaseGatesReport,
} from "../collectors/eval-release-gates.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EvalReleaseGatesReport> {
  await evalReleaseGatesCollector.collect({
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
        "eval-release-gates",
        "eval-release-gates-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ci"), { recursive: true });
    writeFileSync(
      join(t1, "ci", "eval_gate.yml"),
      "release_gate:\n  quality_threshold: 0.85\n  safety_threshold: 0.99\n  block_deploy: true\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ci"), { recursive: true });
    writeFileSync(
      join(t2, "ci", "gates.yaml"),
      "eval_gate quality metric threshold\nsafety metric threshold\nblock deploy on fail\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-release-gates"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-release-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        journeysMissingQualityMetric: 0,
        journeysMissingSafetyMetric: 0,
        failingGateBlocksDeploy: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ci"), { recursive: true });
    writeFileSync(
      join(t3, "ci", "thresholds.md"),
      "numeric threshold for quality and safety release gate\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-release-gates"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-release-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        journeysMissingQualityMetric: 0,
        journeysMissingSafetyMetric: 1,
        failingGateBlocksDeploy: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("eval-release-gates smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
