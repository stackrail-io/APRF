/**
 * Smoke: memory-poisoning-evals needs ≥5 typed scenarios + gate for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryPoisoningEvalsCollector,
  type MemoryPoisoningEvalsReport,
} from "../collectors/memory-poisoning-evals.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryPoisoningEvalsReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryPoisoningEvalsCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "memory-poisoning-evals",
        "memory-poisoning-evals-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mempois-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "memory_poisoning.yaml"),
      `# memory poison scenarios
- id: cross-tenant-write
- id: prompt-in-memory
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memR1Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "poison_suite.md"),
      "adversarial eval suite with memory poisoning cases\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-poisoning-evals"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "memory-poisoning-evals", "run.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        poisoningScenarioCount: 5,
        coversCrossTenantWrite: true,
        coversPromptInMemory: true,
        coversStaleTrustedFact: true,
        criticalFailsBlockedOrRiskAccepted: true,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memR1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "poison.md"),
      "memory poison stale trusted fact scenario\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-poisoning-evals"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "memory-poisoning-evals", "run.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        poisoningScenarioCount: 5,
        coversCrossTenantWrite: true,
        coversPromptInMemory: true,
        coversStaleTrustedFact: false,
        criticalFailsBlockedOrRiskAccepted: true,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memR1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-poisoning-evals smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
