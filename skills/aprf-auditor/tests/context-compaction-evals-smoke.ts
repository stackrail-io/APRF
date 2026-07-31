/**
 * Smoke: context-compaction-evals needs retention + release gate + fresh run for PASS.
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
  contextCompactionEvalsCollector,
  type ContextCompactionEvalsReport,
} from "../collectors/context-compaction-evals.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ContextCompactionEvalsReport> {
  await contextCompactionEvalsCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "context-compaction-evals",
        "context-compaction-evals-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "compaction_critical_fact_retention.md"),
      "Summarization compaction eval for critical fact retention threshold\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.ctxR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "summarize_history.py"),
      "# compact conversation history\n# critical_fact retention_eval information_loss\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-compaction-evals"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "context-compaction-evals", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionMeetsThreshold: true,
        regressionsBlockRelease: true,
        lastRunAgeDays: 14,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "context_compress.md"),
      "context compress summarization critical-fact retention\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-compaction-evals"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "context-compaction-evals", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionMeetsThreshold: false,
        regressionsBlockRelease: true,
        lastRunAgeDays: 7,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-compaction-evals smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
