/**
 * Smoke: agent-kill-switch needs kill API + full imported cancel/drill for PASS.
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
  agentKillSwitchCollector,
  type AgentKillSwitchReport,
} from "../collectors/agent-kill-switch.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentKillSwitchReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-kill-switch",
        "agent-kill-switch-report.json",
      ),
      "utf8",
    ),
  ) as AgentKillSwitchReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agn3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agn3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentKillSwitchCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "ops"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "kill_switch.py"),
    `
def terminate_agent(run_id, caller):
    """kill-switch: operator RBAC on-call pause/terminate agent run"""
    require_role(caller, "operator")
    abort_run(run_id)
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "kill-switch-runbook.md"),
    `# Kill-switch runbook
Operator on-call may pause/terminate agent runs.
Time-to-effect SLO: p95 within 30 seconds.
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_kill_switch.py"),
    `
def test_queue_cancelled_on_kill():
    assert queued_tasks_cancelled()

def test_running_inflight_aborted():
    assert running_tools_aborted()

def test_child_agent_terminated():
    assert child_agents_terminated()
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agn3-1-"));
  await agentKillSwitchCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.killApiPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agn3-2-"));
  mkdirSync(join(out2, "imports", "agent-kill-switch"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-kill-switch", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      architectureReviewOk: true,
      tests: [
        { kind: "queue", passed: true },
        { kind: "running", passed: true },
        { kind: "child", passed: true },
        {
          kind: "drill",
          passed: true,
          timeToEffectMs: 12000,
          sloMs: 30000,
          ageDays: 14,
        },
      ],
    }),
    "utf8",
  );
  await agentKillSwitchCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnM3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("agent-kill-switch smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
