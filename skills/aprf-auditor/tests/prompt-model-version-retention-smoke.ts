/**
 * Smoke: prompt-model-version-retention needs ≥2 retained + dry-run for PASS.
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
  promptModelVersionRetentionCollector,
  type PromptModelVersionRetentionReport,
} from "../collectors/prompt-model-version-retention.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptModelVersionRetentionReport> {
  await promptModelVersionRetentionCollector.collect({
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
        "prompt-model-version-retention",
        "prompt-model-version-retention-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "version-retention.md"),
      "version retention policy keep last 3 prior production versions\nprompt registry and model registry\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "restore-dry-run.md"),
      "restore dry-run loads immediate prior version in staging\nmodel pin and prompt version registry\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retainedPriorProductionVersions: 3,
        policyMinimumN: 2,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "registry"), { recursive: true });
    writeFileSync(
      join(t3, "registry", "pins.md"),
      "pinned model versions retained\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retainedPriorProductionVersions: 1,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-model-version-retention smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
