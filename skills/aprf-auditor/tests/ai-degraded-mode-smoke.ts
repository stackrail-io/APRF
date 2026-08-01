/**
 * Smoke: ai-degraded-mode needs docs + 100% journey coverage + failover test.
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
  aiDegradedModeCollector,
  type AiDegradedModeReport,
} from "../collectors/ai-degraded-mode.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiDegradedModeReport> {
  await aiDegradedModeCollector.collect({
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
        "ai-degraded-mode",
        "ai-degraded-mode-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "degraded-mode.md"),
      "Critical journey degraded mode when AI unavailable uses rule-based fallback\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "fallback.md"),
      "Graceful degradation for openai journeys with feature flag\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-degraded-mode"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-degraded-mode", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        degradedModeDocumented: true,
        criticalJourneyCount: 2,
        criticalJourneysWithDegradedModePct: 100,
        failoverTestShowsSafeFallback: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "failover_test.py"),
      "def test_failover_when_ai_unavailable():\n  assert fallback_mode()\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-degraded-mode"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-degraded-mode", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        degradedModeDocumented: true,
        criticalJourneyCount: 2,
        criticalJourneysWithDegradedModePct: 50,
        failoverTestShowsSafeFallback: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-degraded-mode smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
