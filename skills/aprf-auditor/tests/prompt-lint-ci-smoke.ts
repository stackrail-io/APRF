/**
 * Smoke: prompt-lint-ci needs PR coverage + blocking rules + retained fail for PASS.
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
  promptLintCiCollector,
  type PromptLintCiReport,
} from "../collectors/prompt-lint-ci.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptLintCiReport> {
  await promptLintCiCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "prompt-lint-ci", "prompt-lint-ci-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t1, ".github", "workflows", "prompt-lint.yml"),
      "name: prompt-lint\non: pull_request\njobs:\n  lint:\n    steps:\n      - run: echo check length limit and injection-prone constructs\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ci"), { recursive: true });
    writeFileSync(
      join(t2, "ci", "prompt-lint.yaml"),
      "prompt_lint:\n  required_check: true\n  fail_the_build: true\n  rules: [length_limit, secret_pattern, injection_prone, unbounded_user_concat]\n  last_failing_lint_example: retained\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-lint-ci"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "prompt-lint-ci", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promptChangePrsMissingLint: 0,
        blockingPromptLintRulesPresent: true,
        lastFailingLintExampleRetained: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "prompts"), { recursive: true });
    writeFileSync(
      join(t3, "prompts", "system.prompt.md"),
      "system prompt\nprompt lint workflow notes\n",
    );
    writeFileSync(
      join(t3, "prompts", "lint-notes.md"),
      "prompt-lint required_check blocking length_limit\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-lint-ci"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "prompt-lint-ci", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        promptChangePrsMissingLint: 2,
        blockingPromptLintRulesPresent: true,
        lastFailingLintExampleRetained: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-lint-ci smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
