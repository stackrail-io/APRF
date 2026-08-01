/**
 * Smoke: ai-safety-edge-sampling needs plan + fresh packet + backlog links.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aiSafetyEdgeSamplingCollector,
  type AiSafetyEdgeSamplingReport,
} from "../collectors/ai-safety-edge-sampling.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiSafetyEdgeSamplingReport> {
  await aiSafetyEdgeSamplingCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-safety-edge-sampling",
        "ai-safety-edge-sampling-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "safety-sampling-plan.md"),
      "safety_edge_case_sampling plan monthly sample_size\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "reviews"), { recursive: true });
    writeFileSync(
      join(t2, "reviews", "review-packet.md"),
      "review_packet disposition reviewer_name safety_backlog\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-safety-edge-sampling"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-safety-edge-sampling", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        safetyEdgeCaseSamplingPlanConfigured: true,
        lastPacketWithin90DaysWithDispositionsAndReviewers: true,
        backlogLinkedWhenNeeded: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "human-safety-review.md"),
      "human_safety_review edge_case incomplete packet\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-safety-edge-sampling"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-safety-edge-sampling", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        safetyEdgeCaseSamplingPlanConfigured: true,
        lastPacketWithin90DaysWithDispositionsAndReviewers: false,
        backlogLinkedWhenNeeded: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-safety-edge-sampling smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
