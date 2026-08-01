/**
 * Smoke: ai-safety-eval-gates needs suite + 100% coverage + blocking/waivers.
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
  aiSafetyEvalGatesCollector,
  type AiSafetyEvalGatesReport,
} from "../collectors/ai-safety-eval-gates.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiSafetyEvalGatesReport> {
  await aiSafetyEvalGatesCollector.collect({
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
        "ai-safety-eval-gates",
        "ai-safety-eval-gates-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "safety-suite.yml"),
      "safety_eval suite with toxicity_threshold and block_promote\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t2, ".github", "workflows", "safety-gate.yml"),
      "safety_ci_gate block_deploy required_check waiver expiry\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-safety-eval-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-safety-eval-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        safetySuiteWithNumericThresholdsConfigured: true,
        inScopeReleasesWithSafetyGatePct: 100,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "content-safety-eval.md"),
      "content_safety_eval safety_threshold optional job\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-safety-eval-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-safety-eval-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        safetySuiteWithNumericThresholdsConfigured: true,
        inScopeReleasesWithSafetyGatePct: 70,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-safety-eval-gates smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
