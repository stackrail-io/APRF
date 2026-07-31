/**
 * Smoke: ai-spend-limits needs limit config + imported enforce for PASS.
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
  aiSpendLimitsCollector,
  type AiSpendLimitsReport,
} from "../collectors/ai-spend-limits.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiSpendLimitsReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-spend-limits", "ai-spend-limits-report.json"),
      "utf8",
    ),
  ) as AiSpendLimitsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costm1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costm1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiSpendLimitsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "config"), { recursive: true });
  writeFileSync(
    join(targetDir, "config", "openai_rate_limit.yaml"),
    `
# openai llm spend_cap / rate_limit (TPM)
max_tokens_per_minute: 100000
spend_ceiling_usd_daily: 500
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_rate_limit.py"),
    `
def test_quota_exceed_throttled():
    assert deny_or_throttle_when_rate_limit_exceeded()
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costm1-1-"));
  await aiSpendLimitsCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.limitPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costm1-2-"));
  mkdirSync(join(out2, "imports", "ai-spend-limits"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-spend-limits", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 7,
      enforcedDenyOrThrottle: true,
      results: [{ denied: true, throttled: false }],
    }),
    "utf8",
  );
  await aiSpendLimitsCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costM1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-spend-limits smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
