/**
 * Smoke: platform-ai-pipeline-gates needs all three gates + blocking import for PASS.
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
  platformAiPipelineGatesCollector,
  type PlatformAiPipelineGatesReport,
} from "../collectors/platform-ai-pipeline-gates.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformAiPipelineGatesReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-ai-pipeline-gates",
        "platform-ai-pipeline-gates-report.json",
      ),
      "utf8",
    ),
  ) as PlatformAiPipelineGatesReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxm2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxm2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformAiPipelineGatesCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(targetDir, ".github", "workflows", "ai-golden-path.yml"),
    `
name: AI golden path CI
on: [pull_request]
jobs:
  auth_check:
    runs-on: ubuntu-latest
    steps:
      - run: npm run auth-check
  secret_scan:
    runs-on: ubuntu-latest
    steps:
      - run: gitleaks detect
  basic_eval:
    runs-on: ubuntu-latest
    steps:
      - run: npx promptfoo eval
  # required_check / blocks_merge for golden_path template
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "README.md"),
    "# LLM chatbot with openai and promptfoo\n",
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxm2-1-"));
  await platformAiPipelineGatesCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.allThreeGatesPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxm2-2-"));
  mkdirSync(join(out2, "imports", "platform-ai-pipeline-gates"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "platform-ai-pipeline-gates", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 3,
      authGatePresent: true,
      secretScanPresent: true,
      evalGatePresent: true,
      blockingOnFail: true,
    }),
    "utf8",
  );
  await platformAiPipelineGatesCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-ai-pipeline-gates smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
