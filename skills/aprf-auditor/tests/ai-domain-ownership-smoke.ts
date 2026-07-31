/**
 * Smoke: ai-domain-ownership needs full coverage + 0 missing domain owners for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiDomainOwnershipCollector,
  type AiDomainOwnershipReport,
} from "../collectors/ai-domain-ownership.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiDomainOwnershipReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiDomainOwnershipCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-domain-ownership",
        "ai-domain-ownership-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-org-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai_system_inventory.md"),
      `# Production AI system inventory
| system | security owner | safety owner | data owner |
Domain owner fields for critical APRF domains.
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.orgR2Satisfied !== false
    ) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "ownership_register.md"),
      "system inventory with domain owner and security owner columns\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-domain-ownership"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-domain-ownership", "inventory.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllProductionAiSystems: true,
        productionAiSystemCount: 3,
        systemsMissingRequiredDomainOwners: 0,
        requiredDomainOwnerFields: [
          "security",
          "safety",
          "data",
          "reliability",
        ],
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.orgR2Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "ai_inventory.md"),
      "production AI inventory domain owners\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-domain-ownership"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-domain-ownership", "inventory.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllProductionAiSystems: true,
        systemsMissingRequiredDomainOwners: 2,
        requiredDomainOwnerFieldCount: 4,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.orgR2Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-domain-ownership smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
