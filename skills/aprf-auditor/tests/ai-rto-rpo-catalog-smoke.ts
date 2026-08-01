/**
 * Smoke: ai-rto-rpo-catalog needs continuity docs + 100% service coverage + restore link.
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
  aiRtoRpoCatalogCollector,
  type AiRtoRpoCatalogReport,
} from "../collectors/ai-rto-rpo-catalog.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiRtoRpoCatalogReport> {
  await aiRtoRpoCatalogCollector.collect({
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
        "ai-rto-rpo-catalog",
        "ai-rto-rpo-catalog-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m6-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "business-continuity.md"),
      "Business continuity plan draft for AI services\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relM5Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "service-catalog.md"),
      "Service catalog with business-critical AI service RTO/RPO and failover test\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-rto-rpo-catalog"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-rto-rpo-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityDocumentationConfigured: true,
        businessCriticalAiServiceCount: 2,
        businessCriticalAiServicesWithNumericRtoRpoPct: 100,
        linkedToTestedRestoreOrFailoverProcedure: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relM5Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "disaster-recovery.md"),
      "Disaster recovery documentation with recovery time objective\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-rto-rpo-catalog"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-rto-rpo-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityDocumentationConfigured: true,
        businessCriticalAiServiceCount: 2,
        businessCriticalAiServicesWithNumericRtoRpoPct: 50,
        linkedToTestedRestoreOrFailoverProcedure: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relM5Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-rto-rpo-catalog smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
