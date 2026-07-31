/**
 * Smoke: one-click-ai-rollback needs single-action path + exercise within RTO for PASS.
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
  oneClickAiRollbackCollector,
  type OneClickAiRollbackReport,
} from "../collectors/one-click-ai-rollback.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<OneClickAiRollbackReport> {
  await oneClickAiRollbackCollector.collect({
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
        "one-click-ai-rollback",
        "one-click-ai-rollback-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "scripts"), { recursive: true });
    writeFileSync(
      join(t1, "scripts", "rollback.sh"),
      "#!/bin/bash\n# single-command rollback for AI release unit\necho rollback-ai-release\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "one-click-rollback.md"),
      "one-click rollback for AI release units\nrollback exercise within RTO\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "one-click-ai-rollback"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "one-click-ai-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        singleCommandOrActionRollbackDocumented: true,
        exerciseOrRealRollbackWithinRtoLast90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "ai-release-unit-rollback.md"),
      "single command rollback documented\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "one-click-ai-rollback"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "one-click-ai-rollback", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        singleCommandOrActionRollbackDocumented: true,
        exerciseOrRealRollbackWithinRtoLast90Days: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("one-click-ai-rollback smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
