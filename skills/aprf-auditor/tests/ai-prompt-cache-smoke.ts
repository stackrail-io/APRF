/**
 * Smoke: ai-prompt-cache needs cache + exclusions + ≥30d report for PASS.
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
  aiPromptCacheCollector,
  type AiPromptCacheReport,
} from "../collectors/ai-prompt-cache.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiPromptCacheReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-prompt-cache", "ai-prompt-cache-report.json"),
      "utf8",
    ),
  ) as AiPromptCacheReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costr1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costr1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiPromptCacheCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "config"), { recursive: true });
  writeFileSync(
    join(targetDir, "config", "openai_prompt_cache.yaml"),
    `
# llm prompt_cache for idempotent completions
prompt_cache:
  enabled: true
  cache_exclude_personalized: true
  no_cache_pii: true
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costr1-1-"));
  await aiPromptCacheCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.cacheConfigPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costr1-2-"));
  mkdirSync(join(out2, "imports", "ai-prompt-cache"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-prompt-cache", "report.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 5,
      cacheEnabled: true,
      exclusionsDocumented: true,
      hitRateReported: true,
      hitRatePct: 42,
      savingsReported: true,
      tokensSaved: 1_200_000,
      reportWindowDays: 30,
    }),
    "utf8",
  );
  await aiPromptCacheCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costR1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-prompt-cache smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
