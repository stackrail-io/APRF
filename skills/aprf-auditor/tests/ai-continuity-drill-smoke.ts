/**
 * Smoke: ai-continuity-drill needs calendar + provider-loss drill + RTO/RPO.
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
  aiContinuityDrillCollector,
  type AiContinuityDrillReport,
} from "../collectors/ai-continuity-drill.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiContinuityDrillReport> {
  await aiContinuityDrillCollector.collect({
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
        "ai-continuity-drill",
        "ai-continuity-drill-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "provider-loss-plan.md"),
      "provider_loss continuity scenario for llm gateway\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "continuity-drill-calendar.md"),
      "continuity_drill_calendar includes provider_loss + rto_rpo_result\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-continuity-drill"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-continuity-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityDrillCalendarConfigured: true,
        providerLossDrillCompletedWithin90Days: true,
        rtoRpoMetOrOwnedExceptions: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "reports"), { recursive: true });
    writeFileSync(
      join(t3, "reports", "continuity_drill_report.md"),
      "provider_loss_drill rto_rpo_miss without owner\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-continuity-drill"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-continuity-drill", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        continuityDrillCalendarConfigured: true,
        providerLossDrillCompletedWithin90Days: true,
        rtoRpoMetOrOwnedExceptions: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-continuity-drill smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
