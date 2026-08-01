/**
 * Smoke: ai-explainability-matrix needs matrix + 100% coverage + fresh owned review.
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
  aiExplainabilityMatrixCollector,
  type AiExplainabilityMatrixReport,
} from "../collectors/ai-explainability-matrix.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiExplainabilityMatrixReport> {
  await aiExplainabilityMatrixCollector.collect({
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
        "ai-explainability-matrix",
        "ai-explainability-matrix-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "explainability-matrix.md"),
      "explainability_requirements_matrix for regulated_ai features\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "compliance"), { recursive: true });
    writeFileSync(
      join(t2, "compliance", "matrix-review.md"),
      "matrix_review compliance_review reviewed_by owner\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-explainability-matrix"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-explainability-matrix", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        explainabilityMatrixConfigured: true,
        regulatedFeaturesWithExplanationRequirementPct: 100,
        matrixReviewedWithin12MonthsWithNamedOwner: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "regulated-features.md"),
      "high_risk_ai regulated_feature explainability_matrix incomplete\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-explainability-matrix"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-explainability-matrix", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        explainabilityMatrixConfigured: true,
        regulatedFeaturesWithExplanationRequirementPct: 70,
        matrixReviewedWithin12MonthsWithNamedOwner: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-explainability-matrix smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
