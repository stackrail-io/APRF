/**
 * Smoke: rollback-runbook needs complete runbook + on-call drill for PASS.
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
  rollbackRunbookCollector,
  type RollbackRunbookReport,
} from "../collectors/rollback-runbook.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<RollbackRunbookReport> {
  await rollbackRunbookCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "rollback-runbook", "rollback-runbook-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "runbooks"), { recursive: true });
    writeFileSync(
      join(t1, "runbooks", "rollback-runbook.md"),
      "rollback runbook\nexact commands: kubectl rollout undo\nowner: platform-oncall\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "rollback-procedure.md"),
      "rollback procedure with ui steps\non-call drill checklist time-to-execute recorded\nowner: sre-oncall\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "rollback-runbook"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "rollback-runbook", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        runbookHasCommandsAndOwners: true,
        onCallWalkthroughOrDrillCompleted: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "how-to-rollback.md"),
      "how to rollback model pin\nexact steps\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "rollback-runbook"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "rollback-runbook", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        runbookHasCommandsAndOwners: true,
        onCallWalkthroughOrDrillCompleted: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("rollback-runbook smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
