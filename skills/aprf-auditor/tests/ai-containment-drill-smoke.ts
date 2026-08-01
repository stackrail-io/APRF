/**
 * Smoke: ai-containment-drill needs pause + disable + rollback within budgets for PASS.
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
  aiContainmentDrillCollector,
  type AiContainmentDrillReport,
} from "../collectors/ai-containment-drill.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiContainmentDrillReport> {
  await aiContainmentDrillCollector.collect({
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
        "ai-containment-drill",
        "ai-containment-drill-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "containment.md"),
      "Containment: pause agent, disable tools, roll back prompt within time budget\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "containment-drill.md"),
      [
        "# Containment drill",
        "pause agent within 5 min",
        "disable tool / revoke tool access",
        "roll back prompt and model pin",
        "time budget documented",
      ].join("\n"),
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-containment-drill"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-containment-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        pauseAgentsDemonstrated: true,
        disableToolsDemonstrated: true,
        rollbackPromptOrModelDemonstrated: true,
        withinDocumentedTimeBudgets: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "kill-switch.md"),
      "pause agent emergency stop drill\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-containment-drill"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-containment-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        pauseAgentsDemonstrated: true,
        disableToolsDemonstrated: true,
        rollbackPromptOrModelDemonstrated: true,
        withinDocumentedTimeBudgets: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-containment-drill smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
