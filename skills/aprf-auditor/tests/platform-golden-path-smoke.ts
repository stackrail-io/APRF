/**
 * Smoke: platform-golden-path needs doc + imported review attestation for PASS.
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
  platformGoldenPathCollector,
  type PlatformGoldenPathReport,
} from "../collectors/platform-golden-path.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformGoldenPathReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-golden-path",
        "platform-golden-path-report.json",
      ),
      "utf8",
    ),
  ) as PlatformGoldenPathReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxm1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxm1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformGoldenPathCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "docs", "platform"), { recursive: true });
  writeFileSync(
    join(targetDir, "docs", "platform", "ai_golden_path.md"),
    `
# AI golden path — deploy GenAI features to production

## Authentication
Use OIDC / SSO for the AI gateway.

## Secrets
Store provider keys in secrets manager — never in prompts.

## Evals
Run promptfoo / evaluation suite before promote.

## Promote
Staging then production promote via change gate.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxm1-1-"));
  await platformGoldenPathCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.docPresent ||
    !r1.summary.sectionsComplete
  ) {
    throw new Error(`expected partial with sections, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxm1-2-"));
  mkdirSync(join(out2, "imports", "platform-golden-path"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "platform-golden-path", "review.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 30,
      docPresent: true,
      hasVersion: true,
      version: "1.4.0",
      hasOwner: true,
      owner: "platform-ai",
      coversAuth: true,
      coversSecrets: true,
      coversEvals: true,
      coversPromote: true,
      reviewedWithin12Months: true,
    }),
    "utf8",
  );
  await platformGoldenPathCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxM1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-golden-path smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
