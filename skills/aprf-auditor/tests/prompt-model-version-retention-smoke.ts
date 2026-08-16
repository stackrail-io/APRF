/**
 * Smoke: prompt-model-version-retention evaluates retention/restore per
 * in-scope artifact type (prompts and/or modelPins).
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
    // Signals without import → PARTIAL
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

    // Both artifact types in scope + per-type evidence → PASS
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
        policyMinimumN: 2,
        artifactTypesInUse: ["prompts", "modelPins"],
        prompts: {
          retainedPriorProductionVersions: 3,
          immediatePriorRestoreDryRunPassed: true,
        },
        modelPins: {
          retainedPriorProductionVersions: 2,
          immediatePriorRestoreDryRunPassed: true,
        },
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }
    if (
      r2.summary.perArtifactSatisfied.prompts !== true ||
      r2.summary.perArtifactSatisfied.modelPins !== true
    ) {
      throw new Error(`per-type pass expected: ${JSON.stringify(r2.summary)}`);
    }

    // Aggregate-only when both types in scope → PARTIAL (not PASS)
    const t2b = join(root, "t2b");
    mkdirSync(join(t2b, "ops"), { recursive: true });
    writeFileSync(
      join(t2b, "ops", "restore-dry-run.md"),
      "restore dry-run loads immediate prior version in staging\nmodel pin and prompt version registry\n",
    );
    const out2b = join(root, "o2b");
    mkdirSync(join(out2b, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out2b, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retainedPriorProductionVersions: 3,
        policyMinimumN: 2,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r2b = await run(t2b, out2b);
    if (
      r2b.summary.statusHint !== "partial" ||
      r2b.summary.chgM1Satisfied !== false
    ) {
      throw new Error(
        `aggregate-both partial expected: ${JSON.stringify(r2b.summary)}`,
      );
    }

    // Prompt-only + legacy aggregate → PASS
    const t2c = join(root, "t2c");
    mkdirSync(join(t2c, "ops"), { recursive: true });
    writeFileSync(
      join(t2c, "ops", "prompt-registry.md"),
      "prompt registry retention restore dry-run immediate prior\n",
    );
    const out2c = join(root, "o2c");
    mkdirSync(join(out2c, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out2c, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        artifactTypesInUse: ["prompts"],
        retainedPriorProductionVersions: 3,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r2c = await run(t2c, out2c);
    if (
      r2c.summary.statusHint !== "pass" ||
      r2c.summary.chgM1Satisfied !== true ||
      r2c.summary.perArtifactSatisfied.prompts !== true ||
      r2c.summary.perArtifactSatisfied.modelPins !== null
    ) {
      throw new Error(
        `prompt-only aggregate pass expected: ${JSON.stringify(r2c.summary)}`,
      );
    }

    // Both in scope; prompts pass, modelPins below N → FAIL
    const t3 = join(root, "t3");
    mkdirSync(join(t3, "registry"), { recursive: true });
    writeFileSync(
      join(t3, "registry", "pins.md"),
      "pinned model versions retained\nprompt registry\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        artifactTypesInUse: ["prompts", "modelPins"],
        prompts: {
          retainedPriorProductionVersions: 3,
          immediatePriorRestoreDryRunPassed: true,
        },
        modelPins: {
          retainedPriorProductionVersions: 1,
          immediatePriorRestoreDryRunPassed: true,
        },
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
