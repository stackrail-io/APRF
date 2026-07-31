/**
 * Smoke: memory-write-policy needs policy + 100% deny for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryWritePolicyCollector,
  type MemoryWritePolicyReport,
} from "../collectors/memory-write-policy.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryWritePolicyReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryWritePolicyCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "memory-write-policy",
        "memory-write-policy-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-memwp-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "durable_memory_write_policy.md"),
      `# Durable memory write policy
allowed writers: agent-runtime, approved-tool
content classes: fact, preference
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memM3Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "memory_write_gate.py"),
      "def authorize_write(writer, content_class): ...  # write guard / deny write\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-write-policy"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "memory-write-policy", "deny-suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        policyEnumeratesWritersAndContentClasses: true,
        enforcementPresent: true,
        unauthorizedWritersDeniedPct: 100,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memM3Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "write_policy.md"),
      "durable memory write policy allowed writer content class\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-write-policy"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "memory-write-policy", "deny-suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        policyEnumeratesWritersAndContentClasses: true,
        enforcementPresent: true,
        unauthorizedWritersDeniedPct: 80,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memM3Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-write-policy smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
