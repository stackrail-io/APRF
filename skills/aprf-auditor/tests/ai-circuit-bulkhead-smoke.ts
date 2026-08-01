/**
 * Smoke: ai-circuit-bulkhead needs breaker + bulkhead + trip evidence.
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
  aiCircuitBulkheadCollector,
  type AiCircuitBulkheadReport,
} from "../collectors/ai-circuit-bulkhead.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiCircuitBulkheadReport> {
  await aiCircuitBulkheadCollector.collect({
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
        "ai-circuit-bulkhead",
        "ai-circuit-bulkhead-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "openai_client.ts"),
      "const breaker = new CircuitBreaker(openaiCall);\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "llm_pool.ts"),
      "CircuitBreaker + bulkhead max_concurrent=8 for bedrock\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-circuit-bulkhead"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-circuit-bulkhead", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        circuitBreakerConfigured: true,
        bulkheadLimitsConcurrentCalls: true,
        breakerTripEvidenceWithin90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "breaker_test.ts"),
      "test breaker_open under induced fail\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-circuit-bulkhead"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-circuit-bulkhead", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        circuitBreakerConfigured: true,
        bulkheadLimitsConcurrentCalls: true,
        breakerTripEvidenceWithin90Days: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-circuit-bulkhead smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
