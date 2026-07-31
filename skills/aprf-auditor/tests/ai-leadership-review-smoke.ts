import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiLeadershipReviewCollector,
  type AiLeadershipReviewReport,
} from "../collectors/ai-leadership-review.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(target: string, outDir: string): Promise<AiLeadershipReviewReport> {
  await aiLeadershipReviewCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-leadership-review", "ai-leadership-review-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-org-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "leadership_ai_risk_review.md"),
      "Leadership review of AI risk posture and APRF maturity with action log\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || r1.summary.orgR1Satisfied !== false) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(join(t2, "docs", "board_pack.md"), "AI risk posture leadership review\n");
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-leadership-review"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-leadership-review", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        reviewAgeDays: 30,
        openActionsIncomplete: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.orgR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(join(t3, "docs", "aprf_maturity.md"), "APRF maturity leadership review action owner\n");
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-leadership-review"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-leadership-review", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        reviewAgeDays: 120,
        openActionsIncomplete: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.orgR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("ai-leadership-review smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
