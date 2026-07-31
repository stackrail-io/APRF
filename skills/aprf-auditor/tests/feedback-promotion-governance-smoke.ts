/**
 * Smoke: feedback-promotion-governance needs gated paths + ungated deny for PASS.
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
  feedbackPromotionGovernanceCollector,
  type FeedbackPromotionGovernanceReport,
} from "../collectors/feedback-promotion-governance.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): FeedbackPromotionGovernanceReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "feedback-promotion-governance",
        "feedback-promotion-governance-report.json",
      ),
      "utf8",
    ),
  ) as FeedbackPromotionGovernanceReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgm3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgm3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await feedbackPromotionGovernanceCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "src", "memory"), { recursive: true });
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "src", "memory", "feedback_promotion.ts"),
    `
// Promote thumbs-up feedback to durable memory only after human approval / policy check.
export function promoteFeedback() {
  requireHumanApproval();
  writeDurableMemory();
}
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "tests", "ungated_promotion_deny.test.ts"),
    `
test("ungated promotion denied / fail closed without approval", () => {
  expect(() => promoteWithoutApproval()).toThrow();
});
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgm3-1-"));
  await feedbackPromotionGovernanceCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.promotionSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgm3-2-"));
  mkdirSync(join(out2, "imports", "feedback-promotion-governance"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "feedback-promotion-governance", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 1,
      coversAllPromotionPaths: true,
      promotionPathCount: 1,
      missingGateCount: 0,
      ungatedPromotionDenied: true,
      promotionPaths: [
        {
          id: "thumbs-to-durable",
          requiresHumanApproval: true,
          gated: true,
        },
      ],
    }),
    "utf8",
  );
  await feedbackPromotionGovernanceCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgM3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("feedback-promotion-governance smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
