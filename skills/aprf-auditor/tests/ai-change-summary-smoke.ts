/**
 * Smoke: ai-change-summary needs tooling + retained last-promotion summary.
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
  aiChangeSummaryCollector,
  type AiChangeSummaryReport,
} from "../collectors/ai-change-summary.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiChangeSummaryReport> {
  await aiChangeSummaryCollector.collect({
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
        "ai-change-summary",
        "ai-change-summary-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "change-summary-template.md"),
      "change_summary template for model_promotion\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "promotions"), { recursive: true });
    writeFileSync(
      join(t2, "promotions", "last_prompt_promotion.md"),
      "prompt_promotion retained_summary counterfactual_summary\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-change-summary"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-change-summary", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        changeOrCounterfactualSummaryToolingConfigured: true,
        lastMaterialPromotionHasRetainedSummary: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "promotions"), { recursive: true });
    writeFileSync(
      join(t3, "promotions", "model_diff.md"),
      "material_model_promotion without summary\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-change-summary"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-change-summary", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        changeOrCounterfactualSummaryToolingConfigured: true,
        lastMaterialPromotionHasRetainedSummary: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-change-summary smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
