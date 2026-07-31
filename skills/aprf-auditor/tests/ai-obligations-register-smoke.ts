/**
 * Smoke: ai-obligations-register needs full per-system coverage for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiObligationsRegisterCollector,
  type AiObligationsRegisterReport,
} from "../collectors/ai-obligations-register.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiObligationsRegisterReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiObligationsRegisterCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-obligations-register",
        "ai-obligations-register-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmpobl-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai_obligations_register.md"),
      `# Obligations register
system: chat-assistant
obligation: GDPR Art 22
owner: privacy-ops
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.cmpM1Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "compliance"), { recursive: true });
    writeFileSync(
      join(t2, "compliance", "register.yaml"),
      "obligation_register:\n  - system: assistant\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-obligations-register"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-obligations-register", "register.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllProductionAiSystems: true,
        systemsMissingObligationOrNoneAttest: 0,
        systemsMissingOwner: 0,
        systemsWithStaleReview: 0,
        productionAiSystemCount: 2,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpM1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "obligations.md"),
      "applicable obligation register for AI system\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-obligations-register"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-obligations-register", "register.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllProductionAiSystems: false,
        systemsMissingObligationOrNoneAttest: 1,
        systemsMissingOwner: 0,
        systemsWithStaleReview: 0,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpM1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-obligations-register smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
