/**
 * Smoke: agent-behavior-feature-flags needs flags + audit + disable test for PASS.
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
  agentBehaviorFeatureFlagsCollector,
  type AgentBehaviorFeatureFlagsReport,
} from "../collectors/agent-behavior-feature-flags.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AgentBehaviorFeatureFlagsReport> {
  await agentBehaviorFeatureFlagsCollector.collect({
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
        "agent-behavior-feature-flags",
        "agent-behavior-feature-flags-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-chg-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "flags"), { recursive: true });
    writeFileSync(
      join(t1, "flags", "agent-flags.yaml"),
      "feature_flags:\n  agent_new_tool_use: true\n  behavior_flag: research_mode\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.chgR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "agent-feature-flags.md"),
      "agent behavior flags behind launchdarkly\nflag change audit trail\nkill disable path tested\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "agent-behavior-feature-flags"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "agent-behavior-feature-flags", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        newAgentBehaviorsBehindFlags: true,
        flagStateChangesAudited: true,
        killDisablePathTestedLast90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.chgR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "agents"), { recursive: true });
    writeFileSync(
      join(t3, "agents", "flags.md"),
      "feature flag for autonomous agent\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "agent-behavior-feature-flags"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "agent-behavior-feature-flags", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        newAgentBehaviorsBehindFlags: true,
        flagStateChangesAudited: true,
        killDisablePathTestedLast90Days: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.chgR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("agent-behavior-feature-flags smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
