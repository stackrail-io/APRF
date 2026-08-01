/**
 * Smoke: high-risk-output-gate needs complete inventory + 100% reject coverage.
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
  highRiskOutputGateCollector,
  type HighRiskOutputGateReport,
} from "../collectors/high-risk-output-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<HighRiskOutputGateReport> {
  await highRiskOutputGateCollector.collect({
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
        "high-risk-output-gate",
        "high-risk-output-gate-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "schemas"), { recursive: true });
    writeFileSync(
      join(t1, "schemas", "output-schema.json"),
      '{"title":"response_schema for structured_output before side_effect"}\n',
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "high-risk-paths.md"),
      "high_risk_side_effect_path inventory impact_tier write_irreversible contract_test\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "high-risk-output-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "high-risk-output-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highRiskSideEffectPathInventoryComplete: true,
        highRiskPathsRejectingNonConformingOutputPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "output-validation-test.ts"),
      "// contract_test non_conforming_output reject_non_conform before_side_effect\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "high-risk-output-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "high-risk-output-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highRiskSideEffectPathInventoryComplete: true,
        highRiskPathsRejectingNonConformingOutputPct: 80,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("high-risk-output-gate smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
