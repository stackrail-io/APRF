/**
 * Smoke: prompt-change-review-eval needs 0 missing review/eval + blocking gate for PASS.
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
  promptChangeReviewEvalCollector,
  type PromptChangeReviewEvalReport,
} from "../collectors/prompt-change-review-eval.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptChangeReviewEvalReport> {
  await promptChangeReviewEvalCollector.collect({
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
        "prompt-change-review-eval",
        "prompt-change-review-eval-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t1, ".github", "workflows", "prompt-release.yml"),
      "name: prompt-release\non: push\njobs:\n  gate:\n    steps:\n      - run: echo require prompt_review and eval_pass_artifact\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "prompt-release.md"),
      "prompt release requires review_id and eval pass artifact\nblock promote without both\nfail closed\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-change-review-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "prompt-change-review-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        releasesMissingReviewOrEval: 0,
        promoteWithoutReviewAndEvalBlocked: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ci"), { recursive: true });
    writeFileSync(
      join(t3, "ci", "prompt-promote.yaml"),
      "prompt_promotion:\n  review_id_required: true\n  eval_before_release: true\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-change-review-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-change-review-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        releasesMissingReviewOrEval: 2,
        promoteWithoutReviewAndEvalBlocked: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-change-review-eval smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
