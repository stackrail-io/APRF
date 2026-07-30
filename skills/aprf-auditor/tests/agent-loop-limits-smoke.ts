/**
 * Smoke: agent-loop-limits needs all three limits + measured abort for PASS.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentLoopLimitsCollector,
  type AgentLoopLimitsReport,
} from "../collectors/agent-loop-limits.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentLoopLimitsReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "agent-loop-limits", "agent-loop-limits-report.json"),
      "utf8",
    ),
  ) as AgentLoopLimitsReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agn2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agn2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentLoopLimitsCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (
    r0.summary.statusHint !== "not_applicable" &&
    r0.summary.statusHint !== "not_demonstrated"
  ) {
    throw new Error(`expected na/nd, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "agents"), { recursive: true });
  writeFileSync(
    join(targetDir, "agents", "runtime.yaml"),
    `
agent:
  max_steps: 25
  wall_clock_timeout_seconds: 120
  spawn_depth: 2
  orchestration: langgraph
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_agent_limits.py"),
    `
def test_abort_on_max_steps_exceeded():
    """enforcement: run aborts when max_steps exceeded (fail closed)"""
    assert abort_on_exceed(max_steps=1)

def test_abort_on_timeout():
    assert abort_on_exceed(wall_clock_timeout=1)

def test_abort_on_spawn_depth():
    assert abort_on_exceed(spawn_depth=0)
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agn2-1-"));
  await agentLoopLimitsCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.allThreeLimitsPresent) {
    throw new Error(`expected partial with 3 limits, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agn2-2-"));
  mkdirSync(join(out2, "imports", "agent-loop-limits"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-loop-limits", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      results: [
        { agent: "a1", abortedOnExceed: true, promptOnly: false },
        { agent: "a2", abortedOnExceed: true, failClosed: true },
      ],
    }),
    "utf8",
  );
  await agentLoopLimitsCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("agent-loop-limits smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
