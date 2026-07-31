/**
 * Smoke: ai-control-testing needs on-schedule cycle + complete exceptions for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiControlTestingCollector,
  type AiControlTestingReport,
} from "../collectors/ai-control-testing.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiControlTestingReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiControlTestingCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-control-testing",
        "ai-control-testing-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmp-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "control_testing_schedule.md"),
      `# Control testing schedule
Recurring control test calendar for AI compliance controls.
Exceptions register requires owner, expiry, compensating control.
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.cmpR1Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "control_assurance.md"),
      "control testing schedule and exceptions register for AI systems\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-control-testing"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-control-testing", "cycle.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        testedOnSchedule: true,
        controlsDueCount: 12,
        controlsMissedCount: 0,
        openExceptionsIncomplete: 0,
        cycleAgeDays: 14,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpR1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "exceptions_register.md"),
      "open exception waiver register with compensating control fields\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-control-testing"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-control-testing", "cycle.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        testedOnSchedule: true,
        openExceptionsIncomplete: 2,
        cycleAgeDays: 7,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpR1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-control-testing smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
