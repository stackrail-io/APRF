/**
 * Smoke: ai-distributed-trace-linkage needs ≥95% linked coverage over ≥24h for PASS.
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
  aiDistributedTraceLinkageCollector,
  type AiDistributedTraceLinkageReport,
} from "../collectors/ai-distributed-trace-linkage.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiDistributedTraceLinkageReport> {
  await aiDistributedTraceLinkageCollector.collect({
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
        "ai-distributed-trace-linkage",
        "ai-distributed-trace-linkage-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "otel-tracing.ts"),
      "OpenTelemetry tracer for llm span and tool span with request id\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "instrumentation"), { recursive: true });
    writeFileSync(
      join(t2, "instrumentation", "gen-ai-spans.py"),
      "opentelemetry gen_ai model span + tool span + outcome with traceparent\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-distributed-trace-linkage"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-distributed-trace-linkage", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        linkedTracePct: 97,
        sampleWindowHours: 24,
        coversModelToolOutcome: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "tracing.md"),
      "Distributed tracing with otlp exporter for completion spans\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-distributed-trace-linkage"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-distributed-trace-linkage", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        linkedTracePct: 80,
        sampleWindowHours: 24,
        coversModelToolOutcome: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.obsM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-distributed-trace-linkage smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
