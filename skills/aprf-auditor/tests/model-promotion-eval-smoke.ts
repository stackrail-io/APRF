/**
 * Smoke: model-promotion-eval needs zero missing eval artifacts + blocking gate for PASS.
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
  modelPromotionEvalCollector,
  type ModelPromotionEvalReport,
} from "../collectors/model-promotion-eval.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelPromotionEvalReport> {
  await modelPromotionEvalCollector.collect({
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
        "model-promotion-eval",
        "model-promotion-eval-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t1, ".github", "workflows", "model-promote.yml"),
      "name: model-promote\non: push\njobs:\n  eval:\n    steps:\n      - run: echo require_eval_before_promote\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "model-promotion.md"),
      "model promotion requires eval pass artifact\nblock promote without eval\nfail closed on missing eval gate\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-promotion-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-promotion-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promotionsMissingEvalArtifact: 0,
        promoteWithoutEvalBlocked: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ci"), { recursive: true });
    writeFileSync(
      join(t3, "ci", "promote.yaml"),
      "model_version_bump:\n  require_eval: true\n  block_promote: true\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-promotion-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-promotion-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promotionsMissingEvalArtifact: 1,
        promoteWithoutEvalBlocked: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // Regression: evalRequiredOnPromotion must override earlier blockingGate=false.
    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(
      join(t4, "docs", "model-promotion.md"),
      "model promotion requires eval pass artifact\nblock promote without eval\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "model-promotion-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "model-promotion-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promotionsMissingEvalArtifact: 0,
        blockingGate: false,
        evalRequiredOnPromotion: true,
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.summary.statusHint !== "pass" ||
      r4.summary.modM2Satisfied !== true ||
      r4.importedResults.promoteWithoutEvalBlocked !== true
    ) {
      throw new Error(
        `evalRequired should override blockingGate false: ${JSON.stringify(r4.summary)} ${JSON.stringify(r4.importedResults)}`,
      );
    }

    console.log("model-promotion-eval smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
