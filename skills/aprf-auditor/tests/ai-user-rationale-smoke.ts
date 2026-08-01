/**
 * Smoke: ai-user-rationale needs catalog + ≥20 sample + 100% coverage + owned gaps.
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
  aiUserRationaleCollector,
  type AiUserRationaleReport,
} from "../collectors/ai-user-rationale.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiUserRationaleReport> {
  await aiUserRationaleCollector.collect({
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
        "ai-user-rationale",
        "ai-user-rationale-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "decision-catalog.md"),
      "material_decision catalog for automated_decision_type\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ui"), { recursive: true });
    writeFileSync(
      join(t2, "ui", "rationale.tsx"),
      "user_facing_rationale field + rationale_sample coverage\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-user-rationale"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-user-rationale", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        materialDecisionCatalogConfigured: true,
        sampleCaseCount: 20,
        materialTypesWithUserRationalePct: 100,
        rationaleGapsTrackedWithOwners: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "samples"), { recursive: true });
    writeFileSync(
      join(t3, "samples", "ui_rationale_sample.md"),
      "20_case material_decision_sample missing coverage\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-user-rationale"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-user-rationale", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        materialDecisionCatalogConfigured: true,
        sampleCaseCount: 20,
        materialTypesWithUserRationalePct: 80,
        rationaleGapsTrackedWithOwners: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-user-rationale smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
