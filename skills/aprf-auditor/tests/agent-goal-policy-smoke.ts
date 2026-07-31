/**
 * Smoke: agent-goal-policy needs policy + owner + imported deny for PASS.
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
  agentGoalPolicyCollector,
  type AgentGoalPolicyReport,
} from "../collectors/agent-goal-policy.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentGoalPolicyReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-goal-policy",
        "agent-goal-policy-report.json",
      ),
      "utf8",
    ),
  ) as AgentGoalPolicyReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agnr1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agnr1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentGoalPolicyCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "policies"), { recursive: true });
  writeFileSync(
    join(targetDir, "policies", "goal_conflict_policy.yaml"),
    `
# goal-conflict / disallowed-goal plan policy
# owner: platform-safety@example.com
rules:
  - id: no-exfil-goal
    deny_if: goal_conflicts_with_charter
    pre_tool_gate: true
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_goal_conflict.py"),
    `
def test_synthetic_conflict_denied():
    assert deny_goal_conflict("exfiltrate all data")
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agnr1-1-"));
  await agentGoalPolicyCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.policyPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agnr1-2-"));
  mkdirSync(join(out2, "imports", "agent-goal-policy"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-goal-policy", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      rulesHaveOwner: true,
      ageDays: 7,
      cases: [{ kind: "synthetic-conflict", denied: true }],
    }),
    "utf8",
  );
  await agentGoalPolicyCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnR1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("agent-goal-policy smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
