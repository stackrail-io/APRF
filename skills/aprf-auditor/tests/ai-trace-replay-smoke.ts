/**
 * Smoke: ai-trace-replay needs restricted env + RTO + recent replay for PASS.
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
  aiTraceReplayCollector,
  type AiTraceReplayReport,
} from "../collectors/ai-trace-replay.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiTraceReplayReport> {
  await aiTraceReplayCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-trace-replay", "ai-trace-replay-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "trace-replay.md"),
      "Failed trace replay tooling for AI spans\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "secure-replay.md"),
      "Restricted environment secure replay with RTO 30 min; last replay drill\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-trace-replay"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-trace-replay", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        restrictedReplayEnvironmentConfigured: true,
        replayWithinDocumentedRto: true,
        lastDrillOrRealReplayWithin90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "replay-session.md"),
      "Trace replay session notes\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-trace-replay"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-trace-replay", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        restrictedReplayEnvironmentConfigured: true,
        replayWithinDocumentedRto: true,
        lastReplayAgeDays: 120,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.obsR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-trace-replay smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
