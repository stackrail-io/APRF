/**
 * Smoke: eval-shadow-cutover needs shadow coverage + criteria-before-full-traffic for PASS.
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
  evalShadowCutoverCollector,
  type EvalShadowCutoverReport,
} from "../collectors/eval-shadow-cutover.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EvalShadowCutoverReport> {
  await evalShadowCutoverCollector.collect({
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
        "eval-shadow-cutover",
        "eval-shadow-cutover-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "deploy"), { recursive: true });
    writeFileSync(
      join(t1, "deploy", "shadow_canary.yml"),
      "shadow_deploy:\n  canary_traffic: 5%\n  eval_comparison: true\n  promotion_criteria:\n    quality_delta_max: 0.02\n  promote_to_full_traffic: after_pass\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "deploy"), { recursive: true });
    writeFileSync(
      join(t2, "deploy", "cutover.md"),
      "high-risk model cutover uses shadow deploy with eval comparison and promotion criteria before 100% traffic\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-shadow-cutover"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-shadow-cutover", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highRiskCutoverCount: 1,
        highRiskCutoversMissingShadowComparison: 0,
        promotionCriteriaMetBeforeFullTraffic: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "deploy"), { recursive: true });
    writeFileSync(
      join(t3, "deploy", "canary.yaml"),
      "canary_deploy eval comparison promotion criteria\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-shadow-cutover"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-shadow-cutover", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highRiskCutoverCount: 1,
        highRiskCutoversMissingShadowComparison: 1,
        promotionCriteriaMetBeforeFullTraffic: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlM4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(join(t4, "docs", "readme.md"), "llm service\n");
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "eval-shadow-cutover"), { recursive: true });
    writeFileSync(
      join(out4, "imports", "eval-shadow-cutover", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highRiskCutoverCount: 0,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r4.summary)}`);
    }

    console.log("eval-shadow-cutover smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
