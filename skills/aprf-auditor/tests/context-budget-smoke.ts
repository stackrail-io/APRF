/**
 * Smoke: context-budget needs full builder coverage + 0 silent overflows for PASS.
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
  contextBudgetCollector,
  type ContextBudgetReport,
} from "../collectors/context-budget.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(target: string, outDir: string): Promise<ContextBudgetReport> {
  await contextBudgetCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "context-budget", "context-budget-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "context_assembler.py"),
      "MAX_CONTEXT_TOKENS = 8000\ndef assemble(): truncate by priority when over token_budget\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || r1.summary.ctxM1Satisfied !== false) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "rag_context.py"),
      "context_budget = 4096\n# truncate retrieval before history\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-budget"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "context-budget", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        buildersMissingBudget: 0,
        silentOverflowCount: 0,
        priorityRulesPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "prompt_budget.py"),
      "max_context_tokens = 2048\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-budget"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "context-budget", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        buildersMissingBudget: 2,
        silentOverflowCount: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-budget smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
