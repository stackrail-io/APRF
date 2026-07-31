/**
 * Smoke: ai-retry-amplification needs retry config + imported amp bound for PASS.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aiRetryAmplificationCollector,
  type AiRetryAmplificationReport,
} from "../collectors/ai-retry-amplification.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiRetryAmplificationReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-retry-amplification",
        "ai-retry-amplification-report.json",
      ),
      "utf8",
    ),
  ) as AiRetryAmplificationReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costm3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costm3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiRetryAmplificationCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "src"), { recursive: true });
  writeFileSync(
    join(targetDir, "src", "openai_client.py"),
    `
# openai llm client with finite max_retries + exponential_backoff
MAX_RETRIES = 3
backoff = "exponential_backoff"
max_steps = 20  # agent loop budget
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_retry_amplification.py"),
    `
def test_cost_bounded_under_retry_storm():
    assert amplification_hits_token_ceiling()
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costm3-1-"));
  await aiRetryAmplificationCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.retryOrLoopPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costm3-2-"));
  mkdirSync(join(out2, "imports", "ai-retry-amplification"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-retry-amplification", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 10,
      finiteRetries: true,
      finiteLoops: true,
      amplificationBounded: true,
      results: [{ bounded: true, ceilingHit: true }],
    }),
    "utf8",
  );
  await aiRetryAmplificationCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costM3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-retry-amplification smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
