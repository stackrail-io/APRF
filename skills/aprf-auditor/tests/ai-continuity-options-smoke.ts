/**
 * Smoke: ai-continuity-options needs docs + 100% owned coverage.
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
  aiContinuityOptionsCollector,
  type AiContinuityOptionsReport,
} from "../collectors/ai-continuity-options.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiContinuityOptionsReport> {
  await aiContinuityOptionsCollector.collect({
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
        "ai-continuity-options",
        "ai-continuity-options-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "continuity-options.md"),
      "Critical AI-dependent process continuity option: alternate provider failover\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "failover.md"),
      "Manual procedure for critical AI process; owner: platform-sre\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-continuity-options"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-continuity-options", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityOptionsDocumented: true,
        criticalAiProcessCount: 2,
        criticalAiProcessesWithOwnedContinuityOptionPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "alternate-provider.md"),
      "Alternate provider continuity option for openai workload\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-continuity-options"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-continuity-options", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityOptionsDocumented: true,
        criticalAiProcessCount: 3,
        criticalAiProcessesWithOwnedContinuityOptionPct: 66,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-continuity-options smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
