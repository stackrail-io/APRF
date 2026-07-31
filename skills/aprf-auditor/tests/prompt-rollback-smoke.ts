/**
 * Smoke: prompt-rollback needs within-RTO restore + no full app redeploy for PASS.
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
  promptRollbackCollector,
  type PromptRollbackReport,
} from "../collectors/prompt-rollback.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PromptRollbackReport> {
  await promptRollbackCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "prompt-rollback", "prompt-rollback-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-prm-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "prompt-rollback.md"),
      "prompt rollback procedure\nRTO 15 minutes\nrestore without full app redeploy via registry pin\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.prmM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "runbooks"), { recursive: true });
    writeFileSync(
      join(t2, "runbooks", "prompt-rollback.md"),
      "prompt rollback: restore prior version without full application redeploy\ntimed restore drill\nRTO <= 30 min\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "prompt-rollback"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "prompt-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        priorPromptRestoredWithinRto: true,
        rollbackWithoutFullAppRedeploy: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.prmM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "prompt-restore.md"),
      "restore prompt version; rollback drill log\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "prompt-rollback"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "prompt-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        priorPromptRestoredWithinRto: false,
        rollbackWithoutFullAppRedeploy: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.prmM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("prompt-rollback smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
