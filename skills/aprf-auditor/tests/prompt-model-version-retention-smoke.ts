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

    // Explicit inUse=false for both → NOT_APPLICABLE (even with prompt/model signals)
    const t4 = join(root, "t4");
    mkdirSync(join(t4, "ops"), { recursive: true });
    writeFileSync(
      join(t4, "ops", "prompt-and-pin.md"),
      "prompt registry and model pin version retention restore dry-run\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        prompts: { inUse: false },
        modelPins: { inUse: false },
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.summary.statusHint !== "not_applicable" ||
      r4.summary.inScopeArtifactTypes.length !== 0 ||
      r4.summary.chgM1Satisfied !== null ||
      r4.signals.promptsPresent !== true ||
      r4.signals.modelPinsPresent !== true
    ) {
      throw new Error(
        `inUse=false N/A expected: ${JSON.stringify({ summary: r4.summary, signals: r4.signals })}`,
      );
    }

    // Stale measuredAt (>90d) blocks PASS even with complete per-type evidence
    const t5 = join(root, "t5");
    mkdirSync(join(t5, "ops"), { recursive: true });
    writeFileSync(
      join(t5, "ops", "prompt-registry.md"),
      "prompt registry retention restore dry-run immediate prior\n",
    );
    const out5 = join(root, "o5");
    mkdirSync(join(out5, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    const stale = new Date();
    stale.setUTCDate(stale.getUTCDate() - 120);
    writeFileSync(
      join(out5, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: stale.toISOString(),
        artifactTypesInUse: ["prompts"],
        retainedPriorProductionVersions: 3,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r5 = await run(t5, out5);
    if (
      r5.summary.statusHint !== "partial" ||
      r5.summary.chgM1Satisfied !== false
    ) {
      throw new Error(`stale measuredAt partial expected: ${JSON.stringify(r5.summary)}`);
    }

    // Provider SDK import alone must not invent modelPins scope
    const t6 = join(root, "t6");
    mkdirSync(join(t6, "src"), { recursive: true });
    mkdirSync(join(t6, "docs"), { recursive: true });
    writeFileSync(
      join(t6, "src", "client.ts"),
      'import OpenAI from "openai";\n// system prompt template for chat\n',
    );
    writeFileSync(
      join(t6, "docs", "version-retention.md"),
      "version retention policy keep last 3 prior production versions\nprompt registry restore dry-run\n",
    );
    const out6 = join(root, "o6");
    mkdirSync(join(out6, "imports", "prompt-model-version-retention"), {
      recursive: true,
    });
    writeFileSync(
      join(out6, "imports", "prompt-model-version-retention", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retainedPriorProductionVersions: 3,
        immediatePriorRestoreDryRunPassed: true,
      }),
    );
    const r6 = await run(t6, out6);
    if (
      r6.signals.modelPinsPresent !== false ||
      !r6.summary.inScopeArtifactTypes.includes("prompts") ||
      r6.summary.inScopeArtifactTypes.includes("modelPins") ||
      r6.summary.statusHint !== "pass"
    ) {
      throw new Error(
        `provider SDK must not invent modelPins: ${JSON.stringify({ signals: r6.signals, summary: r6.summary })}`,
      );
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
