/**
 * Smoke: prompt-template-hygiene needs 0 missing params + 0 secrets + 0 PII for PASS.
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
  promptTemplateHygieneCollector,
  type PromptTemplateHygieneReport,
} from "../collectors/prompt-template-hygiene.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptTemplateHygieneReport> {
  await promptTemplateHygieneCollector.collect({
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
        "prompt-template-hygiene",
        "prompt-template-hygiene-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "prompts"), { recursive: true });
    writeFileSync(
      join(t1, "prompts", "support.prompt.md"),
      "You are a helper. User question: {{user_question}}\nparameterized template\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "prompt-template-inventory.md"),
      "prompt template inventory\nparameterized slots\nno hardcoded secrets in prompts\ncustomer pii in prompt scan clean\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-template-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "prompt-template-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        templatesMissingParameters: 0,
        hardcodedSecretsInTemplates: 0,
        hardcodedPiiInTemplates: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "prompts"), { recursive: true });
    writeFileSync(
      join(t3, "prompts", "system.prompt.md"),
      "system prompt template with {{context}}\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-template-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-template-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        templatesMissingParameters: 0,
        hardcodedSecretsInTemplates: 1,
        hardcodedPiiInTemplates: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-template-hygiene smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
