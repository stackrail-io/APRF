/**
 * Smoke: prompt-version-registry needs 0 unversioned + 0 missing owners for PASS.
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
  promptVersionRegistryCollector,
  type PromptVersionRegistryReport,
} from "../collectors/prompt-version-registry.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptVersionRegistryReport> {
  await promptVersionRegistryCollector.collect({
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
        "prompt-version-registry",
        "prompt-version-registry-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "prompts"), { recursive: true });
    writeFileSync(
      join(t1, "prompts", "registry.yml"),
      "prompt_registry:\n  - id: support.v1\n    prompt_version: 1.0.0\n    owner: platform\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "prompts"), { recursive: true });
    writeFileSync(
      join(t2, "prompts", "catalog.md"),
      "# Prompt registry\nprompt_version: 2026.01.01\nowner: llm-platform\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-version-registry"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "prompt-version-registry", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unversionedProductionPrompts: 0,
        productionPromptsMissingOwner: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "prompts"), { recursive: true });
    writeFileSync(
      join(t3, "prompts", "system.prompt.md"),
      "system prompt template with prompt_version field\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-version-registry"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-version-registry", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unversionedProductionPrompts: 2,
        productionPromptsMissingOwner: 1,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-version-registry smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
