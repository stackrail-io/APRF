/**
 * Smoke: agent-sandbox-sim needs sandbox env + linked ≤30d import for PASS.
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
  agentSandboxSimCollector,
  type AgentSandboxSimReport,
} from "../collectors/agent-sandbox-sim.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentSandboxSimReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-sandbox-sim",
        "agent-sandbox-sim-report.json",
      ),
      "utf8",
    ),
  ) as AgentSandboxSimReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agnr2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agnr2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentSandboxSimCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "ops"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "agent-sandbox.yaml"),
    `
# Agent sandbox / simulation environment for pre-prod behavior runs
environment: staging-agent-sandbox
dry_run: true
`,
    "utf8",
  );
  mkdirSync(join(targetDir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(targetDir, ".github", "workflows", "agent-promote.yml"),
    `
name: agent-promote
on: workflow_dispatch
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: echo "sandbox simulation gate required before promote"
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agnr2-1-"));
  await agentSandboxSimCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.sandboxEnvPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agnr2-2-"));
  mkdirSync(join(out2, "imports", "agent-sandbox-sim"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-sandbox-sim", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      linkedSandboxRun: true,
      daysBeforeRelease: 5,
      passFailCriteriaRecorded: true,
      outcomePass: true,
      criteria: ["tools bounded", "no unauthorized side effects"],
    }),
    "utf8",
  );
  await agentSandboxSimCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnR2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("agent-sandbox-sim smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
