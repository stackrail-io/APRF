/**
 * Smoke: memory-isolation needs ≥10 clean memory attack cases for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryIsolationCollector,
  type MemoryIsolationReport,
} from "../collectors/memory-isolation.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryIsolationReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryIsolationCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "memory-isolation", "memory-isolation-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-memiso-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "memory_store.py"),
      `
def get_memory(memory_id, tenant_id, user_id):
    return Memory.query.filter(
        Memory.id == memory_id,
        Memory.tenant_id == tenant_id,
        Memory.user_id == user_id,
    ).first()
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memM1Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "vector_memory.py"),
      "def search_memory(query, tenant_id): ...\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-isolation"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "memory-isolation", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversMemoryApis: true,
        crossUserRequired: true,
        crossUserCovered: true,
        attackCases: 12,
        unauthorizedSuccesses: 0,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memM1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "conversation_memory.py"),
      "tenant_id filter on conversation memory store\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-isolation"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "memory-isolation", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversMemoryApis: true,
        attackCases: 12,
        unauthorizedSuccesses: 2,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memM1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-isolation smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
