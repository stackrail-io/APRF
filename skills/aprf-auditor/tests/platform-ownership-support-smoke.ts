/**
 * Smoke: platform-ownership-support needs owner+channel+reachability import for PASS.
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
  platformOwnershipSupportCollector,
  type PlatformOwnershipSupportReport,
} from "../collectors/platform-ownership-support.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformOwnershipSupportReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-ownership-support",
        "platform-ownership-support-report.json",
      ),
      "utf8",
    ),
  ) as PlatformOwnershipSupportReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxm3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxm3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformOwnershipSupportCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "docs", "platform"), { recursive: true });
  writeFileSync(
    join(targetDir, "docs", "platform", "ai-platform-support.md"),
    `
# AI platform paved road — ownership & support

## Owner team
Platform owner team: ai-platform-eng

## Support channel
Slack #ai-platform-support — ticket queue also available.

## On-call
PagerDuty on-call rotation for the AI platform.
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "README.md"),
    "# LLM chatbot with openai and promptfoo\n",
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxm3-1-"));
  await platformOwnershipSupportCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.ownerAndChannelPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxm3-2-"));
  mkdirSync(join(out2, "imports", "platform-ownership-support"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "platform-ownership-support", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 5,
      ownerTeamPresent: true,
      supportChannelPresent: true,
      pingWithinSla: true,
      onCallListed: false,
      ownerTeam: "ai-platform-eng",
      supportChannel: "#ai-platform-support",
    }),
    "utf8",
  );
  await platformOwnershipSupportCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxR4Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-ownership-support smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
