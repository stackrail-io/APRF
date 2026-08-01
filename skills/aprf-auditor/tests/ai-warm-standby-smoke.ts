/**
 * Smoke: ai-warm-standby needs architecture + failover RTO + peak capacity.
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
  aiWarmStandbyCollector,
  type AiWarmStandbyReport,
} from "../collectors/ai-warm-standby.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiWarmStandbyReport> {
  await aiWarmStandbyCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-warm-standby", "ai-warm-standby-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r6-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "vllm-cluster.md"),
      "self-hosted vllm inference cluster on gpu_fleet\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR6Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "warm-standby.md"),
      "warm_standby inference + standby_capacity covers declared_peak\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-warm-standby"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-warm-standby", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        warmStandbyArchitectureDocumented: true,
        failoverWithinRtoWithin90Days: true,
        standbyCapacityCoversDeclaredPeak: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR6Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "standby_failover.md"),
      "warm_standby_failover test missed rto\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-warm-standby"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-warm-standby", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        warmStandbyArchitectureDocumented: true,
        failoverWithinRtoWithin90Days: false,
        standbyCapacityCoversDeclaredPeak: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR6Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-warm-standby smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
