/**
 * Smoke: platform-inner-loop-evals needs runner + one-command + pre-PR sample for PASS.
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
  platformInnerLoopEvalsCollector,
  type PlatformInnerLoopEvalsReport,
} from "../collectors/platform-inner-loop-evals.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformInnerLoopEvalsReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-inner-loop-evals",
        "platform-inner-loop-evals-report.json",
      ),
      "utf8",
    ),
  ) as PlatformInnerLoopEvalsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxr2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxr2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformInnerLoopEvalsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  writeFileSync(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: "ai-app",
        scripts: {
          "eval:core": "npx promptfoo eval -c promptfooconfig.yaml",
        },
        dependencies: { openai: "4.0.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(targetDir, "README.md"),
    `# AI app
Run evals locally before PR: \`npm run eval:core\` (inner-loop / pre-PR eval).
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxr2-1-"));
  await platformInnerLoopEvalsCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.runnerPresent ||
    !r1.summary.oneCommandCapable
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxr2-2-"));
  mkdirSync(join(out2, "imports", "platform-inner-loop-evals"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "platform-inner-loop-evals", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 4,
      runnerPresent: true,
      oneCommandCapable: true,
      prePrEvalEvidence: true,
      waiverDocumented: false,
    }),
    "utf8",
  );
  await platformInnerLoopEvalsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxR2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-inner-loop-evals smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
