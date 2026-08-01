/**
 * Smoke: ai-multi-provider-continuity needs documented path + ≤180d failover.
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
  aiMultiProviderContinuityCollector,
  type AiMultiProviderContinuityReport,
} from "../collectors/ai-multi-provider-continuity.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiMultiProviderContinuityReport> {
  await aiMultiProviderContinuityCollector.collect({
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
        "ai-multi-provider-continuity",
        "ai-multi-provider-continuity-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r7-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "multi-provider.md"),
      "Alternate provider path for Level 5 AI continuity\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR7Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "provider-contract.md"),
      "MSA with secondary provider; technical failover design\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-multi-provider-continuity"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-multi-provider-continuity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        alternateProviderPathDocumented: true,
        failoverTestSucceededWithin180Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR7Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "failover_test.md"),
      "Cross-provider failover test report draft\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-multi-provider-continuity"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-multi-provider-continuity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        alternateProviderPathDocumented: true,
        failoverTestSucceededWithin180Days: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR7Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-multi-provider-continuity smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
