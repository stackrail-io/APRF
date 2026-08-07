/**
 * Smoke: agent-loop-limits needs required execution bounds + measured abort for PASS.
 * Recursion/delegation depth is required only when spawn/sub-agent capability exists.
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

  // --- Case A: iteration + bare timeout: only (no spawn capability) ---
  const noSpawnDir = mkdtempSync(join(tmpdir(), "aprf-agn2-ns-"));
  mkdirSync(join(noSpawnDir, "agents"), { recursive: true });
  writeFileSync(
    join(noSpawnDir, "agents", "runtime.yaml"),
    `
agent:
  max_iterations: 25
  timeout: 120
  framework: langgraph
`,
    "utf8",
  );
  // Marketing docs mentioning multi-agent must not force spawn bounds.
  writeFileSync(
    join(noSpawnDir, "README.md"),
    "# Our multi-agent platform can delegate work across teams.\n",
    "utf8",
  );
  mkdirSync(join(noSpawnDir, "tests"), { recursive: true });
  writeFileSync(
    join(noSpawnDir, "tests", "test_agent_limits.py"),
    `
def test_abort_on_max_iterations_exceeded():
    """enforcement: run aborts when max_iterations exceeded (fail closed)"""
    assert abort_on_exceed(max_iterations=1)

def test_abort_on_timeout():
    assert abort_on_exceed(timeout=1)
`,
    "utf8",
  );
  const outNs = mkdtempSync(join(tmpdir(), "aprf-agn2-ns-o-"));
  mkdirSync(join(outNs, "imports", "agent-loop-limits"), { recursive: true });
  writeFileSync(
    join(outNs, "imports", "agent-loop-limits", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "lg1",
          abortedOnExceed: true,
          promptOnly: false,
          continuesAfterAbort: false,
        },
      ],
    }),
    "utf8",
  );
  await agentLoopLimitsCollector.collect({
    ...baseCtx,
    targetPath: noSpawnDir,
    outputDir: outNs,
  });
  const rNs = readReport(outNs);
  if (rNs.summary.spawnDepthApplicable !== false) {
    throw new Error(
      `expected spawnDepthApplicable=false for langgraph-only, got ${JSON.stringify(rNs.summary)}`,
    );
  }
  if (!rNs.summary.requiredBoundsPresent || rNs.summary.statusHint !== "pass") {
    throw new Error(
      `expected pass without spawn depth, got ${JSON.stringify(rNs.summary)} notes=${JSON.stringify(rNs.notes)}`,
    );
  }

  // --- Case B: spawn capability present → recursion bound required ---
  mkdirSync(join(targetDir, "agents"), { recursive: true });
  writeFileSync(
    join(targetDir, "agents", "runtime.yaml"),
    `
agent:
  max_steps: 25
  wall_clock_timeout_seconds: 120
  spawn_depth: 2
  orchestration: langgraph
  allow_sub_agent_spawn: true
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

  // Prior audit output under the target must not launder as repo evidence.
  mkdirSync(join(targetDir, "aprf-assessment", "imports", "agent-loop-limits"), {
    recursive: true,
  });
  writeFileSync(
    join(targetDir, "aprf-assessment", "assessment.json"),
    JSON.stringify({
      notes: [
        "max_steps wall_clock_timeout spawn_depth abort enforcement",
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(
      targetDir,
      "aprf-assessment",
      "imports",
      "agent-loop-limits",
      "agent-loop-limits-report.json",
    ),
    JSON.stringify({
      maxSteps: { found: true },
      wallClock: { found: true },
      spawnDepth: { found: true },
      notes: ["max_steps wall_clock spawn_depth"],
    }),
    "utf8",
  );

  await agentLoopLimitsCollector.collect({
    ...baseCtx,
    // Simulate writing assessment inside the scanned target.
    outputDir: join(targetDir, "aprf-assessment"),
  });
  const r1 = readReport(join(targetDir, "aprf-assessment"));
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.requiredBoundsPresent ||
    !r1.summary.spawnDepthApplicable
  ) {
    throw new Error(
      `expected partial with required bounds + spawn applicable, got ${JSON.stringify(r1.summary)}`,
    );
  }
  for (const key of ["maxSteps", "wallClock", "spawnDepth"] as const) {
    const bad = r1[key].refs.filter((r) => r.includes("aprf-assessment"));
    if (bad.length) {
      throw new Error(`${key} must not cite aprf-assessment output, got ${bad}`);
    }
  }
  if (!r1.maxSteps.refs.some((r) => r.includes("agents/runtime.yaml"))) {
    throw new Error(
      `expected repo runtime.yaml in maxSteps refs, got ${JSON.stringify(r1.maxSteps.refs)}`,
    );
  }
  if (r1.signals?.maxSteps?.found !== true) {
    throw new Error(
      `expected signals.maxSteps.found for Evidence found, got ${JSON.stringify(r1.signals)}`,
    );
  }
  if (!r1.gapNotes?.some((n) => /enforcement|abort/i.test(n))) {
    throw new Error(
      `expected gapNotes about enforcement/abort, got ${JSON.stringify(r1.gapNotes)}`,
    );
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agn2-2-"));
  mkdirSync(join(out2, "imports", "agent-loop-limits"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-loop-limits", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "a1",
          abortedOnExceed: true,
          promptOnly: false,
          continuesAfterAbort: false,
        },
        {
          agent: "a2",
          abortedOnExceed: true,
          failClosed: true,
          continuesAfterAbort: false,
        },
      ],
    }),
    "utf8",
  );
  await agentLoopLimitsCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  // --- Case C: continue-after-abort → FAIL ---
  const outFail = mkdtempSync(join(tmpdir(), "aprf-agn2-fail-"));
  mkdirSync(join(outFail, "imports", "agent-loop-limits"), { recursive: true });
  writeFileSync(
    join(outFail, "imports", "agent-loop-limits", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "bad",
          abortedOnExceed: true,
          continuesAfterAbort: true,
        },
      ],
    }),
    "utf8",
  );
  await agentLoopLimitsCollector.collect({ ...baseCtx, outputDir: outFail });
  const rFail = readReport(outFail);
  if (rFail.summary.statusHint !== "fail") {
    throw new Error(
      `expected fail on continue-after-abort, got ${JSON.stringify(rFail.summary)}`,
    );
  }

  console.log("agent-loop-limits smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
