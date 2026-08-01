/**
 * Smoke: ai-fairness-eval — N/A without high-stakes; PASS with inventory+eval; fail if incomplete.
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
  aiFairnessEvalCollector,
  type AiFairnessEvalReport,
} from "../collectors/ai-fairness-eval.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiFairnessEvalReport> {
  await aiFairnessEvalCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-fairness-eval", "ai-fairness-eval-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "fairness.md"),
      "fairness disparity demographic_parity for hiring decisions\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const tNa = join(root, "tna");
    mkdirSync(join(tNa, "docs"), { recursive: true });
    writeFileSync(join(tNa, "docs", "readme.md"), "internal docs assistant\n");
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-fairness-eval"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-fairness-eval", "scope.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highStakesDecisionPathsPresent: false,
      }),
    );
    const rNa = await run(tNa, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "compliance"), { recursive: true });
    writeFileSync(
      join(t2, "compliance", "high-stakes-paths.md"),
      "high_stakes_decision_path_inventory lending credit_scoring\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-fairness-eval"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-fairness-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highStakesDecisionPathsPresent: true,
        highStakesDecisionPathsInventoried: true,
        latestFairnessEvalWithin90DaysWithThresholdsAndOwners: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "bias-eval.md"),
      "bias_eval underwriting fairness incomplete\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-fairness-eval"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-fairness-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highStakesDecisionPathsPresent: true,
        highStakesDecisionPathsInventoried: true,
        latestFairnessEvalWithin90DaysWithThresholdsAndOwners: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safM4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-fairness-eval smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
