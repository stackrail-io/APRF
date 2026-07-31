/**
 * Smoke: memory-integrity needs inventory + 100% verification for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryIntegrityCollector,
  type MemoryIntegrityReport,
} from "../collectors/memory-integrity.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryIntegrityReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryIntegrityCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "memory-integrity", "memory-integrity-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-memint-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "signed_memory.py"),
      "def sign_memory(record): ...  # hmac / signature for durable memory integrity\n",
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memM4Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "critical_memory_classes.md"),
      "critical memory classes inventory with signed integrity protection\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-integrity"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "memory-integrity", "verify.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criticalClassesInventoried: true,
        integrityControlPresent: true,
        verificationSucceededPct: 100,
        coversAllCriticalClasses: true,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memM4Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "memory_mac.py"),
      "verify_signature / hmac integrity check for memory\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-integrity"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "memory-integrity", "verify.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criticalClassesInventoried: true,
        integrityControlPresent: true,
        verificationSucceededPct: 90,
        coversAllCriticalClasses: true,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memM4Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-integrity smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
