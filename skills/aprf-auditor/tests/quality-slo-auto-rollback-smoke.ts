/**
 * Smoke: quality-slo-auto-rollback needs burn wiring + test/drill for PASS.
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
  qualitySloAutoRollbackCollector,
  type QualitySloAutoRollbackReport,
} from "../collectors/quality-slo-auto-rollback.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<QualitySloAutoRollbackReport> {
  await qualitySloAutoRollbackCollector.collect({
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
        "quality-slo-auto-rollback",
        "quality-slo-auto-rollback-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "alerting"), { recursive: true });
    writeFileSync(
      join(t1, "alerting", "quality-slo-burn.yml"),
      "alert: quality_slo_burn\n  action: trigger_rollback\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "auto-rollback.md"),
      "automated rollback on quality slo burn\nauto rollback drill completed\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "quality-slo-auto-rollback"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "quality-slo-auto-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        qualitySloBurnWiredToRollbackOrPage: true,
        automatedRollbackConfigured: true,
        testOrDrillOccurredLast90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "page-on-burn.md"),
      "page on burn with runbook measured mtta\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "quality-slo-auto-rollback"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "quality-slo-auto-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        qualitySloBurnWiredToRollbackOrPage: true,
        automatedRollbackConfigured: false,
        measuredMttaPresent: false,
        testOrDrillOccurredLast90Days: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("quality-slo-auto-rollback smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
