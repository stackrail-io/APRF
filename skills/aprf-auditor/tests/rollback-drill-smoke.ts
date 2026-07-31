/**
 * Smoke: rollback-drill needs ≥1 successful restore within RTO for PASS.
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
  rollbackDrillCollector,
  type RollbackDrillReport,
} from "../collectors/rollback-drill.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<RollbackDrillReport> {
  await rollbackDrillCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "rollback-drill", "rollback-drill-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "drills"), { recursive: true });
    writeFileSync(
      join(t1, "drills", "rollback-drill.md"),
      "rollback drill planned\nRTO 30 minutes\ntime-to-restore tracked\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "incidents"), { recursive: true });
    writeFileSync(
      join(t2, "incidents", "successful-rollback.md"),
      "successful rollback during game day\nstarted_at / completed_at\ntime-to-restore within RTO\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "rollback-drill"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "rollback-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        successfulRollbacksLast90Days: 1,
        measuredTimeToRestoreWithinRto: true,
        documentedRtoPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "rollback-incident.md"),
      "rollback incident record timestamps\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "rollback-drill"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "rollback-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        successfulRollbacksLast90Days: 0,
        measuredTimeToRestoreWithinRto: true,
        documentedRtoPresent: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("rollback-drill smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
