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
  maxFiles = 2000,
): Promise<EvalReleaseGatesReport> {
  await evalReleaseGatesCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles,
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

    const tNoise = join(root, "t-noise");
    mkdirSync(join(tNoise, "docs"), { recursive: true });
    writeFileSync(
      join(tNoise, "docs", "user-journey.md"),
      "Customer journey docs mention a score threshold and benchmark quality.\n",
    );
    const rNoise = await run(tNoise, join(root, "o-noise"));
    if (rNoise.signals.thresholds.found) {
      throw new Error(
        `journey+threshold prose must not count as eval gates: ${JSON.stringify(rNoise.signals)}`,
      );
    }

    const tLate = join(root, "t-late");
    mkdirSync(join(tLate, "aaa"), { recursive: true });
    mkdirSync(join(tLate, "zzz", "evals"), { recursive: true });
    for (let i = 0; i < 2100; i++) {
      writeFileSync(
        join(tLate, "aaa", `pad-${String(i).padStart(4, "0")}.ts`),
        `export const n = ${i};\n`,
      );
    }
    writeFileSync(join(tLate, "zzz", "evals", "cases.json"), "{}\n");
    const rLate = await run(tLate, join(root, "o-late"), 10000);
    if (!rLate.summary.evalSignalsPresent) {
      throw new Error(
        `late evals/ path must remain in-scope with full maxFiles: ${JSON.stringify(rLate.summary)}`,
      );
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
