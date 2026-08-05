/**
 * Smoke: ai-artifact-promotion-path needs path + 100% coverage + 0 hot-edits for PASS.
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
  aiArtifactPromotionPathCollector,
  type AiArtifactPromotionPathReport,
} from "../collectors/ai-artifact-promotion-path.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiArtifactPromotionPathReport> {
  await aiArtifactPromotionPathCollector.collect({
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
        "ai-artifact-promotion-path",
        "ai-artifact-promotion-path-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "prompt-promotion.md"),
      "Promote prompts and model pins from staging to prod via release pipeline\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }
    if (
      !r1.gapNotes?.some((n) =>
        /Document the non-prod→prod promotion path/i.test(n),
      )
    ) {
      throw new Error(
        `expected customer-facing gapNotes, got ${JSON.stringify(r1.gapNotes)}`,
      );
    }
    if (
      r1.gapNotes?.some((n) =>
        /promotionPathDocumented|releasesThroughPromotionPathPct/i.test(n),
      )
    ) {
      throw new Error(
        `gapNotes must not expose raw import field names: ${JSON.stringify(r1.gapNotes)}`,
      );
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t2, ".github", "workflows", "promote-prompts.yml"),
      "name: promote\non: workflow_dispatch\njobs:\n  promote:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo promote prompts models tools non-prod to prod\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-artifact-promotion-path"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-artifact-promotion-path", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promotionPathDocumented: true,
        releasesThroughPromotionPathPct: 100,
        productionHotEditsWithoutChangeRecord: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "model-promotion.md"),
      "staging to prod promotion for model pins\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-artifact-promotion-path"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-artifact-promotion-path", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promotionPathDocumented: true,
        releasesThroughPromotionPathPct: 80,
        productionHotEditsWithoutChangeRecord: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-artifact-promotion-path smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
