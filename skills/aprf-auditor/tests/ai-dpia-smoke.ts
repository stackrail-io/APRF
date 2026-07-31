/**
 * Smoke: ai-dpia needs completed signed assessments before production.
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
  aiDpiaCollector,
  type AiDpiaReport,
} from "../collectors/ai-dpia.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiDpiaReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-dpia", "ai-dpia-report.json"),
      "utf8",
    ),
  ) as AiDpiaReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-prim4-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-prim4-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiDpiaCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "privacy"), { recursive: true });
  writeFileSync(
    join(targetDir, "privacy", "assistant-dpia.md"),
    `
# DPIA — Customer assistant AI feature

Privacy impact assessment for the major AI feature.
Signed by: privacy-owner@example.com
Sign-off before production traffic.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-prim4-1-"));
  await aiDpiaCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.assessmentSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-prim4-2-"));
  mkdirSync(join(out2, "imports", "ai-dpia"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-dpia", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 2,
      coversAllMajorAiFeatures: true,
      missingAssessmentCount: 0,
      missingSignOffCount: 0,
      postProductionSignOffCount: 0,
      features: [
        {
          name: "customer-assistant",
          assessmentCompleted: true,
          ownerSignOff: true,
          signedBeforeProduction: true,
        },
      ],
    }),
    "utf8",
  );
  await aiDpiaCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.priR3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-prim4-3-"));
  mkdirSync(join(out3, "imports", "ai-dpia"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "ai-dpia", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllMajorAiFeatures: true,
      features: [
        {
          name: "late",
          assessmentCompleted: true,
          ownerSignOff: true,
          signedBeforeProduction: false,
        },
      ],
    }),
    "utf8",
  );
  await aiDpiaCollector.collect({ ...baseCtx, outputDir: out3 });
  const r3 = readReport(out3);
  if (
    r3.summary.statusHint !== "fail" ||
    r3.importedResults.postProductionSignOffCount !== 1
  ) {
    throw new Error(
      `expected fail on post-prod sign-off, got ${JSON.stringify(r3.summary)} post=${r3.importedResults.postProductionSignOffCount}`,
    );
  }

  console.log("ai-dpia smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
