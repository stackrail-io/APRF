/**
 * Smoke: prompt-ab-shadow-eval needs A/B/shadow + metrics + non-inferiority for PASS.
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
  promptAbShadowEvalCollector,
  type PromptAbShadowEvalReport,
} from "../collectors/prompt-ab-shadow-eval.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptAbShadowEvalReport> {
  await promptAbShadowEvalCollector.collect({
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
        "prompt-ab-shadow-eval",
        "prompt-ab-shadow-eval-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "experiments"), { recursive: true });
    writeFileSync(
      join(t1, "experiments", "prompt-ab.md"),
      "high-traffic prompt change uses a/b test and shadow eval\npre-registered metrics: primary quality SLI\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "prompt-shadow-eval.md"),
      "prompt shadow eval for high-traffic changes\npromotion criteria: non-inferiority on safety and quality\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-ab-shadow-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "prompt-ab-shadow-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficPromptChangeCount: 1,
        lastHighTrafficPromptChangeUsedAbOrShadow: true,
        preRegisteredMetricsPresent: true,
        promotionRequiredNonInferiority: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "prompts"), { recursive: true });
    writeFileSync(
      join(t3, "prompts", "canary.md"),
      "canary prompt experiment without gate\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-ab-shadow-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "prompt-ab-shadow-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficPromptChangeCount: 1,
        lastHighTrafficPromptChangeUsedAbOrShadow: true,
        preRegisteredMetricsPresent: true,
        promotionRequiredNonInferiority: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(join(t4, "docs", "readme.md"), "no prompts here\n");
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "prompt-ab-shadow-eval"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "prompt-ab-shadow-eval", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highTrafficPromptChangeCount: 0,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r4.summary)}`);
    }

    console.log("prompt-ab-shadow-eval smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
