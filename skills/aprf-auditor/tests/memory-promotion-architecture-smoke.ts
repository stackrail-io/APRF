/**
 * Smoke: memory-promotion-architecture needs separation + ≥10 audits for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  memoryPromotionArchitectureCollector,
  type MemoryPromotionArchitectureReport,
} from "../collectors/memory-promotion-architecture.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<MemoryPromotionArchitectureReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await memoryPromotionArchitectureCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "memory-promotion-architecture",
        "memory-promotion-architecture-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mempromo-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "memory_architecture.md"),
      `# Memory architecture
working memory vs durable memory
promotion rule: promote_to_durable
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.memR3Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "config"), { recursive: true });
    writeFileSync(
      join(t2, "config", "memory.yaml"),
      "working_memory:\n  ttl: 1h\ndurable_memory:\n  ttl: 30d\npromotion_rule: gated\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "memory-promotion-architecture"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "memory-promotion-architecture", "audit.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        workingDurableSeparated: true,
        promotionRulesPresent: true,
        silentPromotionDenied: true,
        lastPromotionsWithRuleAndActor: 10,
        ttlDiffersByMemoryClass: true,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.memR3Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "promo.md"),
      "working memory durable memory promotion rule\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "memory-promotion-architecture"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "memory-promotion-architecture", "audit.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        workingDurableSeparated: true,
        promotionRulesPresent: true,
        silentPromotionDenied: false,
        lastPromotionsWithRuleAndActor: 10,
        ttlDiffersByMemoryClass: true,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.memR3Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("memory-promotion-architecture smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
