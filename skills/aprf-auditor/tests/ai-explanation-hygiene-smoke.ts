/**
 * Smoke: ai-explanation-hygiene needs policy + 100% synthetic + 0 sample hits.
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
  aiExplanationHygieneCollector,
  type AiExplanationHygieneReport,
} from "../collectors/ai-explanation-hygiene.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiExplanationHygieneReport> {
  await aiExplanationHygieneCollector.collect({
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
        "ai-explanation-hygiene",
        "ai-explanation-hygiene-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "explanation-policy.md"),
      "User-facing rationale explanation must redact secrets\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "tests"), { recursive: true });
    writeFileSync(
      join(t2, "tests", "explanation_redaction_test.ts"),
      "synthetic_secret fixture explanation_redaction_test scrubber\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-explanation-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-explanation-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        explanationRedactionPolicyConfigured: true,
        syntheticSecretPiiRedactedOrBlockedPct: 100,
        productionExplanationSampleSecretHits: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "scans"), { recursive: true });
    writeFileSync(
      join(t3, "scans", "explanation_sample_scan.md"),
      "production_explanation sample_scan secret_pattern_hit\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-explanation-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-explanation-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        explanationRedactionPolicyConfigured: true,
        syntheticSecretPiiRedactedOrBlockedPct: 100,
        productionExplanationSampleSecretHits: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-explanation-hygiene smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
