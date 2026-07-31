/**
 * Smoke: memory-retention needs policy + job + purge test for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryRetentionCollector,
  type MemoryRetentionReport,
} from "../collectors/memory-retention.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryRetentionReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryRetentionCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "memory-retention", "memory-retention-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-memret-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "memory_retention_policy.md"),
      `# Memory retention policy
conversation memory: retain for 30 days
durable memory: retention period 90 days
vector memory class TTL policy
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memM2Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "jobs"), { recursive: true });
    writeFileSync(
      join(t2, "jobs", "purge_memory_ttl.py"),
      "# ttl job / deletion job for memory retention\ndef run_retention_job(): ...\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-retention"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "memory-retention", "purge-test.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionPeriodsPerMemoryClass: true,
        ttlOrDeletionJobConfigured: true,
        purgeTestSucceeded: true,
        olderThanRetentionAbsent: true,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memM2Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "retention.md"),
      "memory class retention period TTL policy\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-retention"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "memory-retention", "purge-test.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionPeriodsPerMemoryClass: true,
        ttlOrDeletionJobConfigured: true,
        purgeTestSucceeded: true,
        olderThanRetentionAbsent: false,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memM2Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-retention smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
